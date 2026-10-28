import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../config/db.js'
import {
  orders,
  paymentBalanceReviewDecisions,
  paymentBalanceReviews,
} from '../../db/schema.js'
import type {
  PaymentAllocationInput,
  PaymentBalanceReviewDecisionInput,
  RefundRecoveryReceiptInput,
} from './commerce.contracts.js'
import {
  appendOrderEvent,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  lockOrder,
  resolveActor,
  type Transaction,
} from './commerce.persistence.js'
import { syncPaymentBalanceReview } from './payment-balance-review.js'
import { finalizeReceipt } from './payment-finalization.js'
import {
  assertFinancialsVerified,
  paymentSummaryForOrder,
  readOrderFinancials,
} from './payment-ledger.js'
import { createReceiptInTransaction } from './payment-receipt.service.js'
import { lockMerchantReceiptIdentity } from './receiving-account.service.js'

export type PaymentReviewListInput = {
  limit: number
  offset: number
  status?: typeof paymentBalanceReviews.$inferSelect.status | undefined
}

export function listPaymentBalanceReviews(
  userId: string,
  input: PaymentReviewListInput,
) {
  return db.transaction(
    async (tx) => {
      await resolveActor(tx, userId, 'admin')
      const records = await tx
        .select({ review: paymentBalanceReviews, order: orders })
        .from(paymentBalanceReviews)
        .innerJoin(orders, eq(orders.id, paymentBalanceReviews.orderId))
        .where(
          input.status
            ? eq(paymentBalanceReviews.status, input.status)
            : eq(paymentBalanceReviews.status, 'needs_review'),
        )
        .orderBy(paymentBalanceReviews.updatedAt, paymentBalanceReviews.id)
        .limit(input.limit)
        .offset(input.offset)
      const summaries = await readOrderFinancials(
        tx,
        records.map((row) => row.order),
      )
      return {
        items: records.map(({ review, order }) => {
          const summary = summaries.get(order.id)
          if (!summary)
            fail(
              503,
              'PAYMENT_LEDGER_UNAVAILABLE',
              'Payment ledger is unavailable',
            )
          return {
            orderCode: order.code,
            review: {
              ...review,
              discrepancyVnd: summary.balancesVerified
                ? summary.balanceDiscrepancyVnd
                : null,
              purchaseShortfallVnd: summary.balancesVerified
                ? summary.postDeliveryShortfallVnd
                : null,
            },
            assignedTo: order.assignedTo,
            balancesVerified: summary.balancesVerified,
            discrepancyVnd: summary.balancesVerified
              ? summary.balanceDiscrepancyVnd
              : null,
            purchaseShortfallVnd: summary.balancesVerified
              ? summary.postDeliveryShortfallVnd
              : null,
            refundDiscrepancyVnd: summary.balancesVerified
              ? summary.refundDiscrepancyVnd
              : null,
            paidVnd: summary.paidVnd,
            fulfillmentPaymentSatisfied: summary.fulfillmentPaymentSatisfied,
            refundLossFulfillmentEligible:
              summary.refundLossFulfillmentEligible,
            refundLossFulfillmentApproved:
              summary.refundLossFulfillmentApproved,
            paymentMethod: order.paymentMethod,
            refundedVnd: summary.refundedVnd,
            recoveredRefundVnd: summary.recoveredRefundVnd,
            debtVnd: summary.balancesVerified
              ? summary.balanceDiscrepancy.debtVnd
              : null,
            writtenOffVnd: summary.balancesVerified
              ? summary.balanceDiscrepancy.writtenOffVnd
              : null,
            unresolvedVnd: summary.balancesVerified
              ? summary.balanceDiscrepancy.unresolvedVnd
              : null,
          }
        }),
        ...input,
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

export function getPaymentBalanceReview(userId: string, reviewId: string) {
  return db.transaction(
    async (tx) => {
      await resolveActor(tx, userId, 'admin')
      const [review] = await tx
        .select()
        .from(paymentBalanceReviews)
        .where(eq(paymentBalanceReviews.id, reviewId))
      if (!review)
        fail(404, 'PAYMENT_REVIEW_NOT_FOUND', 'Payment review was not found')
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, review.orderId))
      if (!order) fail(404, 'ORDER_NOT_FOUND', 'Review order was not found')
      const summary = await paymentSummaryForOrder(tx, order)
      return {
        orderCode: order.code,
        review: {
          ...review,
          discrepancyVnd: summary.balancesVerified
            ? summary.balanceDiscrepancyVnd
            : null,
          purchaseShortfallVnd: summary.balancesVerified
            ? summary.postDeliveryShortfallVnd
            : null,
        },
        balancesVerified: summary.balancesVerified,
        paidVnd: summary.paidVnd,
        fullyPaid: summary.fullyPaid,
        fulfillmentPaymentSatisfied: summary.fulfillmentPaymentSatisfied,
        refundLossFulfillmentEligible: summary.refundLossFulfillmentEligible,
        refundLossFulfillmentApproved: summary.refundLossFulfillmentApproved,
        bankPaymentApproved: summary.bankPaymentApproved,
        latePaymentApprovalRequired: summary.latePaymentApprovalRequired,
        purchaseAmountDueVnd: summary.balancesVerified
          ? summary.purchaseAmountDueVnd
          : null,
        refundedVnd: summary.refundedVnd,
        recoveredRefundVnd: summary.recoveredRefundVnd,
        discrepancyVnd: summary.balancesVerified
          ? summary.balanceDiscrepancyVnd
          : null,
        purchaseShortfallVnd: summary.balancesVerified
          ? summary.postDeliveryShortfallVnd
          : null,
        refundDiscrepancyVnd: summary.balancesVerified
          ? summary.refundDiscrepancyVnd
          : null,
        paymentMethod: order.paymentMethod,
        disposition: summary.balancesVerified
          ? summary.balanceDiscrepancy
          : null,
        permittedActions:
          summary.balancesVerified && summary.balanceDiscrepancyVnd > 0
            ? [
                'record_recovery_receipt',
                'record_debt',
                'approve_loss',
                ...(summary.refundLossFulfillmentEligible
                  ? ['approve_loss_and_continue_fulfillment']
                  : []),
              ]
            : [],
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

export function listPaymentBalanceReviewHistory(
  userId: string,
  reviewId: string,
  input: { limit: number; offset: number },
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'admin')
    return {
      items: await tx
        .select()
        .from(paymentBalanceReviewDecisions)
        .where(eq(paymentBalanceReviewDecisions.reviewId, reviewId))
        .orderBy(
          desc(paymentBalanceReviewDecisions.createdAt),
          desc(paymentBalanceReviewDecisions.id),
        )
        .limit(input.limit)
        .offset(input.offset),
      ...input,
    }
  })
}

async function lockBalanceReview(
  tx: Transaction,
  reviewId: string,
  expectedRevision: number,
) {
  const [metadata] = await tx
    .select()
    .from(paymentBalanceReviews)
    .where(eq(paymentBalanceReviews.id, reviewId))
  if (!metadata)
    fail(404, 'PAYMENT_REVIEW_NOT_FOUND', 'Payment review was not found')
  const order = await lockOrder(tx, metadata.orderId)
  const [review] = await tx
    .select()
    .from(paymentBalanceReviews)
    .where(eq(paymentBalanceReviews.id, reviewId))
    .for('update')
  if (!review || review.revision !== expectedRevision)
    fail(
      409,
      'PAYMENT_REVIEW_CHANGED',
      'Refresh the payment review before deciding',
    )
  return { order, review }
}

export function decidePaymentBalanceReview(
  command: Command,
  reviewId: string,
  input: PaymentBalanceReviewDecisionInput,
) {
  return executeCommand(
    { ...command, permission: 'admin' },
    async (tx, actor) => {
      const { order, review } = await lockBalanceReview(
        tx,
        reviewId,
        input.expectedRevision,
      )
      const summary = await paymentSummaryForOrder(tx, order)
      assertFinancialsVerified(summary)
      if (
        summary.balanceDiscrepancyVnd === 0 ||
        input.amountVnd !== summary.balanceDiscrepancyVnd
      )
        fail(
          409,
          'PAYMENT_REVIEW_AMOUNT_CHANGED',
          'Approve the complete currently verified discrepancy',
        )
      if (
        input.allowFulfillment &&
        (input.disposition !== 'written_off' ||
          !summary.refundLossFulfillmentEligible)
      )
        fail(
          409,
          'REFUND_LOSS_FULFILLMENT_NOT_ELIGIBLE',
          'Only a verified refund loss with no missing purchase payment can authorize bank fulfillment before handover',
        )
      const [updated] = await tx
        .update(paymentBalanceReviews)
        .set({
          status: input.disposition,
          disposition: input.disposition,
          discrepancyVnd: summary.balanceDiscrepancyVnd,
          purchaseShortfallVnd: summary.postDeliveryShortfallVnd,
          approvedAmountVnd: input.amountVnd,
          recoveredVndAtDecision: summary.recoveredRefundVnd,
          paidVndAtDecision: summary.paidVnd,
          allowFulfillment: input.allowFulfillment,
          revision: review.revision + 1,
          updatedAt: await databaseNow(tx),
        })
        .where(
          and(
            eq(paymentBalanceReviews.id, reviewId),
            eq(paymentBalanceReviews.revision, input.expectedRevision),
          ),
        )
        .returning()
      if (!updated)
        fail(
          409,
          'PAYMENT_REVIEW_CHANGED',
          'Payment review changed concurrently',
        )
      const [decision] = await tx
        .insert(paymentBalanceReviewDecisions)
        .values({
          reviewId,
          disposition: input.disposition,
          responsibleParty: input.responsibleParty,
          evidenceReference: input.evidenceReference,
          reason: input.reason,
          before: {
            ...review,
            createdAt: review.createdAt.toISOString(),
            updatedAt: review.updatedAt.toISOString(),
            resolvedAt: review.resolvedAt?.toISOString() ?? null,
          },
          after: {
            ...updated,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
            resolvedAt: updated.resolvedAt?.toISOString() ?? null,
          },
          decidedBy: actor.userId,
        })
        .returning({ id: paymentBalanceReviewDecisions.id })
      if (!decision)
        fail(
          503,
          'PAYMENT_REVIEW_UNAVAILABLE',
          'Payment review decision could not be recorded',
        )
      await appendOrderEvent(
        tx,
        actor,
        order.id,
        'payment_balance_review_decided',
        {
          reviewId,
          decisionId: decision.id,
          disposition: input.disposition,
          amountVnd: input.amountVnd,
          allowFulfillment: input.allowFulfillment,
          responsibleParty: input.responsibleParty,
          evidenceReference: input.evidenceReference,
          reason: input.reason,
        },
      )
      const finalized = await finalizeReceipt(tx, actor, order)
      return {
        reviewId,
        decisionId: decision.id,
        status: updated.status,
        revision: updated.revision,
        allowFulfillment: updated.allowFulfillment,
        fulfillmentPaymentSatisfied: finalized.fulfillmentPaymentSatisfied,
        bankPaymentApproved: finalized.bankPaymentApproved,
        latePaymentApprovalRequired: finalized.latePaymentApprovalRequired,
      }
    },
  )
}

export function recordRefundRecovery(
  command: Command,
  reviewId: string,
  input: RefundRecoveryReceiptInput,
) {
  return executeCommand(
    { ...command, permission: 'admin' },
    async (tx, actor) => {
      // Receipt identity always precedes order/review locks, as in every cash writer.
      await lockMerchantReceiptIdentity(tx, input.reference)
      const { order } = await lockBalanceReview(
        tx,
        reviewId,
        input.expectedRevision,
      )
      const before = await paymentSummaryForOrder(tx, order)
      assertFinancialsVerified(before)
      if (input.amountVnd > before.balanceDiscrepancyVnd)
        fail(
          409,
          'PAYMENT_RECOVERY_EXCEEDED',
          'Recovery exceeds the verified balance discrepancy',
        )
      const refundRecoveryVnd = Math.min(
        input.amountVnd,
        before.refundDiscrepancyVnd,
      )
      const paymentVnd = input.amountVnd - refundRecoveryVnd
      const allocations: PaymentAllocationInput[] = []
      if (refundRecoveryVnd > 0)
        allocations.push({
          orderId: order.id,
          amountVnd: refundRecoveryVnd,
          purpose: 'refund_recovery',
          reviewId,
        })
      if (paymentVnd > 0)
        allocations.push({
          orderId: order.id,
          amountVnd: paymentVnd,
          purpose: 'payment',
        })
      const result = await createReceiptInTransaction(tx, actor, {
        ...input,
        source: 'customer',
        allocations,
      })
      const summary = await paymentSummaryForOrder(tx, order)
      await syncPaymentBalanceReview(tx, actor, order, summary)
      const [review] = await tx
        .select()
        .from(paymentBalanceReviews)
        .where(eq(paymentBalanceReviews.id, reviewId))
      return {
        ...result,
        reviewId,
        status: review?.status ?? 'needs_review',
        discrepancyVnd: summary.balancesVerified
          ? summary.balanceDiscrepancyVnd
          : null,
        purchaseShortfallVnd: summary.balancesVerified
          ? summary.postDeliveryShortfallVnd
          : null,
        refundDiscrepancyVnd: summary.balancesVerified
          ? summary.refundDiscrepancyVnd
          : null,
      }
    },
  )
}
