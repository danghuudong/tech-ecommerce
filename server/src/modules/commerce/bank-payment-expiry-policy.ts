import { type SQL, sql } from 'drizzle-orm'
import {
  codCollections,
  collectionDecisions,
  orders,
  paymentAllocations,
  paymentBalanceReviews,
  payments,
  refunds,
} from '../../db/schema.js'
import { pendingBankTransferNoticeFilter } from './bank-transfer-notice.js'

// A missing verified balance alone is not proof that no money was recorded.
// Preserve any receipt, allocation or financial case for manual reconciliation,
// including ambiguous receipts and receipts whose allocations were corrected.
// Both worker selection and the locked cancellation use this same predicate.
export function bankTransferAutoCancellationFilter(
  now: Date | SQL = sql`clock_timestamp()`,
) {
  const cutoff = now instanceof Date ? now.toISOString() : now
  return sql<boolean>`(
    ${orders.paymentMethod} = 'bank_transfer'
    and ${orders.deletedAt} is null
    and ${orders.stockState} = 'reserved'
    and ${orders.status} in ('placed', 'confirmed', 'packing')
    and ${orders.paymentDeadlineAt} is not null
    and ${orders.paymentDeadlineAt} <= ${cutoff}
    and ${orders.reservationExpiresAt} is not null
    and ${orders.reservationExpiresAt} <= ${cutoff}
    and not exists (
      select 1 from ${payments} where ${payments.orderId} = ${orders.id}
    )
    and not exists (
      select 1 from ${paymentAllocations}
      where ${paymentAllocations.orderId} = ${orders.id}
    )
    and not exists (
      select 1 from ${codCollections} where ${codCollections.orderId} = ${orders.id}
    )
    and not exists (
      select 1 from ${refunds} where ${refunds.orderId} = ${orders.id}
    )
    and not exists (
      select 1 from ${paymentBalanceReviews}
      where ${paymentBalanceReviews.orderId} = ${orders.id}
    )
    and not exists (
      select 1 from ${collectionDecisions}
      where ${collectionDecisions.orderId} = ${orders.id}
    )
    and not ${pendingBankTransferNoticeFilter()}
  )`
}
