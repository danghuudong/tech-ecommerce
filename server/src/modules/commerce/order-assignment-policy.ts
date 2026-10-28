import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  notExists,
  notInArray,
  or,
  type SQLWrapper,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../../config/db.js'
import { env } from '../../config/env.js'
import {
  orders,
  returns,
  shipments,
  staffOrderSettings,
  user,
} from '../../db/schema.js'

export const assignmentWorkStatuses = [
  'placed',
  'confirmed',
  'packing',
] as const

export const activeReturnStatuses = [
  'requested',
  'approved',
  'receiving',
  'received',
] as const

type WorkOrder = {
  [Key in
    | 'id'
    | 'deletedAt'
    | 'status'
    | 'stockState'
    | 'reservationExpiresAt'
    | 'assignedTo'
    | 'assignedAt'
    | 'createdAt'
    | 'staffWorkStartedAt']: SQLWrapper
}

export function assignmentWorkFilter(workOrder: WorkOrder = orders) {
  return and(
    isNull(workOrder.deletedAt),
    inArray(workOrder.status, assignmentWorkStatuses),
  )
}

export function fulfillmentWorkFilter(
  now: Date,
  workOrder: WorkOrder = orders,
) {
  return and(
    assignmentWorkFilter(workOrder),
    eq(workOrder.stockState, 'reserved'),
    or(
      isNull(workOrder.reservationExpiresAt),
      sql`${workOrder.reservationExpiresAt} > ${now}`,
    ),
  )
}

export function failedDeliveryWorkFilter(workOrder: WorkOrder = orders) {
  return and(
    eq(workOrder.status, 'shipped'),
    exists(
      db
        .select({ id: shipments.id })
        .from(shipments)
        .where(
          and(
            eq(shipments.orderId, workOrder.id),
            eq(shipments.status, 'delivery_failed'),
          ),
        ),
    ),
  )
}

export function returnWorkFilter(workOrder: WorkOrder = orders) {
  return exists(
    db
      .select({ id: returns.id })
      .from(returns)
      .where(
        and(
          eq(returns.orderId, workOrder.id),
          inArray(returns.status, activeReturnStatuses),
        ),
      ),
  )
}

export function actionableStaffWorkFilter(
  now: Date,
  workOrder: WorkOrder = orders,
) {
  return and(
    isNull(workOrder.deletedAt),
    or(
      fulfillmentWorkFilter(now, workOrder),
      failedDeliveryWorkFilter(workOrder),
      returnWorkFilter(workOrder),
    ),
  )
}

export function blockedPaymentWorkFilter(now: Date) {
  return and(
    assignmentWorkFilter(),
    eq(orders.paymentMethod, 'bank_transfer'),
    eq(orders.stockState, 'reserved'),
    sql`${orders.reservationExpiresAt} <= ${now}`,
  )
}

function countAssignedWork(
  assignee: SQLWrapper,
  condition: SQLWrapper | undefined,
) {
  // Keep the correlated qualifiers when Drizzle selects from a single table.
  const count = sql`select count(*)::int from ${orders} where ${orders.assignedTo} = ${assignee} and ${condition}`
  return sql<number>`(${count})`
}

// One order is one unit of load, even if it has several open return requests.
// Counts use current database facts, so reopened work immediately consumes capacity.
export function activeOrderCount(assignee: SQLWrapper, now: Date) {
  return countAssignedWork(assignee, actionableStaffWorkFilter(now))
}

export function workloadBreakdown(assignee: SQLWrapper, now: Date) {
  return {
    fulfillmentOrders: countAssignedWork(assignee, fulfillmentWorkFilter(now)),
    deliveryIssueOrders: countAssignedWork(
      assignee,
      and(isNull(orders.deletedAt), failedDeliveryWorkFilter()),
    ),
    returnOrders: countAssignedWork(
      assignee,
      and(isNull(orders.deletedAt), returnWorkFilter()),
    ),
    blockedPaymentOrders: countAssignedWork(
      assignee,
      blockedPaymentWorkFilter(now),
    ),
  }
}

export function receivingStaffFilter(
  now: Date,
  settings: {
    enabled: SQLWrapper
    acceptingOrders: SQLWrapper
    shiftEndsAt: SQLWrapper
  } = staffOrderSettings,
  person: { id: SQLWrapper; role: SQLWrapper } = user,
) {
  return and(
    eq(person.role, 'staff'),
    env.ORDER_ADMIN_USER_IDS.length
      ? notInArray(person.id, env.ORDER_ADMIN_USER_IDS)
      : undefined,
    eq(settings.enabled, true),
    eq(settings.acceptingOrders, true),
    sql`${settings.shiftEndsAt} > ${now}`,
  )
}

const ownerSettings = alias(staffOrderSettings, 'assignment_owner_settings')
const ownerUser = alias(user, 'assignment_owner_user')
const earlierWork = alias(orders, 'assignment_earlier_work')

function staffWorkStartedAt(workOrder: WorkOrder = orders) {
  return sql<Date>`coalesce(${workOrder.staffWorkStartedAt}, ${workOrder.createdAt})`
}

function workAddedAt(workOrder: WorkOrder = orders) {
  return sql<Date>`greatest(${workOrder.assignedAt}, ${staffWorkStartedAt(workOrder)})`
}

export function ownerUnavailableSince(now: Date) {
  return sql<Date | null>`(select case
    when ${ownerSettings.acceptingOrders} and ${ownerSettings.shiftEndsAt} <= ${now}
      then ${ownerSettings.shiftEndsAt}
    else ${ownerSettings.unavailableSince} end
    from ${staffOrderSettings} as ${sql.identifier('assignment_owner_settings')}
    where ${ownerSettings.userId} = ${orders.assignedTo})`
}

