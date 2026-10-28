import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  ne,
  notInArray,
  sql,
} from 'drizzle-orm'
import { db } from '../../config/db.js'
import { env } from '../../config/env.js'
import {
  orderEvents,
  orders,
  staffOrderSettingChanges,
  staffOrderSettings,
  user,
} from '../../db/schema.js'
import {
  appendOrderEvent,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  type Order,
  resolveActor,
  type Transaction,
} from './commerce.persistence.js'
import {
  type Actor,
  type AuditActor,
  DEFAULT_MAX_ACTIVE_ORDERS,
  type StaffOrderSettingsValue,
} from './commerce.types.js'
import {
  activeOrderCount,
  assignmentDeadlineWarningFilter,
  assignmentQueueColumns,
  assignmentQueueFilter,
  assignmentWaitingSince,
  blockedPaymentWorkFilter,
  eligibleAssignmentFilter,
  handoverReviewFilter,
  handoverWorkFilter,
  overdueWaitingFilter,
  rebalanceWorkFilter,
  receivingStaffFilter,
} from './order-assignment-policy.js'

export function overdueAssignmentFilter(now: Date) {
  return sql<boolean>`(${orders.deletedAt} is null and ${orders.status} = 'placed'
    and ${orders.assignedTo} is not null and ${orders.assignedAt} is not null
    and ${orders.reservationExpiresAt} is not null and ${orders.reservationExpiresAt} <= ${now})`
}

export function assignmentIsOverdue(order: Order, now: Date) {
  return (
    order.deletedAt === null &&
    order.status === 'placed' &&
    order.assignedTo !== null &&
    order.assignedAt !== null &&
    order.reservationExpiresAt !== null &&
    order.reservationExpiresAt.getTime() <= now.getTime()
  )
}

// Lock order: workforce-role gate (7348021), routing mutex, then order/settings.
// Manual assignment and settings changes share this mutex with the allocator.
export async function lockOrderRouting(tx: Transaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(7348023)`)
}

export async function setOrderAssignee(
  tx: Transaction,
  actor: AuditActor,
  order: Order,
  assigneeId: string,
  source: 'automatic' | 'manual',
  reason: string,
) {
  const now = await databaseNow(tx)
  const people = await tx
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(
      inArray(
        user.id,
        order.assignedTo ? [assigneeId, order.assignedTo] : [assigneeId],
      ),
    )
  const names = new Map(people.map((person) => [person.id, person.name]))
  await tx
    .update(orders)
    .set({
      assignedTo: assigneeId,
      assignedAt: now,
      assignmentSource: source,
      revision: order.revision + 1,
      updatedAt: now,
    })
    .where(eq(orders.id, order.id))
  await tx
    .update(staffOrderSettings)
    .set({ lastAssignedAt: now })
    .where(eq(staffOrderSettings.userId, assigneeId))
  await appendOrderEvent(tx, actor, order.id, 'order_assigned', {
    previousAssignee: order.assignedTo,
    assignedTo: assigneeId,
    source,
    reason,
    assignedToName: names.get(assigneeId) ?? null,
    previousAssigneeName: order.assignedTo
      ? (names.get(order.assignedTo) ?? null)
      : null,
  })
}

export async function assignNextWaitingOrder() {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '3s'`)
    await tx.execute(sql`set local statement_timeout = '10s'`)
    const roleGate = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock_shared(7348021) as locked`,
    )
    if (!roleGate.rows[0]?.locked) return false
    const routingLock = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(7348023) as locked`,
    )
    if (!routingLock.rows[0]?.locked) return false
    const now = await databaseNow(tx)
    const [order] = await tx
      .select({
        ...getTableColumns(orders),
        rebalancing: sql<boolean>`coalesce(${rebalanceWorkFilter(now)}, false)`,
      })
      .from(orders)
      .where(eligibleAssignmentFilter(now))
      .orderBy(assignmentWaitingSince(now), orders.id)
      .limit(1)
      .for('update', { of: orders, skipLocked: true })
    if (!order) return false
    const workload = activeOrderCount(user.id, now)
    const [candidate] = await tx
      .select({ userId: user.id })
      .from(staffOrderSettings)
      .innerJoin(user, eq(user.id, staffOrderSettings.userId))
      .where(
        and(
          receivingStaffFilter(now),
          order.assignedTo ? ne(user.id, order.assignedTo) : undefined,
          sql`${workload} < ${staffOrderSettings.maxActiveOrders}`,
        ),
      )
      .orderBy(
        workload,
        sql`${staffOrderSettings.lastAssignedAt} asc nulls first`,
        user.id,
      )
      .limit(1)
      .for('update', { of: staffOrderSettings })
    if (!candidate) return false
    await setOrderAssignee(
      tx,
      { userId: null, role: 'system' },
      order,
      candidate.userId,
      'automatic',
      order.rebalancing
        ? 'Điều phối công việc mới quay lại vượt hạn mức sang nhân viên trong ca còn tải.'
        : order.assignedTo
          ? 'Bàn giao công việc có thể tiếp tục sau khi nhân viên tạm dừng hoặc kết thúc ca.'
          : 'Hệ thống phân công theo số đơn cần xử lý và lượt nhận gần nhất.',
    )
    return true
  })
}

