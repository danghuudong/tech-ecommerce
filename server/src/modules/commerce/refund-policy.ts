import { and, eq, inArray, ne, or } from 'drizzle-orm'
import { refundAttempts, user } from '../../db/schema.js'
import {
  administratorFilter,
  fail,
  type Transaction,
} from './commerce.persistence.js'
import type { Actor } from './commerce.types.js'

type RefundInitiator = { recordedBy: string }

export async function hasIndependentRefundChecker(
  tx: Transaction,
  initiatorId: string,
) {
  const [checker] = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(administratorFilter(), ne(user.id, initiatorId)))
    .limit(1)
  return checker !== undefined
}

export async function assertRefundCheckerAvailable(
  tx: Transaction,
  initiatorId: string,
) {
  if (!(await hasIndependentRefundChecker(tx, initiatorId)))
    fail(
      409,
      'REFUND_CHECKER_UNAVAILABLE',
      'Register another eligible administrator before opening a refund attempt',
    )
}

// Role changes hold the exclusive role lock; new attempts hold its shared lock.
export async function assertPendingRefundsKeepChecker(
  tx: Transaction,
  departingAdminId: string,
) {
  const others = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(administratorFilter(), ne(user.id, departingAdminId)))
    .limit(2)
  if (others.length >= 2) return
  const [unresolved] = await tx
    .select({ id: refundAttempts.id })
    .from(refundAttempts)
    .where(
      and(
        or(
          inArray(refundAttempts.status, ['pending', 'unknown']),
          and(
            eq(refundAttempts.status, 'partially_settled'),
            eq(refundAttempts.remainderNotSentVerified, false),
          ),
        ),
        others[0] ? eq(refundAttempts.recordedBy, others[0].id) : undefined,
      ),
    )
    .limit(1)
  if (unresolved)
    fail(
      409,
      'REFUND_CHECKER_REQUIRED_FOR_OPEN_ATTEMPTS',
      'Resolve pending refund attempts or register another administrator before removing this checker',
    )
}

export function canVerifyRefundAttempt(actor: Actor, attempt: RefundInitiator) {
  return actor.role === 'admin' && actor.userId !== attempt.recordedBy
}

export function assertRefundChecker(actor: Actor, attempt: RefundInitiator) {
  if (actor.role !== 'admin')
    fail(
      403,
      'REFUND_CHECKER_REQUIRED',
      'An administrator must verify refund outcomes',
    )
  if (actor.userId === attempt.recordedBy)
    fail(
      403,
      'REFUND_SELF_VERIFICATION_FORBIDDEN',
      'The refund initiator cannot verify their own attempt',
    )
}