function offShiftAssignmentFilter(now: Date) {
  const since = ownerUnavailableSince(now)
  return and(
    isNull(orders.deletedAt),
    isNotNull(orders.assignedTo),
    sql`${since} is not null`,
    // A manual assignment made after the shift ended is an explicit admin override.
    or(
      eq(orders.assignmentSource, 'automatic'),
      sql`${orders.assignedAt} <= ${since}`,
    ),
    notExists(
      db
        .select({ id: ownerUser.id })
        .from(ownerSettings)
        .innerJoin(ownerUser, eq(ownerUser.id, ownerSettings.userId))
        .where(
          and(
            eq(ownerUser.id, orders.assignedTo),
            receivingStaffFilter(now, ownerSettings, ownerUser),
          ),
        ),
    ),
  )
}

export function handoverWorkFilter(now: Date) {
  return and(
    offShiftAssignmentFilter(now),
    actionableStaffWorkFilter(now),
    sql`${orders.status} <> 'packing'`,
  )
}

export function handoverReviewFilter(now: Date) {
  return and(
    offShiftAssignmentFilter(now),
    or(
      eq(orders.status, 'packing'),
      blockedPaymentWorkFilter(now),
      and(
        eq(orders.status, 'shipped'),
        sql`not (${failedDeliveryWorkFilter()})`,
      ),
    ),
  )
}

// Reopened work is movable only when it falls outside the owner's current
// capacity. Existing work and a manual assignment made after reactivation stay put.
// Ranking all current units prevents old, in-capacity work entering the queue
// merely because a different order reopens later.
export function rebalanceWorkFilter(now: Date) {
  const addedAt = workAddedAt()
  const earlierAddedAt = workAddedAt(earlierWork)
  const position = sql<number>`(select count(*)::int
    from ${orders} as ${sql.identifier('assignment_earlier_work')}
    where ${earlierWork.assignedTo} = ${orders.assignedTo}
      and ${actionableStaffWorkFilter(now, earlierWork)}
      and (${earlierAddedAt} < ${addedAt}
        or (${earlierAddedAt} = ${addedAt} and ${earlierWork.id} <= ${orders.id})))`
  return and(
    actionableStaffWorkFilter(now),
    isNotNull(orders.assignedTo),
    sql`${orders.status} <> 'packing'`,
    sql`${staffWorkStartedAt()} > ${orders.assignedAt}`,
    exists(
      db
        .select({ id: ownerUser.id })
        .from(ownerSettings)
        .innerJoin(ownerUser, eq(ownerUser.id, ownerSettings.userId))
        .where(
          and(
            eq(ownerUser.id, orders.assignedTo),
            receivingStaffFilter(now, ownerSettings, ownerUser),
            sql`${position} > ${ownerSettings.maxActiveOrders}`,
          ),
        ),
    ),
  )
}

export function assignmentQueueFilter(now: Date) {
  return or(
    and(
      isNull(orders.assignedTo),
      or(assignmentWorkFilter(), actionableStaffWorkFilter(now)),
    ),
    handoverWorkFilter(now),
    rebalanceWorkFilter(now),
  )
}

export function eligibleAssignmentFilter(now: Date) {
  return or(
    and(isNull(orders.assignedTo), actionableStaffWorkFilter(now)),
    handoverWorkFilter(now),
    rebalanceWorkFilter(now),
  )
}

export function assignmentWaitingSince(now: Date) {
  const capacityChangedAt = sql<Date>`(select ${ownerSettings.capacityChangedAt}
    from ${staffOrderSettings} as ${sql.identifier('assignment_owner_settings')}
    where ${ownerSettings.userId} = ${orders.assignedTo})`
  return sql<Date>`case when ${orders.assignedTo} is null then ${staffWorkStartedAt()}
    else greatest(${staffWorkStartedAt()}, ${orders.assignedAt},
      coalesce(${ownerUnavailableSince(now)}, ${capacityChangedAt})) end`
}

export function overdueWaitingFilter(now: Date) {
  return and(
    assignmentQueueFilter(now),
    sql`${assignmentWaitingSince(now)} <= ${new Date(now.getTime() - env.ORDER_ASSIGNMENT_QUEUE_SLA_MINUTES * 60_000)}`,
  )
}

export function assignmentDeadlineWarningFilter(now: Date) {
  return and(
    assignmentQueueFilter(now),
    isNotNull(orders.reservationExpiresAt),
    sql`${orders.reservationExpiresAt} <= ${new Date(now.getTime() + env.ORDER_ASSIGNMENT_DEADLINE_WARNING_MINUTES * 60_000)}`,
  )
}

export function assignmentQueueColumns(now: Date) {
  return {
    assignmentWaitingSince:
      sql<Date | null>`case when ${assignmentQueueFilter(now)} then ${assignmentWaitingSince(now)} else null end`.mapWith(
        orders.createdAt,
      ),
    assignmentWaitingOverdue: sql<boolean>`coalesce(${overdueWaitingFilter(now)}, false)`,
    assignmentDeadlineSoon: sql<boolean>`coalesce(${assignmentDeadlineWarningFilter(now)}, false)`,
    assignmentNeedsHandover: sql<boolean>`coalesce(${handoverWorkFilter(now)}, false)`,
    assignmentNeedsRebalance: sql<boolean>`coalesce(${rebalanceWorkFilter(now)}, false)`,
    assignmentHandoverReview: sql<boolean>`coalesce(${handoverReviewFilter(now)}, false)`,
  }
}