function settingsValue(
  current: typeof staffOrderSettings.$inferSelect | undefined,
): StaffOrderSettingsValue {
  return {
    enabled: current?.enabled ?? false,
    acceptingOrders: current?.acceptingOrders ?? false,
    maxActiveOrders: current?.maxActiveOrders ?? DEFAULT_MAX_ACTIVE_ORDERS,
    shiftEndsAt: current?.shiftEndsAt?.toISOString() ?? null,
  }
}

function stoppedSince(
  current: typeof staffOrderSettings.$inferSelect | undefined,
  now: Date,
) {
  if (current?.unavailableSince) return current.unavailableSince
  if (!current?.acceptingOrders) return null
  return current.shiftEndsAt && current.shiftEndsAt <= now
    ? current.shiftEndsAt
    : now
}

export async function endExpiredStaffShifts() {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '3s'`)
    await tx.execute(sql`set local statement_timeout = '10s'`)
    const roleGate = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock_shared(7348021) as locked`,
    )
    if (!roleGate.rows[0]?.locked) return 0
    const routingLock = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(7348023) as locked`,
    )
    if (!routingLock.rows[0]?.locked) return 0
    const now = await databaseNow(tx)
    const expired = await tx
      .select()
      .from(staffOrderSettings)
      .where(
        and(
          eq(staffOrderSettings.acceptingOrders, true),
          sql`${staffOrderSettings.shiftEndsAt} <= ${now}`,
        ),
      )
      .orderBy(staffOrderSettings.shiftEndsAt, staffOrderSettings.userId)
      .limit(50)
      .for('update')
    for (const current of expired) {
      await tx
        .update(staffOrderSettings)
        .set({
          acceptingOrders: false,
          unavailableSince: current.shiftEndsAt,
          revision: current.revision + 1,
          updatedBy: null,
          updatedAt: now,
        })
        .where(eq(staffOrderSettings.userId, current.userId))
      await tx.insert(staffOrderSettingChanges).values({
        targetUserId: current.userId,
        actorUserId: null,
        actorType: 'system',
        previousValue: settingsValue(current),
        newValue: { ...settingsValue(current), acceptingOrders: false },
        reason:
          'Hệ thống kết thúc ca theo giờ admin đã chọn; bàn giao các đơn có thể tiếp tục xử lý.',
      })
    }
    return expired.length
  })
}

export function updateStaffOrderSettings(
  command: Command,
  targetUserId: string,
  input: StaffOrderSettingsValue & { expectedRevision: number; reason: string },
) {
  return executeCommand(
    { ...command, permission: 'admin', roleLock: 'shared' },
    async (tx, actor) => {
      await lockOrderRouting(tx)
      const [target] = await tx
        .select({ role: user.role })
        .from(user)
        .where(eq(user.id, targetUserId))
        .for('share')
      if (
        target?.role !== 'staff' ||
        env.ORDER_ADMIN_USER_IDS.includes(targetUserId)
      )
        fail(
          422,
          'INVALID_AUTO_ASSIGNEE',
          'Only staff can receive automatic assignments',
        )
      const [current] = await tx
        .select()
        .from(staffOrderSettings)
        .where(eq(staffOrderSettings.userId, targetUserId))
        .for('update')
      if ((current?.revision ?? 0) !== input.expectedRevision)
        fail(
          409,
          'ASSIGNMENT_SETTINGS_CHANGED',
          'Reload the staff assignment settings',
        )
      const now = await databaseNow(tx)
      const shiftEndsAt = input.shiftEndsAt ? new Date(input.shiftEndsAt) : null
      if (
        input.acceptingOrders &&
        (!shiftEndsAt ||
          shiftEndsAt <= now ||
          shiftEndsAt.getTime() > now.getTime() + 24 * 60 * 60_000)
      )
        fail(422, 'INVALID_SHIFT_END', 'Shift must end in the next 24 hours')
      const previousValue = settingsValue(current)
      const newValue: StaffOrderSettingsValue = {
        enabled: input.enabled,
        acceptingOrders: input.acceptingOrders,
        maxActiveOrders: input.maxActiveOrders,
        shiftEndsAt: shiftEndsAt?.toISOString() ?? null,
      }
      if (
        previousValue.enabled === newValue.enabled &&
        previousValue.acceptingOrders === newValue.acceptingOrders &&
        previousValue.maxActiveOrders === newValue.maxActiveOrders &&
        previousValue.shiftEndsAt === newValue.shiftEndsAt
      )
        return { userId: targetUserId, revision: current?.revision ?? 0 }
      const revision = (current?.revision ?? 0) + 1
      const values = {
        ...newValue,
        shiftEndsAt,
        capacityChangedAt:
          current && current.maxActiveOrders === input.maxActiveOrders
            ? current.capacityChangedAt
            : now,
        unavailableSince: input.acceptingOrders
          ? null
          : stoppedSince(current, now),
        revision,
        updatedBy: actor.userId,
        updatedAt: now,
      }
      await tx
        .insert(staffOrderSettings)
        .values({
          userId: targetUserId,
          ...values,
          lastAssignedAt: current
            ? current.lastAssignedAt
            : sql`(select max(${orderEvents.createdAt}) from ${orderEvents}
                where ${orderEvents.type} = 'order_assigned'
                  and ${orderEvents.details}->>'assignedTo' = ${targetUserId})`,
        })
        .onConflictDoUpdate({
          target: staffOrderSettings.userId,
          set: values,
        })
      await tx.insert(staffOrderSettingChanges).values({
        targetUserId,
        actorUserId: actor.userId,
        previousValue,
        newValue,
        reason: input.reason,
      })
      return { userId: targetUserId, revision }
    },
  )
}

export async function disableStaffOrderSettings(
  tx: Transaction,
  actor: Actor,
  targetUserId: string,
  reason: string,
) {
  const [current] = await tx
    .select()
    .from(staffOrderSettings)
    .where(eq(staffOrderSettings.userId, targetUserId))
    .for('update')
  if (!current) return
  const now = await databaseNow(tx)
  await tx
    .update(staffOrderSettings)
    .set({
      enabled: false,
      acceptingOrders: false,
      unavailableSince: stoppedSince(current, now) ?? now,
      revision: current.revision + 1,
      updatedBy: actor.userId,
      updatedAt: now,
    })
    .where(eq(staffOrderSettings.userId, targetUserId))
  await tx.insert(staffOrderSettingChanges).values({
    targetUserId,
    actorUserId: actor.userId,
    previousValue: settingsValue(current),
    newValue: {
      enabled: false,
      acceptingOrders: false,
      maxActiveOrders: current.maxActiveOrders,
      shiftEndsAt: current.shiftEndsAt?.toISOString() ?? null,
    },
    reason,
  })
}

export async function getStaffShift(userId: string) {
  return db.transaction(
    async (tx) => {
      const actor = await resolveActor(tx, userId, 'staff')
      const now = await databaseNow(tx)
      const serverTime = now.toISOString()
      if (actor.role !== 'staff')
        return { serverTime, settings: null, latestShift: null }
      const [status] = await tx
        .select({
          settings: {
            enabled: staffOrderSettings.enabled,
            acceptingOrders: staffOrderSettings.acceptingOrders,
            maxActiveOrders: staffOrderSettings.maxActiveOrders,
            shiftEndsAt: staffOrderSettings.shiftEndsAt,
          },
          receivingNow: sql<boolean>`coalesce(${receivingStaffFilter(now)}, false)`,
          activeOrders: activeOrderCount(user.id, now),
        })
        .from(user)
        .leftJoin(staffOrderSettings, eq(staffOrderSettings.userId, user.id))
        .where(eq(user.id, actor.userId))
      if (!status) fail(404, 'USER_NOT_FOUND', 'Staff member was not found')

      // Keep the actual start time stable across capacity/end-time edits.
      const [activation] = await tx
        .select({
          createdAt: staffOrderSettingChanges.createdAt,
        })
        .from(staffOrderSettingChanges)
        .where(
          and(
            eq(staffOrderSettingChanges.targetUserId, actor.userId),
            sql`${staffOrderSettingChanges.newValue}->>'enabled' = 'true'`,
            sql`${staffOrderSettingChanges.newValue}->>'acceptingOrders' = 'true'`,
            sql`(${staffOrderSettingChanges.newValue}->>'shiftEndsAt')::timestamptz > ${staffOrderSettingChanges.createdAt}`,
            sql`(
              ${staffOrderSettingChanges.previousValue}->>'enabled' is distinct from 'true'
              or ${staffOrderSettingChanges.previousValue}->>'acceptingOrders' is distinct from 'true'
              or ${staffOrderSettingChanges.previousValue}->>'shiftEndsAt' is null
              or (${staffOrderSettingChanges.previousValue}->>'shiftEndsAt')::timestamptz <= ${staffOrderSettingChanges.createdAt}
            )`,
          ),
        )
        .orderBy(
          desc(staffOrderSettingChanges.createdAt),
          desc(staffOrderSettingChanges.id),
        )
        .limit(1)
      return {
        serverTime,
        settings: {
          enabled: status.settings?.enabled ?? false,
          acceptingOrders: status.settings?.acceptingOrders ?? false,
          maxActiveOrders:
            status.settings?.maxActiveOrders ?? DEFAULT_MAX_ACTIVE_ORDERS,
          shiftEndsAt: status.settings?.shiftEndsAt?.toISOString() ?? null,
          receivingNow: status.receivingNow,
          activeOrders: status.activeOrders,
        },
        latestShift: activation
          ? {
              startedAt: activation.createdAt.toISOString(),
            }
          : null,
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

export async function getOrderAssignmentSummary(userId: string) {
  return db.transaction(
    async (tx) => {
      await resolveActor(tx, userId, 'admin')
      const now = await databaseNow(tx)
      const [queue] = await tx
        .select({
          pendingOrders: sql<number>`count(*) filter (where ${assignmentQueueFilter(now)})::int`,
          eligibleOrders: sql<number>`count(*) filter (where ${eligibleAssignmentFilter(now)})::int`,
          overdueAssignments: sql<number>`count(*) filter (where ${overdueAssignmentFilter(now)})::int`,
          waitingOverdueOrders: sql<number>`count(*) filter (where ${overdueWaitingFilter(now)})::int`,
          deadlineAtRiskOrders: sql<number>`count(*) filter (where ${assignmentDeadlineWarningFilter(now)})::int`,
          handoverOrders: sql<number>`count(*) filter (where ${handoverWorkFilter(now)})::int`,
          rebalanceOrders: sql<number>`count(*) filter (where ${rebalanceWorkFilter(now)})::int`,
          handoverReviewOrders: sql<number>`count(*) filter (where ${handoverReviewFilter(now)})::int`,
          blockedPaymentOrders: sql<number>`count(*) filter (where ${blockedPaymentWorkFilter(now)})::int`,
        })
        .from(orders)
      const oldestWaitingOrders = await tx
        .select({
          id: orders.id,
          code: orders.code,
          reservationExpiresAt: orders.reservationExpiresAt,
          ...assignmentQueueColumns(now),
        })
        .from(orders)
        .where(assignmentQueueFilter(now))
        .orderBy(assignmentWaitingSince(now), orders.id)
        .limit(5)
      const workload = activeOrderCount(user.id, now)
      const capacityLimit = sql<number>`coalesce(${staffOrderSettings.maxActiveOrders}, ${DEFAULT_MAX_ACTIVE_ORDERS})`
      const [capacity] = await tx
        .select({
          overloadedStaff: sql<number>`count(*) filter (where ${workload} > ${capacityLimit})::int`,
          overCapacityOrders: sql<number>`coalesce(sum(greatest(${workload} - ${capacityLimit}, 0)), 0)::int`,
        })
        .from(user)
        .leftJoin(staffOrderSettings, eq(user.id, staffOrderSettings.userId))
        .where(
          and(
            eq(user.role, 'staff'),
            env.ORDER_ADMIN_USER_IDS.length
              ? notInArray(user.id, env.ORDER_ADMIN_USER_IDS)
              : undefined,
          ),
        )
      const [staff] = await tx
        .select({
          receivingStaff: sql<number>`count(*)::int`,
          availableStaff: sql<number>`count(*) filter (where ${workload} < ${staffOrderSettings.maxActiveOrders})::int`,
        })
        .from(staffOrderSettings)
        .innerJoin(user, eq(user.id, staffOrderSettings.userId))
        .where(receivingStaffFilter(now))
      return {
        pendingOrders: queue?.pendingOrders ?? 0,
        eligibleOrders: queue?.eligibleOrders ?? 0,
        overdueAssignments: queue?.overdueAssignments ?? 0,
        waitingOverdueOrders: queue?.waitingOverdueOrders ?? 0,
        deadlineAtRiskOrders: queue?.deadlineAtRiskOrders ?? 0,
        handoverOrders: queue?.handoverOrders ?? 0,
        rebalanceOrders: queue?.rebalanceOrders ?? 0,
        overloadedStaff: capacity?.overloadedStaff ?? 0,
        overCapacityOrders: capacity?.overCapacityOrders ?? 0,
        handoverReviewOrders: queue?.handoverReviewOrders ?? 0,
        blockedPaymentOrders: queue?.blockedPaymentOrders ?? 0,
        oldestWaitingOrders,
        receivingStaff: staff?.receivingStaff ?? 0,
        availableStaff: staff?.availableStaff ?? 0,
        queueSlaMinutes: env.ORDER_ASSIGNMENT_QUEUE_SLA_MINUTES,
        deadlineWarningMinutes: env.ORDER_ASSIGNMENT_DEADLINE_WARNING_MINUTES,
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}
