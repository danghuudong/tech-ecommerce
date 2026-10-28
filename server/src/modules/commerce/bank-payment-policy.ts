import { createHash } from 'node:crypto'
import { fail, type Order } from './commerce.persistence.js'
import type { AllocatedPayment } from './payment-allocation.js'

// Bind approval to this order's allocated money and physical receipt facts.
// A receipt's shared revision can change for another order; it is not evidence.
// Encode free-text references so they cannot collide with field separators.
export function bankPaymentFingerprint(
  order: Order,
  receipts: AllocatedPayment[],
) {
  const evidence = [...receipts]
    .filter(
      (receipt) =>
        receipt.purpose === 'payment' && receipt.source !== 'carrier',
    )
    .sort((a, b) =>
      a.allocationId < b.allocationId
        ? -1
        : a.allocationId > b.allocationId
          ? 1
          : 0,
    )
    .map((receipt) =>
      [
        receipt.allocationId,
        receipt.id,
        receipt.amountVnd,
        receipt.receivedAt.getTime(),
        receipt.receivingAccountId ?? '',
        receipt.source,
        receipt.receivingChannel ?? '',
        receipt.receiptAmountVnd,
        receipt.currency,
        Buffer.from(receipt.reference, 'utf8').toString('hex'),
      ].join(':'),
    )
    .join('|')
  return createHash('sha256')
    .update(
      `${order.id}:${order.totalVnd}:${order.paymentDeadlineAt?.getTime() ?? ''}|${evidence}`,
    )
    .digest('hex')
}

export function assertBankPaymentApproved(payment: {
  fulfillmentPaymentSatisfied: boolean
  bankPaymentApproved: boolean
}) {
  if (!payment.fulfillmentPaymentSatisfied)
    fail(
      409,
      'PAYMENT_REQUIRED',
      'Verify full payment or obtain admin approval to fulfill after an accepted refund loss',
    )
  if (!payment.bankPaymentApproved)
    fail(
      409,
      'LATE_PAYMENT_APPROVAL_REQUIRED',
      'Administrator must approve the currently verified late bank payment',
    )
}
