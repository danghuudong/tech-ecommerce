import type { refundAttempts, refunds, returns } from '../../db/schema.js'
import type { Order } from './commerce.persistence.js'
import { type OrderFinancials, refundAttemptClosed } from './payment-ledger.js'

export function orderDeletionBlockReason(
  order: Order,
  payment: OrderFinancials,
  returnRecords: Pick<typeof returns.$inferSelect, 'status'>[],
  refundRecords: Pick<
    typeof refunds.$inferSelect,
    'id' | 'status' | 'attemptCount'
  >[],
  attempts: (typeof refundAttempts.$inferSelect)[],
) {
  if (
    !['cancelled', 'completed'].includes(order.status) ||
    order.stockState === 'reserved'
  )
    return 'ORDER_DELETION_NOT_TERMINAL'
  if (!payment.balancesVerified) return 'ORDER_DELETION_RECONCILIATION_REQUIRED'
  if (
    returnRecords.some((record) =>
      ['requested', 'approved', 'receiving'].includes(record.status),
    )
  )
    return 'ORDER_DELETION_RETURNS_PENDING'
  if (
    payment.amountDueVnd > 0 ||
    payment.refundDueVnd > 0 ||
    payment.pendingRefundVnd > 0 ||
    payment.carrierAmountDueVnd > 0 ||
    payment.carrierOverremittedVnd > 0 ||
    payment.balanceDiscrepancyVnd > 0 ||
    refundRecords.some(
      (record) =>
        !['settled', 'voided'].includes(record.status) ||
        !refundAttemptClosed(
          attempts.find(
            (attempt) =>
              attempt.refundId === record.id &&
              attempt.number === record.attemptCount,
          ),
        ),
    )
  )
    return 'ORDER_DELETION_FINANCIAL_WORK_PENDING'
  return null
}
