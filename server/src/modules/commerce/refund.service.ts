import { and, eq } from 'drizzle-orm'
import {
  orders,
  refundAttempts,
  refundSettlements,
  refunds,
} from '../../db/schema.js'
import type {
  RefundExceptionSettlementInput,
  RefundOutcomeInput,
} from './commerce.contracts.js'
import {
  appendOrderEvent,
  assertOccurredAt,
  assertOrderWorkAccess,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  lockOrder,
  type Transaction,
} from './commerce.persistence.js'
import { MAX_RECOVERY_ATTEMPTS } from './commerce.types.js'
import {
  assertFinancialsVerified,
  paymentSummaryForOrder,
  reconcileRefundBalance,
  refundAttemptClosed,
} from './payment-ledger.js'
import {
  assertRefundChecker,
  assertRefundCheckerAvailable,
} from './refund-policy.js'

async function lockRefundOrder(tx: Transaction, refundId: string) {
  const [metadata] = await tx
    .select({ orderId: refunds.orderId })
    .from(refunds)
    .where(eq(refunds.id, refundId))
  if (!metadata) fail(404, 'REFUND_NOT_FOUND', 'Refund was not found')
  const order = await lockOrder(tx, metadata.orderId)
  const [refund] = await tx
    .select()
    .from(refunds)
    .where(eq(refunds.id, refundId))
    .for('update')
  if (!refund) fail(404, 'REFUND_NOT_FOUND', 'Refund was not found')
  return { order, refund }
}

function beginRefundAttempt(
  command: Command,
  refundId: string,
  amount?: number,
  recoveryReason?: string,
) {
  return executeCommand(
    {
      ...command,
      permission: recoveryReason ? 'admin' : 'accountant',
      roleLock: 'shared',
    },
    async (tx, actor) => {
      const { order, refund: original } = await lockRefundOrder(tx, refundId)
      assertOrderWorkAccess(actor, order, false)
      await assertRefundCheckerAvailable(tx, actor.userId)
      await reconcileRefundBalance(
        tx,
        actor,
        order,
        original.reason,
        original.returnId ?? undefined,
      )
      const [refund] = await tx
        .select()
        .from(refunds)
        .where(eq(refunds.id, refundId))
      if (!refund) fail(404, 'REFUND_NOT_FOUND', 'Refund was not found')
      const attempts = await tx
        .select()
        .from(refundAttempts)
        .where(eq(refundAttempts.refundId, refundId))
        .orderBy(refundAttempts.number)
      const latest = attempts.at(-1)
      if (!refundAttemptClosed(latest))
        fail(
          409,
          'REFUND_ATTEMPT_UNRESOLVED',
          'Verify the previous transfer remainder before starting another attempt',
        )
      if (recoveryReason) {
        if (
          refund.status !== 'needs_review' ||
          refund.attemptCount < MAX_RECOVERY_ATTEMPTS ||
          !latest
        )
          fail(
            409,
            'MANUAL_REFUND_NOT_ELIGIBLE',
            'Manual recovery requires an exhausted refund with a resolved previous attempt',
          )
      } else if (
        !['pending', 'partially_settled'].includes(refund.status) ||
        refund.attemptCount >= MAX_RECOVERY_ATTEMPTS
      )
        fail(
          409,
          'REFUND_NOT_PENDING',
          'Refund is not eligible for a standard attempt',
        )
      const summary = await paymentSummaryForOrder(tx, order)
      assertFinancialsVerified(summary)
      const remainingVnd =
        summary.refundBalances.get(refundId)?.remainingVnd ?? 0
      const amountVnd = amount ?? remainingVnd
      if (
        amountVnd <= 0 ||
        amountVnd > remainingVnd ||
        amountVnd > summary.refundDueVnd ||
        summary.pendingRefundVnd > summary.refundDueVnd
      )
        fail(
          409,
          'REFUND_BALANCE_CHANGED',
          'Transfer amount exceeds the verified remaining refund balance',
        )
      const number = refund.attemptCount + 1
      const [attempt] = await tx
        .insert(refundAttempts)
        .values({
          refundId,
          number,
          requestedAmountVnd: amountVnd,
          mode: recoveryReason ? 'manual' : 'standard',
          recoveryReason: recoveryReason ?? null,
          recordedBy: actor.userId,
        })
        .returning({ id: refundAttempts.id })
      if (!attempt)
        fail(
          503,
          'REFUND_ATTEMPT_UNAVAILABLE',
          'Refund attempt could not be recorded',
        )
      await tx
        .update(refunds)
        .set({
          status: 'processing',
          attemptCount: number,
          updatedAt: await databaseNow(tx),
        })
        .where(eq(refunds.id, refundId))
      await appendOrderEvent(tx, actor, order.id, 'refund_attempt_started', {
        refundId,
        attemptId: attempt.id,
        attemptNumber: number,
        amountVnd,
        remainingRefundVnd: remainingVnd,
        mode: recoveryReason ? 'manual' : 'standard',
        recoveryReason: recoveryReason ?? null,
      })
      return {
        orderId: order.id,
        refundId,
        attemptId: attempt.id,
        amountVnd,
        remainingRefundVnd: remainingVnd,
        transferReference: attempt.id,
        attemptNumber: number,
      }
    },
  )
}

