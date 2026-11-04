import { sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  orderEvents,
  orders,
  paymentAllocations,
  payments,
  receivingAccounts,
} from '../../db/schema.js'
import {
  bankTransferNoticeReviewSchema,
  bankTransferReportSchema,
  idSchema,
} from './commerce.contracts.js'
import type { AllocatedPayment } from './payment-allocation.js'

export const BANK_TRANSFER_REPORTED = 'bank_transfer_reported'
export const BANK_TRANSFER_REVIEWED = 'bank_transfer_report_reviewed'

type NoticeEvent = Pick<
  typeof orderEvents.$inferSelect,
  'id' | 'type' | 'details' | 'createdAt' | 'actorUserId'
>

const reportDetailsSchema = bankTransferReportSchema
  .extend({ noticeId: idSchema })
  .strip()
const reviewDetailsSchema = z.object({
  noticeId: idSchema,
  review: bankTransferNoticeReviewSchema,
})

export function isVerifiedBankTransfer(receipt: AllocatedPayment) {
  return (
    receipt.purpose === 'payment' &&
    (receipt.source === 'customer' ||
      (receipt.source === 'legacy' &&
        receipt.recordedPaymentMethod === 'bank_transfer')) &&
    receipt.currency === 'VND' &&
    receipt.receivingChannel === 'bank_transfer' &&
    receipt.duplicateOfId === null &&
    !receipt.receiptReconciliationRequired &&
    receipt.amountVnd > 0
  )
}

// Events describe the customer's statement and the review. Only the payment
// ledger proves receipt of money; a later correction can reopen this work.
export function bankTransferNotices(
  events: NoticeEvent[],
  receipts: AllocatedPayment[],
) {
  const reviews = new Map<
    string,
    {
      event: NoticeEvent
      review: z.infer<typeof bankTransferNoticeReviewSchema>
    }
  >()
  for (const event of events) {
    if (event.type !== BANK_TRANSFER_REVIEWED) continue
    const { noticeId, review } = reviewDetailsSchema.parse(event.details)
    reviews.set(noticeId, { event, review })
  }
  return events.flatMap((event) => {
    if (event.type !== BANK_TRANSFER_REPORTED) return []
    const { noticeId, ...report } = reportDetailsSchema.parse(event.details)
    const reviewed = reviews.get(noticeId)
    const paymentId =
      reviewed?.review.outcome === 'recorded' ? reviewed.review.paymentId : null
    const matchedReceipt = paymentId
      ? receipts.find(
          (receipt) =>
            receipt.id === paymentId && isVerifiedBankTransfer(receipt),
        )
      : undefined
    const status =
      reviewed?.review.outcome === 'not_found'
        ? ('not_found' as const)
        : matchedReceipt
          ? ('recorded' as const)
          : ('pending' as const)
    return [
      {
        id: noticeId,
        eventId: event.id,
        ...report,
        reportedAt: event.createdAt,
        reportedBy: event.actorUserId,
        status,
        review: reviewed
          ? {
              ...reviewed.review,
              eventId: reviewed.event.id,
              reviewedAt: reviewed.event.createdAt,
              reviewedBy: reviewed.event.actorUserId,
            }
          : null,
        matchedReceipt: matchedReceipt
          ? {
              paymentId: matchedReceipt.id,
              allocatedAmountVnd: matchedReceipt.amountVnd,
              receivedAt: matchedReceipt.receivedAt,
            }
          : null,
      },
    ]
  })
}

export function publicBankTransferReview(details: NoticeEvent['details']) {
  const { noticeId, review } = reviewDetailsSchema.parse(details)
  return {
    noticeId,
    review: {
      outcome: review.outcome,
      ...(review.outcome === 'not_found'
        ? {
            statementCheckedThrough:
              review.statementCheckedThrough.toISOString(),
          }
        : {}),
    },
  }
}

// Keep this predicate aligned with the projection above. Event aliases are
// local to the subqueries, so this works in list filters, counts and columns.
export function pendingBankTransferNoticeFilter() {
  return sql<boolean>`(${orders.paymentMethod} = 'bank_transfer' and exists (
    select 1 from ${orderEvents} as reported
    left join lateral (
      select reviewed.details from ${orderEvents} as reviewed
      where reviewed.order_id = reported.order_id
        and reviewed.type = ${BANK_TRANSFER_REVIEWED}
        and reviewed.details->>'noticeId' = reported.details->>'noticeId'
      order by reviewed.created_at desc, reviewed.id desc limit 1
    ) as latest on true
    where reported.order_id = ${orders.id}
      and reported.type = ${BANK_TRANSFER_REPORTED}
      and (latest.details is null or (
        latest.details->'review'->>'outcome' = 'recorded'
        and not exists (
          select 1 from ${paymentAllocations} as allocation
          inner join ${payments} as receipt on receipt.id = allocation.payment_id
          inner join ${receivingAccounts} as account on account.id = receipt.receiving_account_id
          where allocation.order_id = reported.order_id
            and receipt.id::text = latest.details->'review'->>'paymentId'
            and allocation.purpose = 'payment' and allocation.amount_vnd > 0
            and (receipt.source = 'customer' or
              (receipt.source = 'legacy' and receipt.method = 'bank_transfer'))
            and receipt.currency = 'VND'
            and account.channel = 'bank_transfer' and receipt.duplicate_of_id is null
            and not receipt.receipt_reconciliation_required
        )
      ))
  ))`
}
