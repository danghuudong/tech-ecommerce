import { eq } from 'drizzle-orm'
import { paymentBalanceReviews } from '../../db/schema.js'
import {
  appendOrderEvent,
  databaseNow,
  fail,
  type Order,
  type Transaction,
} from './commerce.persistence.js'
import type { AuditActor } from './commerce.types.js'
import type { OrderFinancials } from './payment-ledger.js'

export function refundDiscrepancyDisposition(
  review: typeof paymentBalanceReviews.$inferSelect | undefined,
  discrepancyVnd: number,
  recoveredVnd: number,
  paidVnd = 0,
) {
  const approvedRemainingVnd = review?.disposition
    ? Math.max(
        0,
        review.approvedAmountVnd -
          Math.max(0, recoveredVnd - review.recoveredVndAtDecision) -
          Math.max(0, paidVnd - review.paidVndAtDecision),
      )
    : 0
  const coveredVnd = Math.min(discrepancyVnd, approvedRemainingVnd)
  return {
    debtVnd: review?.disposition === 'debt' ? coveredVnd : 0,
    writtenOffVnd: review?.disposition === 'written_off' ? coveredVnd : 0,
    unresolvedVnd: discrepancyVnd - coveredVnd,
  }
}

// Every caller holds the order lock. Settlement facts remain immutable; this is
// the durable admin obligation derived from verified cash and current attribution.
export async function syncPaymentBalanceReview(
  tx: Transaction,
  actor: AuditActor,
  order: Order,
  summary: OrderFinancials,
) {
  if (!summary.balancesVerified) return
  const [existing] = await tx
    .select()
    .from(paymentBalanceReviews)
    .where(eq(paymentBalanceReviews.orderId, order.id))
  const discrepancyVnd = summary.balanceDiscrepancyVnd
  const purchaseShortfallVnd = summary.postDeliveryShortfallVnd
  if (!existing && discrepancyVnd === 0) return
  const status =
    discrepancyVnd === 0
      ? 'resolved'
      : summary.balanceDiscrepancy.unresolvedVnd > 0
        ? 'needs_review'
        : summary.balanceDiscrepancy.debtVnd > 0
          ? 'debt'
          : 'written_off'
  if (
    existing?.discrepancyVnd === discrepancyVnd &&
    existing.purchaseShortfallVnd === purchaseShortfallVnd &&
    existing.status === status
  )
    return
  const now = await databaseNow(tx)
  const [review] = existing
    ? await tx
        .update(paymentBalanceReviews)
        .set({
          discrepancyVnd,
          purchaseShortfallVnd,
          status,
          revision: existing.revision + 1,
          updatedAt: now,
          resolvedAt: status === 'resolved' ? now : null,
          ...(status === 'resolved'
            ? {
                disposition: null,
                approvedAmountVnd: 0,
                recoveredVndAtDecision: 0,
                paidVndAtDecision: 0,
                allowFulfillment: false,
              }
            : {}),
        })
        .where(eq(paymentBalanceReviews.id, existing.id))
        .returning()
    : await tx
        .insert(paymentBalanceReviews)
        .values({
          orderId: order.id,
          discrepancyVnd,
          purchaseShortfallVnd,
          status,
        })
        .returning()
  if (!review)
    fail(
      503,
      'PAYMENT_REVIEW_UNAVAILABLE',
      'Payment balance review could not be recorded',
    )
  await appendOrderEvent(
    tx,
    actor,
    order.id,
    !existing
      ? 'payment_balance_review_opened'
      : status === 'resolved'
        ? 'payment_balance_review_resolved'
        : 'payment_balance_review_updated',
    {
      reviewId: review.id,
      previousDiscrepancyVnd: existing?.discrepancyVnd ?? 0,
      discrepancyVnd,
      refundDiscrepancyVnd: summary.refundDiscrepancyVnd,
      purchaseShortfallVnd,
      paidVnd: summary.paidVnd,
      status,
      refundedVnd: summary.refundedVnd,
      recoveredRefundVnd: summary.recoveredRefundVnd,
      reason: 'Verified cash and refund entitlement were reconciled',
    },
  )
}
