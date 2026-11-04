import { env } from '../../config/env.js'
import type { Order } from './commerce.persistence.js'
import type { OrderFinancials } from './payment-ledger.js'

export const BANK_TRANSFER_DEMO_COMPLETED = 'bank_transfer_demo_completed'

export function demoBankTransferEnabled() {
  return env.NODE_ENV === 'development' && env.ORDER_DEMO_BANK_TRANSFER_ENABLED
}

export function canCompleteDemoBankTransfer(
  order: Order,
  payment: OrderFinancials,
  now: Date,
) {
  return (
    demoBankTransferEnabled() &&
    !order.deletedAt &&
    order.paymentMethod === 'bank_transfer' &&
    order.bankInstructions !== null &&
    order.stockState === 'reserved' &&
    ['placed', 'confirmed', 'packing'].includes(order.status) &&
    order.paymentDeadlineAt !== null &&
    order.paymentDeadlineAt > now &&
    order.reservationExpiresAt !== null &&
    order.reservationExpiresAt > now &&
    payment.balancesVerified &&
    payment.paidVnd === 0 &&
    payment.refundedVnd === 0 &&
    payment.pendingRefundVnd === 0 &&
    payment.amountDueVnd === order.totalVnd &&
    payment.amountDueVnd > 0
  )
}
