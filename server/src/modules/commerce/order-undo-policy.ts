import { eq, sql } from 'drizzle-orm'
import { env } from '../../config/env.js'
import {
  codCollections,
  collectionDecisions,
  type orderEvents,
  orders,
  paymentAllocations,
  paymentBalanceReviews,
  payments,
  refunds,
  returnLines,
  returnReceipts,
  returns,
  type shipments,
  stockMovements,
} from '../../db/schema.js'
import { fail, type Order, type Transaction } from './commerce.persistence.js'
import type { Actor } from './commerce.types.js'
import type { OrderFinancials } from './payment-ledger.js'

type Shipment = typeof shipments.$inferSelect
type OrderEvent = typeof orderEvents.$inferSelect
type DeliveryStatus = 'in_transit' | 'delivery_failed'

function previousDeliveryStatus(
  shipment: Shipment | null,
  events: OrderEvent[],
): DeliveryStatus | null {
  if (shipment?.status !== 'delivered') return null
  const shipmentEvents = events.filter(
    (event) =>
      event.createdAt >= shipment.createdAt &&
      (!event.details.shipmentId || event.details.shipmentId === shipment.id),
  )
  const acknowledgement = shipmentEvents
    .slice()
    .reverse()
    .find(
      (event) =>
        event.type === 'shipment_delivered' &&
        event.details.proofReference === shipment.proofReference &&
        event.details.deliveredAt === shipment.deliveredAt?.toISOString(),
    )
  if (!acknowledgement) return null
  const previousStatus = acknowledgement.details.previousShipmentStatus
  if (previousStatus === 'in_transit' || previousStatus === 'delivery_failed')
    return previousStatus

  // Older acknowledgements did not store the prior status. Recover it only
  // from the active shipment's recorded handover/failure/retry history.
  const previous = shipmentEvents
    .slice(0, shipmentEvents.indexOf(acknowledgement))
    .reverse()
    .find((event) =>
      [
        'shipment_handed_over',
        'delivery_failed',
        'delivery_retry_started',
      ].includes(event.type),
    )
  if (previous?.type === 'delivery_failed') return 'delivery_failed'
  if (previous?.type === 'delivery_retry_started') return 'in_transit'
  if (
    previous?.type === 'shipment_handed_over' &&
    shipment.failedAttempts === 0
  )
    return 'in_transit'
  return null
}

export async function readOrderUndoFacts(
  tx: Transaction,
  order: Order,
  shipment: Shipment | null,
  events: OrderEvent[],
  payment: OrderFinancials,
) {
  // Closing an approved request can mean no goods were ever received. Inactive
  // requests do not block correction; receipt and inventory facts still do.
  const returnActivity = sql`exists (
    select 1 from ${returns}
    where ${returns.orderId} = ${order.id}
      and (
        ${returns.status} not in ('withdrawn', 'rejected', 'closed')
        or exists (select 1 from ${returnReceipts} where ${returnReceipts.returnId} = ${returns.id})
        or exists (select 1 from ${returnLines} where ${returnLines.returnId} = ${returns.id} and (${returnLines.receivedQuantity} > 0 or ${returnLines.restockedQuantity} > 0))
      )
  ) or exists (select 1 from ${stockMovements} where ${stockMovements.orderId} = ${order.id} and ${stockMovements.kind} = 'return')`
  const [activity] = await tx
    .select({
      afterSaleActivity: sql<boolean>`${returnActivity} or exists (select 1 from ${refunds} where ${refunds.orderId} = ${order.id})`,
      financialDecisions: sql<boolean>`exists (select 1 from ${collectionDecisions} where ${collectionDecisions.orderId} = ${order.id}) or exists (select 1 from ${paymentBalanceReviews} where ${paymentBalanceReviews.orderId} = ${order.id})`,
      receipts: sql<boolean>`exists (select 1 from ${payments} where ${payments.orderId} = ${order.id}) or exists (select 1 from ${paymentAllocations} where ${paymentAllocations.orderId} = ${order.id})`,
      carrierCollections: sql<boolean>`exists (select 1 from ${codCollections} where ${codCollections.orderId} = ${order.id})`,
    })
    .from(orders)
    .where(eq(orders.id, order.id))
  if (!activity) fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
  const expiry = events.find((event) => event.type === 'order_placed')?.details
    .reservationExpiresAt
  const originalExpiry = typeof expiry === 'string' ? new Date(expiry) : null
  const originalReservationExpiresAt =
    originalExpiry && Number.isFinite(originalExpiry.getTime())
      ? originalExpiry
      : null
  let confirmationExpiresAt = originalReservationExpiresAt
  for (const event of events) {
    const renewal = event.details.confirmationRenewal
    if (
      !confirmationExpiresAt ||
      event.type !== 'order_step_undone' ||
      event.details.action !== 'confirmation' ||
      event.details.actorRole !== 'admin' ||
      !renewal ||
      typeof renewal !== 'object' ||
      Array.isArray(renewal) ||
      renewal.approvedBy !== event.actorUserId ||
      renewal.previousExpiresAt !== confirmationExpiresAt.toISOString() ||
      typeof renewal.expiresAt !== 'string' ||
      renewal.expiresAt !== event.details.reservationExpiresAt
    )
      continue
    const renewedExpiry = new Date(renewal.expiresAt)
    if (
      Number.isFinite(renewedExpiry.getTime()) &&
      renewedExpiry > confirmationExpiresAt
    )
      confirmationExpiresAt = renewedExpiry
  }
  return {
    ...activity,
    shipment,
    balancesVerified: payment.balancesVerified,
    bankPaymentApproved: payment.bankPaymentApproved,
    originalReservationExpiresAt,
    confirmationExpiresAt,
    previousShipmentStatus: previousDeliveryStatus(shipment, events),
  }
}

