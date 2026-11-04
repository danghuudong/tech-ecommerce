import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { checkoutQuotes, orderEvents } from '../../db/schema.js'
import {
  BANK_TRANSFER_REPORTED,
  BANK_TRANSFER_REVIEWED,
  bankTransferNotices,
  isVerifiedBankTransfer,
} from './bank-transfer-notice.js'
import type {
  BankTransferNoticeReviewInput,
  BankTransferReportInput,
} from './commerce.contracts.js'
import {
  appendOrderEvent,
  assertOccurredAt,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  lockOrder,
  type Order,
  type Transaction,
} from './commerce.persistence.js'
import type { Actor } from './commerce.types.js'
import { allocatedPaymentsForOrders } from './payment-allocation.js'

async function readNotices(tx: Transaction, orderId: string) {
  const events = await tx
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(orderEvents.createdAt, orderEvents.id)
  const receipts = await allocatedPaymentsForOrders(tx, [orderId])
  return { notices: bankTransferNotices(events, receipts), receipts }
}

function assertBankOrder(order: Order) {
  if (order.paymentMethod !== 'bank_transfer')
    fail(
      409,
      'BANK_TRANSFER_ORDER_REQUIRED',
      'Transfer notices are only available for bank transfer orders',
    )
}

export function reportBankTransfer(
  command: Command,
  orderId: string,
  input: BankTransferReportInput,
) {
  return executeCommand(
    { ...command, permission: 'signed_in' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      if (order.userId !== actor.userId)
        fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
      assertBankOrder(order)
      const [quote] = await tx
        .select({ createdAt: checkoutQuotes.createdAt })
        .from(checkoutQuotes)
        .where(eq(checkoutQuotes.id, order.quoteId))
      if (!quote) fail(404, 'QUOTE_NOT_FOUND', 'Order quote was not found')
      assertOccurredAt(
        input.transferredAt,
        quote.createdAt,
        await databaseNow(tx),
      )
      const { notices } = await readNotices(tx, orderId)
      const sameReport = (notice: (typeof notices)[number]) =>
        notice.amountVnd === input.amountVnd &&
        notice.currency === input.currency &&
        notice.reference === input.reference &&
        notice.transferredAt.getTime() === input.transferredAt.getTime() &&
        notice.evidenceReference === input.evidenceReference &&
        notice.note === input.note
      const pending = notices.find((notice) => notice.status === 'pending')
      if (pending) {
        if (!sameReport(pending))
          fail(
            409,
            'BANK_TRANSFER_NOTICE_PENDING',
            'An existing transfer notice must be reviewed before reporting another transfer',
          )
        return { noticeId: pending.id, status: pending.status }
      }
      const recorded = notices.find(
        (notice) => notice.status === 'recorded' && sameReport(notice),
      )
      if (recorded) return { noticeId: recorded.id, status: recorded.status }
      const noticeId = randomUUID()
      // A late/cancelled order can still have real money to locate and refund.
      // Reporting it does not reopen the order, extend its deadline or approve it.
      await appendOrderEvent(tx, actor, orderId, BANK_TRANSFER_REPORTED, {
        noticeId,
        amountVnd: input.amountVnd,
        currency: input.currency,
        reference: input.reference,
        transferredAt: input.transferredAt.toISOString(),
        ...(input.evidenceReference
          ? { evidenceReference: input.evidenceReference }
          : {}),
        ...(input.note ? { note: input.note } : {}),
      })
      return { noticeId, status: 'pending' }
    },
  )
}

// The caller owns the order lock. Receipt recording calls this in the same
// transaction; reviewing an existing receipt never creates another payment.
export async function reviewBankTransferNoticeInTransaction(
  tx: Transaction,
  actor: Actor,
  order: Order,
  noticeId: string,
  input: BankTransferNoticeReviewInput,
) {
  if (actor.role !== 'accountant' && actor.role !== 'admin')
    fail(403, 'ACCOUNTANT_ACCESS_REQUIRED', 'Accountant access is required')
  assertBankOrder(order)
  const { notices, receipts } = await readNotices(tx, order.id)
  const notice = notices.find((item) => item.id === noticeId)
  if (!notice)
    fail(404, 'BANK_TRANSFER_NOTICE_NOT_FOUND', 'Transfer notice was not found')
  if (notice.status === 'recorded') {
    if (
      input.outcome === 'recorded' &&
      notice.review?.outcome === 'recorded' &&
      notice.review.paymentId === input.paymentId
    )
      return { noticeId, status: 'recorded', paymentId: input.paymentId }
    fail(
      409,
      'BANK_TRANSFER_NOTICE_ALREADY_REVIEWED',
      'The transfer notice already has a verified receipt',
    )
  }
  const now = await databaseNow(tx)
  if (input.outcome === 'recorded') {
    const receipt = receipts.find(
      (item) => item.id === input.paymentId && isVerifiedBankTransfer(item),
    )
    if (!receipt)
      fail(
        409,
        'BANK_TRANSFER_RECEIPT_REQUIRED',
        'Match a verified customer bank receipt allocated to this order',
      )
    if (
      notices.some(
        (item) =>
          item.id !== noticeId &&
          item.status === 'recorded' &&
          item.review?.outcome === 'recorded' &&
          item.review.paymentId === input.paymentId,
      )
    )
      fail(
        409,
        'BANK_TRANSFER_RECEIPT_ALREADY_MATCHED',
        'This receipt is already matched to another notice for the same order',
      )
  } else {
    assertOccurredAt(input.statementCheckedThrough, notice.transferredAt, now)
    if (notice.review?.outcome === 'not_found')
      assertOccurredAt(
        input.statementCheckedThrough,
        notice.review.statementCheckedThrough,
        now,
      )
  }
  await appendOrderEvent(tx, actor, order.id, BANK_TRANSFER_REVIEWED, {
    noticeId,
    review:
      input.outcome === 'recorded'
        ? input
        : {
            ...input,
            statementCheckedThrough:
              input.statementCheckedThrough.toISOString(),
          },
  })
  return {
    noticeId,
    status: input.outcome,
    ...(input.outcome === 'recorded' ? { paymentId: input.paymentId } : {}),
  }
}

export function reviewBankTransferNotice(
  command: Command,
  orderId: string,
  noticeId: string,
  input: BankTransferNoticeReviewInput,
) {
  return executeCommand(
    { ...command, permission: 'accountant' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      return reviewBankTransferNoticeInTransaction(
        tx,
        actor,
        order,
        noticeId,
        input,
      )
    },
  )
}