export function startRefundAttempt(
  command: Command,
  refundId: string,
  amountVnd?: number,
) {
  return beginRefundAttempt(command, refundId, amountVnd)
}

export function startManualRefundAttempt(
  command: Command,
  refundId: string,
  reason: string,
  amountVnd?: number,
) {
  return beginRefundAttempt(command, refundId, amountVnd, reason)
}

export function recordRefundOutcome(
  command: Command,
  refundId: string,
  attemptId: string,
  input: RefundOutcomeInput,
) {
  return recordRefundResult(command, refundId, attemptId, input)
}

export function recordRefundExceptionSettlement(
  command: Command,
  refundId: string,
  attemptId: string,
  input: RefundExceptionSettlementInput,
) {
  return recordRefundResult(
    command,
    refundId,
    attemptId,
    {
      ...input,
      outcome: 'settled',
    },
    { evidenceReference: input.evidenceReference, reason: input.reason },
  )
}

function recordRefundResult(
  command: Command,
  refundId: string,
  attemptId: string,
  input: RefundOutcomeInput,
  exception?: { evidenceReference: string; reason: string },
) {
  return executeCommand(
    { ...command, permission: 'admin' },
    async (tx, actor) => {
      const { order, refund } = await lockRefundOrder(tx, refundId)
      assertOrderWorkAccess(actor, order, false)
      const [attempt] = await tx
        .select()
        .from(refundAttempts)
        .where(
          and(
            eq(refundAttempts.id, attemptId),
            eq(refundAttempts.refundId, refundId),
          ),
        )
        .for('update')
      if (!attempt)
        fail(404, 'REFUND_ATTEMPT_NOT_FOUND', 'Refund attempt was not found')
      assertRefundChecker(actor, attempt)
      if (input.outcome === 'settled') {
        const [existing] = await tx
          .select()
          .from(refundSettlements)
          .where(
            and(
              eq(refundSettlements.method, input.method),
              eq(refundSettlements.reference, input.reference),
            ),
          )
        if (existing) {
          if (
            existing.refundId !== refundId ||
            existing.attemptId !== attemptId ||
            existing.amountVnd !== input.amountVnd ||
            existing.currency !== input.currency ||
            existing.settledAt.getTime() !== input.settledAt.getTime() ||
            (exception !== undefined &&
              (existing.exceptionEvidenceReference !==
                exception.evidenceReference ||
                existing.exceptionReason !== exception.reason)) ||
            (exception === undefined && existing.excessAmountVnd > 0)
          )
            fail(
              409,
              'REFUND_REFERENCE_CONFLICT',
              'Settlement reference was used for different details',
            )
          if (
            input.remainderNotSentVerified &&
            !attempt.remainderNotSentVerified
          )
            fail(
              409,
              'REFUND_REMAINDER_NOT_VERIFIED',
              'Record a separate not_sent outcome to verify the remaining transfer',
            )
          return {
            orderId: order.id,
            refundId,
            attemptId,
            settlementId: existing.id,
          }
        }
      }
      if (!exception && attempt.number !== refund.attemptCount)
        fail(
          409,
          'REFUND_ATTEMPT_NOT_CURRENT',
          'Only the latest attempt can receive a new outcome',
        )
      if (
        !exception &&
        (refund.status === 'settled' || refund.status === 'voided')
      )
        fail(409, 'REFUND_ALREADY_CLOSED', 'Refund has already been closed')
      if (input.outcome === 'not_sent' && refundAttemptClosed(attempt)) {
        if (attempt.remainderNotSentVerified && attempt.reason === input.reason)
          return { orderId: order.id, refundId, attemptId }
        fail(
          409,
          'REFUND_ATTEMPT_ALREADY_RESOLVED',
          'The previous outcome is immutable',
        )
      }
      if (!exception && refundAttemptClosed(attempt))
        fail(
          409,
          'REFUND_ATTEMPT_ALREADY_RESOLVED',
          'Start a new attempt for a verified remaining balance',
        )
      const now = await databaseNow(tx)
      const summary = await paymentSummaryForOrder(tx, order)
      // Reconciliation can suspend new transfers, but cannot hide actual cash.
      // Admin exceptions record unauthorized excess without enlarging approval.
      const balance = summary.refundBalances.get(refundId)
      if (!balance)
        fail(503, 'REFUND_BALANCE_UNAVAILABLE', 'Refund balance is unavailable')
      if (input.outcome === 'settled') {
        const authorizedRemainingVnd =
          refundAttemptClosed(attempt) ||
          attempt.number !== refund.attemptCount ||
          ['settled', 'voided'].includes(refund.status)
            ? 0
            : Math.min(
                attempt.requestedAmountVnd - attempt.settledAmountVnd,
                balance.remainingVnd,
              )
        if (!exception && input.amountVnd > authorizedRemainingVnd)
          fail(
            409,
            'REFUND_AMOUNT_EXCEEDED',
            'Settlement exceeds the remaining attempt or refund amount',
          )
        const approvedAmountVnd = Math.min(
          input.amountVnd,
          authorizedRemainingVnd,
        )
        const excessAmountVnd = input.amountVnd - approvedAmountVnd
        if (exception && excessAmountVnd === 0)
          fail(
            422,
            'REFUND_EXCEPTION_NOT_REQUIRED',
            'Record a settlement within the approved balance through the ordinary outcome endpoint',
          )
        assertOccurredAt(input.settledAt, attempt.createdAt, now)
        const [settlement] = await tx
          .insert(refundSettlements)
          .values({
            refundId,
            attemptId,
            amountVnd: input.amountVnd,
            excessAmountVnd,
            exceptionEvidenceReference: exception?.evidenceReference ?? null,
            exceptionReason: exception?.reason ?? null,
            currency: input.currency,
            method: input.method,
            reference: input.reference,
            settledAt: input.settledAt,
            recordedBy: actor.userId,
          })
          .onConflictDoNothing({
            target: [refundSettlements.method, refundSettlements.reference],
          })
          .returning({ id: refundSettlements.id })
        if (!settlement)
          fail(
            409,
            'REFUND_REFERENCE_CONFLICT',
            'Settlement reference was recorded concurrently',
          )
        const attemptSettledVnd = attempt.settledAmountVnd + approvedAmountVnd
        const refundedVnd = balance.settledVnd + input.amountVnd
        const attemptFullySettled =
          attemptSettledVnd === attempt.requestedAmountVnd
        const remainderVerified =
          refundAttemptClosed(attempt) ||
          attemptFullySettled ||
          input.remainderNotSentVerified === true
        const fullySettled = refundedVnd >= refund.amountVnd
        const nextRefundStatus =
          refund.status === 'voided'
            ? 'voided'
            : attempt.number !== refund.attemptCount
              ? refund.status
              : fullySettled && remainderVerified
                ? 'settled'
                : remainderVerified &&
                    refund.attemptCount >= MAX_RECOVERY_ATTEMPTS
                  ? 'needs_review'
                  : 'partially_settled'
        if (!refundAttemptClosed(attempt))
          await tx
            .update(refundAttempts)
            .set({
              status: attemptFullySettled
                ? 'settled'
                : attemptSettledVnd > 0
                  ? 'partially_settled'
                  : attempt.status,
              settledAmountVnd: attemptSettledVnd,
              remainderNotSentVerified: remainderVerified,
              resolvedBy: remainderVerified ? actor.userId : null,
              updatedAt: now,
            })
            .where(eq(refundAttempts.id, attemptId))
        await tx
          .update(refunds)
          .set({
            status: nextRefundStatus,
            settlementMethod:
              nextRefundStatus === 'settled'
                ? (refund.settlementMethod ?? input.method)
                : null,
            settlementReference:
              nextRefundStatus === 'settled'
                ? (refund.settlementReference ?? input.reference)
                : null,
            settledAt:
              nextRefundStatus === 'settled'
                ? (refund.settledAt ?? input.settledAt)
                : null,
            settledBy:
              nextRefundStatus === 'settled'
                ? (refund.settledBy ?? actor.userId)
                : null,
            updatedAt: now,
          })
          .where(eq(refunds.id, refundId))
        await tx
          .update(orders)
          .set({ revision: order.revision + 1, updatedAt: now })
          .where(eq(orders.id, order.id))
        await appendOrderEvent(
          tx,
          actor,
          order.id,
          exception
            ? 'refund_exception_settlement_recorded'
            : fullySettled
              ? 'refund_settled'
              : 'refund_partially_settled',
          {
            refundId,
            attemptId,
            settlementId: settlement.id,
            initiatedBy: attempt.recordedBy,
            verifiedBy: actor.userId,
            amountVnd: input.amountVnd,
            approvedAmountVnd,
            excessAmountVnd,
            ...(exception
              ? {
                  evidenceReference: exception.evidenceReference,
                  reason: exception.reason,
                }
              : {}),
            method: input.method,
            reference: input.reference,
            settledAt: input.settledAt.toISOString(),
            refundedVnd,
            remainingRefundVnd: Math.max(0, refund.amountVnd - refundedVnd),
            attemptRemainingVnd: attempt.requestedAmountVnd - attemptSettledVnd,
            remainderNotSentVerified: remainderVerified,
            balancesVerified: summary.balancesVerified,
          },
        )
        await reconcileRefundBalance(
          tx,
          actor,
          order,
          refund.reason,
          refund.returnId ?? undefined,
        )
        const reconciled = (
          await paymentSummaryForOrder(tx, order)
        ).refundBalances.get(refundId)
        return {
          orderId: order.id,
          refundId,
          attemptId,
          settlementId: settlement.id,
          approvedAmountVnd,
          excessAmountVnd,
          refundedVnd: reconciled?.settledVnd ?? refundedVnd,
          remainingRefundVnd: reconciled?.remainingVnd ?? 0,
        }
      }
      if (input.outcome === 'unknown') {
        await tx
          .update(refundAttempts)
          .set({
            status: 'unknown',
            reason: input.reason,
            remainderNotSentVerified: false,
            resolvedBy: null,
            updatedAt: now,
          })
          .where(eq(refundAttempts.id, attemptId))
        await tx
          .update(refunds)
          .set({ status: 'unknown', updatedAt: now })
          .where(eq(refunds.id, refundId))
        await appendOrderEvent(tx, actor, order.id, 'refund_outcome_unknown', {
          refundId,
          attemptId,
          initiatedBy: attempt.recordedBy,
          verifiedBy: actor.userId,
          reason: input.reason,
          alreadySettledVnd: attempt.settledAmountVnd,
          unverifiedRemainderVnd:
            attempt.requestedAmountVnd - attempt.settledAmountVnd,
        })
        return { orderId: order.id, refundId, attemptId }
      }
      // Verification concerns only the unpaid remainder; actual receipts stay immutable.
      await tx
        .update(refundAttempts)
        .set({
          status: attempt.settledAmountVnd > 0 ? 'partially_settled' : 'failed',
          reason: input.reason,
          remainderNotSentVerified: true,
          resolvedBy: actor.userId,
          updatedAt: now,
        })
        .where(eq(refundAttempts.id, attemptId))
      await tx
        .update(refunds)
        .set({
          status:
            refund.attemptCount >= MAX_RECOVERY_ATTEMPTS
              ? 'needs_review'
              : balance.settledVnd > 0
                ? 'partially_settled'
                : 'pending',
          updatedAt: now,
        })
        .where(eq(refunds.id, refundId))
      await appendOrderEvent(
        tx,
        actor,
        order.id,
        'refund_remainder_not_sent_verified',
        {
          refundId,
          attemptId,
          initiatedBy: attempt.recordedBy,
          verifiedBy: actor.userId,
          reason: input.reason,
          refundedVnd: balance.settledVnd,
          remainingRefundVnd: balance.remainingVnd,
          nextOperation: !summary.balancesVerified
            ? 'admin_reconcile_payments'
            : refund.attemptCount >= MAX_RECOVERY_ATTEMPTS
              ? 'admin_manual_refund_attempt'
              : 'start_refund_attempt',
        },
      )
      await reconcileRefundBalance(
        tx,
        actor,
        order,
        refund.reason,
        refund.returnId ?? undefined,
      )
      const reconciled = (
        await paymentSummaryForOrder(tx, order)
      ).refundBalances.get(refundId)
      return {
        orderId: order.id,
        refundId,
        attemptId,
        refundedVnd: reconciled?.settledVnd ?? balance.settledVnd,
        remainingRefundVnd: reconciled?.remainingVnd ?? 0,
      }
    },
  )
}
