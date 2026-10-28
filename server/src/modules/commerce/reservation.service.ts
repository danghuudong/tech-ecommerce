import { eq } from 'drizzle-orm'
import { env } from '../../config/env.js'
import { orders } from '../../db/schema.js'
import {
  appendOrderEvent,
  databaseNow,
  fail,
  getOrderItems,
  type Order,
  type Transaction,
} from './commerce.persistence.js'
import type { AuditActor } from './commerce.types.js'
import { changeStock } from './inventory.service.js'
import {
  paymentSummaryForOrder,
  refundUnallocatedPayment,
} from './payment-ledger.js'

export const systemActor: AuditActor = { userId: null, role: 'system' }

export function reservationDeadline(method: Order['paymentMethod'], now: Date) {
  const durationMs =
    method === 'bank_transfer'
      ? env.ORDER_BANK_RESERVATION_MINUTES * 60_000
      : env.ORDER_COD_CONFIRMATION_HOURS * 3_600_000
  return new Date(now.getTime() + durationMs)
}

export function bankReviewState(order: Order, now: Date) {
  const required =
    order.paymentMethod === 'bank_transfer' &&
    order.stockState === 'reserved' &&
    order.reservationExpiresAt !== null &&
    order.reservationExpiresAt <= now
  const overdue =
    required &&
    order.paymentReviewDueAt !== null &&
    order.paymentReviewDueAt <= now
  const adminResponsible = overdue || order.paymentReviewEscalatedAt !== null
  return {
    required,
    overdue,
    dueAt: order.paymentReviewDueAt,
    escalatedAt: order.paymentReviewEscalatedAt,
    responsibleRole: required
      ? adminResponsible
        ? 'admin'
        : 'accountant'
      : null,
    responsibleUserId: null,
  }
}

export async function assertReservationActive(tx: Transaction, order: Order) {
  if (
    order.reservationExpiresAt &&
    order.reservationExpiresAt <= (await databaseNow(tx))
  )
    fail(
      409,
      'RESERVATION_EXPIRED',
      'The stock reservation deadline has passed',
    )
}

export async function cancelReservedOrder(
  tx: Transaction,
  actor: AuditActor,
  order: Order,
  reason: string,
  now: Date,
  cause: 'requested' | 'bank_reconciled' = 'requested',
) {
  if (
    bankReviewState(order, now).required &&
    cause !== 'bank_reconciled' &&
    actor.userId !== order.userId
  )
    fail(
      409,
      'BANK_RECONCILIATION_REQUIRED',
      'Reconcile the expired bank payment before cancelling on behalf of the store',
    )
  if (
    order.stockState !== 'reserved' ||
    !['placed', 'confirmed', 'packing'].includes(order.status)
  )
    fail(409, 'CANCELLATION_CLOSED', 'Cancellation is closed after handover')
  for (const item of await getOrderItems(tx, order.id))
    await changeStock(tx, actor, {
      productId: item.productId,
      orderId: order.id,
      kind: 'release',
      onHandDelta: 0,
      reservedDelta: -item.quantity,
      reason,
      reference: order.id,
    })
  const [cancelled] = await tx
    .update(orders)
    .set({
      status: 'cancelled',
      stockState: 'released',
      reservationExpiresAt: null,
      paymentReviewRequiredAt: null,
      cancellationReason: reason,
      cancelledAt: now,
      revision: order.revision + 1,
      updatedAt: now,
    })
    .where(eq(orders.id, order.id))
    .returning()
  if (!cancelled) fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
  await refundUnallocatedPayment(tx, actor, cancelled, 'cancellation')
  const payment = await paymentSummaryForOrder(tx, cancelled)
  await appendOrderEvent(tx, actor, order.id, 'order_cancelled', {
    reason,
    balancesVerified: payment.balancesVerified,
    refundRequired: payment.balancesVerified ? payment.refundDueVnd > 0 : null,
    automatic: actor.role === 'system',
  })
  return cancelled
}

export async function expireOrderReservation(
  tx: Transaction,
  order: Order,
  now: Date,
) {
  if (!order.reservationExpiresAt || order.reservationExpiresAt > now)
    return order
  const payment = await paymentSummaryForOrder(tx, order)
  if (order.paymentMethod === 'bank_transfer') {
    const review = bankReviewState(order, now)
    const escalate =
      !payment.bankPaymentApproved &&
      review.overdue &&
      order.paymentReviewEscalatedAt === null
    if (
      order.paymentReviewRequiredAt &&
      !payment.bankPaymentApproved &&
      !escalate
    )
      return order
    const [updated] = await tx
      .update(orders)
      .set({
        reservationExpiresAt: payment.bankPaymentApproved
          ? null
          : order.reservationExpiresAt,
        staffWorkStartedAt: payment.bankPaymentApproved
          ? now
          : order.staffWorkStartedAt,
        paymentReviewRequiredAt: payment.bankPaymentApproved
          ? null
          : (order.paymentReviewRequiredAt ?? now),
        paymentReviewEscalatedAt: escalate
          ? now
          : order.paymentReviewEscalatedAt,
        updatedAt: now,
        revision: order.revision + 1,
      })
      .where(eq(orders.id, order.id))
      .returning()
    if (!updated) fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
    if (!order.paymentReviewRequiredAt || payment.bankPaymentApproved)
      await appendOrderEvent(
        tx,
        systemActor,
        order.id,
        payment.bankPaymentApproved
          ? 'payment_deadline_satisfied'
          : 'bank_statement_review_required',
        {
          deadline: order.paymentDeadlineAt?.toISOString() ?? null,
          reviewDueAt: order.paymentReviewDueAt?.toISOString() ?? null,
          responsibleRole: review.responsibleRole,
          responsibleUserId: review.responsibleUserId,
          balancesVerified: payment.balancesVerified,
          onTimeReceivedVnd: payment.balancesVerified
            ? payment.onTimePaidVnd
            : null,
          stockHeld: true,
          refundLossFulfillmentApproved: payment.refundLossFulfillmentApproved,
          latePaymentAccepted: payment.latePaymentAccepted,
        },
      )
    if (escalate)
      await appendOrderEvent(
        tx,
        systemActor,
        order.id,
        'bank_statement_review_escalated',
        {
          deadline: order.paymentDeadlineAt?.toISOString() ?? null,
          reviewDueAt: order.paymentReviewDueAt?.toISOString() ?? null,
          previousAssignee: order.assignedTo,
          responsibleRole: 'admin',
          stockHeld: true,
        },
      )
    return updated
  }
  const cancelled = await cancelReservedOrder(
    tx,
    systemActor,
    order,
    'COD confirmation deadline expired',
    now,
  )
  await appendOrderEvent(
    tx,
    systemActor,
    order.id,
    'order_reservation_expired',
    {
      expiredAt: order.reservationExpiresAt.toISOString(),
    },
  )
  return cancelled
}
