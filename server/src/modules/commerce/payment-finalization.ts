import { eq } from 'drizzle-orm'
import { orders } from '../../db/schema.js'
import {
  appendOrderEvent,
  databaseNow,
  fail,
  type Order,
  type Transaction,
} from './commerce.persistence.js'
import type { Actor } from './commerce.types.js'
import {
  completeDelivery,
  paymentSummaryForOrder,
  refreshCodOrderFinancials,
  refundOverpayment,
  refundUnallocatedPayment,
} from './payment-ledger.js'
import { expireOrderReservation } from './reservation.service.js'

export async function finalizeReceipt(
  tx: Transaction,
  actor: Actor,
  order: Order,
) {
  if (order.paymentMethod === 'cod')
    return refreshCodOrderFinancials(tx, actor, order)
  const summary = await paymentSummaryForOrder(tx, order)
  const now = await databaseNow(tx)
  // Clearing an expired hold resumes staff work here; expiry reconciliation
  // will already see a null deadline. Use verification time, not receipt time.
  const resumesStaffWork =
    summary.bankPaymentApproved &&
    order.stockState === 'reserved' &&
    ['placed', 'confirmed', 'packing'].includes(order.status) &&
    order.reservationExpiresAt !== null &&
    order.reservationExpiresAt <= now
  const restoreDeadline =
    order.stockState === 'reserved' &&
    !summary.bankPaymentApproved &&
    order.reservationExpiresAt === null
      ? order.paymentDeadlineAt
      : null
  const [updated] = await tx
    .update(orders)
    .set({
      reservationExpiresAt: summary.bankPaymentApproved
        ? null
        : (order.reservationExpiresAt ?? restoreDeadline),
      staffWorkStartedAt: resumesStaffWork ? now : order.staffWorkStartedAt,
      paymentReviewRequiredAt: summary.bankPaymentApproved
        ? null
        : order.paymentReviewRequiredAt,
      ...(!summary.latePaymentAccepted
        ? {
            latePaymentAcceptedAt: null,
            latePaymentAcceptedBy: null,
            latePaymentAcceptedFingerprint: null,
          }
        : {}),
      revision: order.revision + 1,
      updatedAt: now,
    })
    .where(eq(orders.id, order.id))
    .returning()
  if (!updated) fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
  if (order.latePaymentAcceptedAt && !summary.latePaymentAccepted) {
    await appendOrderEvent(
      tx,
      actor,
      order.id,
      'late_payment_approval_invalidated',
      {
        reason: 'The receipt evidence used for approval changed',
        previousAcceptedAt: order.latePaymentAcceptedAt.toISOString(),
        stockHeld: order.stockState === 'reserved',
      },
    )
  }
  const reconciled =
    updated.stockState === 'reserved'
      ? await expireOrderReservation(tx, updated, now)
      : updated
  if (reconciled.status === 'cancelled')
    await refundUnallocatedPayment(tx, actor, reconciled, 'cancellation')
  else await refundOverpayment(tx, actor, reconciled)
  await completeDelivery(tx, actor, reconciled)
  return summary
}