type UndoFacts = Awaited<ReturnType<typeof readOrderUndoFacts>>

function undoTransition(order: Order) {
  switch (order.status) {
    case 'confirmed':
      return { action: 'confirmation', targetStatus: 'placed' } as const
    case 'packing':
      return { action: 'packing', targetStatus: 'confirmed' } as const
    case 'shipped':
      return { action: 'handover', targetStatus: 'packing' } as const
    case 'delivered':
    case 'completed':
      return { action: 'delivery', targetStatus: 'shipped' } as const
    default:
      return null
  }
}

export function orderUndoPolicy(
  actor: Actor,
  order: Order,
  facts: UndoFacts,
  now: Date,
) {
  const transition = undoTransition(order)
  if (!transition) return null
  const requiresPhysicalEvidence = ['handover', 'delivery'].includes(
    transition.action,
  )
  const isCodConfirmation =
    transition.action === 'confirmation' && order.paymentMethod === 'cod'
  const requiresConfirmationRenewal = Boolean(
    isCodConfirmation &&
      facts.confirmationExpiresAt &&
      facts.confirmationExpiresAt <= now,
  )
  const requiresAdmin = requiresPhysicalEvidence || requiresConfirmationRenewal
  const hasCollectionFailures =
    order.collectionFailureCount > 0 ||
    order.carrierCollectionFailureCount > 0 ||
    order.collectionIssueReason !== null ||
    order.carrierCollectionIssueReason !== null
  const collectionFailuresToCorrect =
    transition.action === 'delivery' &&
    order.paymentMethod === 'cod' &&
    hasCollectionFailures
      ? {
          customer: order.collectionFailureCount,
          carrier: order.carrierCollectionFailureCount,
        }
      : null
  const blockedReason = (() => {
    if (order.deletedAt) return 'ORDER_UNDO_DELETED'
    if (actor.role !== 'admin' && actor.role !== 'staff')
      return 'STAFF_ACCESS_REQUIRED'
    if (actor.role === 'staff' && order.assignedTo !== actor.userId)
      return 'ORDER_ASSIGNED_ELSEWHERE'
    if (requiresPhysicalEvidence && actor.role !== 'admin')
      return 'ORDER_UNDO_ADMIN_REQUIRED'
    if (!order.assignedTo) return 'ASSIGNMENT_REQUIRED'
    if (facts.afterSaleActivity) return 'ORDER_UNDO_AFTER_SALE_ACTIVITY'
    if (
      facts.financialDecisions ||
      facts.carrierCollections ||
      (order.paymentMethod === 'cod' && facts.receipts) ||
      order.collectionResolution !== 'open' ||
      order.carrierCollectionResolution !== 'open'
    )
      return 'ORDER_UNDO_FINANCIAL_ACTIVITY'
    // Only the administrator's correction of an invalid COD delivery may
    // reset its dependent failed-collection projection. Cash and decisions
    // above remain independent facts and cannot be undone through this path.
    if (hasCollectionFailures && !collectionFailuresToCorrect)
      return 'ORDER_UNDO_STATE_MISMATCH'
    if (!facts.balancesVerified) return 'ORDER_UNDO_RECONCILIATION_REQUIRED'
    if (order.reservationExpiresAt && order.reservationExpiresAt <= now)
      return 'ORDER_UNDO_RESERVATION_EXPIRED'

    if (!requiresPhysicalEvidence) {
      if (order.stockState !== 'reserved' || facts.shipment)
        return 'ORDER_UNDO_STATE_MISMATCH'
      if (
        transition.action === 'confirmation' &&
        order.paymentMethod === 'cod'
      ) {
        if (!facts.originalReservationExpiresAt)
          return 'ORDER_UNDO_HISTORY_REQUIRED'
        if (requiresConfirmationRenewal && actor.role !== 'admin')
          return 'ORDER_UNDO_CONFIRMATION_EXPIRED'
      }
      return null
    }
    if (order.stockState !== 'committed' || !facts.shipment)
      return 'ORDER_UNDO_STATE_MISMATCH'
    if (transition.action === 'handover') {
      if (
        facts.shipment.status !== 'in_transit' ||
        facts.shipment.failedAttempts !== 0
      )
        return 'ORDER_UNDO_SHIPMENT_ACTIVITY'
    } else {
      if (facts.shipment.status !== 'delivered')
        return 'ORDER_UNDO_STATE_MISMATCH'
      if (!facts.previousShipmentStatus) return 'ORDER_UNDO_HISTORY_REQUIRED'
      if (order.paymentMethod === 'bank_transfer' && !facts.bankPaymentApproved)
        return 'ORDER_UNDO_FINANCIAL_ACTIVITY'
    }
    return null
  })()
  return {
    ...transition,
    allowed: blockedReason === null,
    blockedReason,
    requiresAdmin,
    requiresEvidence: requiresPhysicalEvidence,
    requiresConfirmationRenewal,
    maxConfirmationRenewalHours: isCodConfirmation
      ? env.ORDER_COD_CONFIRMATION_HOURS
      : null,
    collectionFailuresToCorrect,
    confirmationExpiresAt: isCodConfirmation
      ? (facts.confirmationExpiresAt?.toISOString() ?? null)
      : null,
    originalConfirmationExpiresAt: isCodConfirmation
      ? (facts.originalReservationExpiresAt?.toISOString() ?? null)
      : null,
  }
}
