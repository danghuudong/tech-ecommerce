import { and, eq } from 'drizzle-orm'
import { orderEvents, payments, receivingAccounts } from '../../db/schema.js'
import {
  BANK_TRANSFER_DEMO_COMPLETED,
  canCompleteDemoBankTransfer,
  demoBankTransferEnabled,
} from './bank-transfer-demo.js'
import { resolveBankTransferInstructions } from './bank-transfer-instructions.js'
import { bankTransferNotices } from './bank-transfer-notice.js'
import {
  appendOrderEvent,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  lockOrder,
} from './commerce.persistence.js'
import {
  allocatedPaymentsForOrders,
  allocationSnapshot,
  auditAllocationChange,
  replaceAllocations,
} from './payment-allocation.js'
import { finalizeReceipt } from './payment-finalization.js'
import { paymentSummaryForOrder } from './payment-ledger.js'
import { lockMerchantReceiptIdentity } from './receiving-account.service.js'

// This demo entry deliberately records synthetic cash when explicitly enabled.
// It never calls a bank or impersonates an accountant. Keep it off for real sales.
export function completeDemoBankTransfer(command: Command, orderId: string) {
  if (!demoBankTransferEnabled())
    fail(404, 'NOT_FOUND', 'Payment operation was not found')
  return executeCommand(
    { ...command, permission: 'signed_in' },
    async (tx, actor) => {
      const reference = `DEMO-BANK-${orderId}`
      // Preserve the receipt identity -> order lock order used by real receipts.
      await lockMerchantReceiptIdentity(tx, reference)
      const order = await lockOrder(tx, orderId)
      if (order.userId !== actor.userId)
        fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
      const summary = await paymentSummaryForOrder(tx, order)
      const events = await tx
        .select()
        .from(orderEvents)
        .where(eq(orderEvents.orderId, orderId))
        .orderBy(orderEvents.createdAt, orderEvents.id)
      const previous = events.find(
        (event) => event.type === BANK_TRANSFER_DEMO_COMPLETED,
      )
      if (previous) {
        if (
          order.status !== 'cancelled' &&
          !order.deletedAt &&
          summary.bankPaymentApproved &&
          summary.amountDueVnd === 0
        )
          return {
            orderId,
            status: 'paid',
            paymentId: previous.details.paymentId ?? null,
          }
        fail(
          409,
          'BANK_TRANSFER_PAYMENT_UNAVAILABLE',
          'The simulated payment was corrected; reconcile it before continuing',
        )
      }
      if (
        bankTransferNotices(
          events,
          await allocatedPaymentsForOrders(tx, [orderId]),
        ).some((notice) => notice.status === 'pending')
      )
        fail(
          409,
          'BANK_TRANSFER_NOTICE_PENDING',
          'Review the pending notice first',
        )
      const now = await databaseNow(tx)
      if (!canCompleteDemoBankTransfer(order, summary, now))
        fail(
          409,
          'BANK_TRANSFER_PAYMENT_UNAVAILABLE',
          'This order is no longer eligible for payment',
        )
      const bank = await resolveBankTransferInstructions(
        tx,
        order.bankInstructions,
      )
      if (!bank?.bankBin || !/^\d{6,19}$/.test(bank.accountNumber))
        fail(
          409,
          'BANK_TRANSFER_NOT_CONFIGURED',
          'Receiving bank is unavailable',
        )

      // Keep synthetic receipts separate from the real receiving account.
      const accountReference = `demo-${bank.accountNumber}`
      await tx
        .insert(receivingAccounts)
        .values({
          channel: 'bank_transfer',
          providerCode: bank.bankBin,
          bankBin: bank.bankBin,
          accountReference,
          name: `DEMO ${bank.bankName} ${bank.accountHolder}`,
          createdBy: actor.userId,
        })
        .onConflictDoNothing()
      const [account] = await tx
        .select()
        .from(receivingAccounts)
        .where(
          and(
            eq(receivingAccounts.channel, 'bank_transfer'),
            eq(receivingAccounts.providerCode, bank.bankBin),
            eq(receivingAccounts.accountReference, accountReference),
          ),
        )
      if (!account)
        fail(
          503,
          'RECEIVING_ACCOUNT_NOT_FOUND',
          'Demo receiving account is unavailable',
        )
      const [receipt] = await tx
        .insert(payments)
        .values({
          orderId,
          method: 'bank_transfer',
          source: 'customer',
          receivingAccountId: account.id,
          receiptReconciliationRequired: false,
          reference,
          amountVnd: summary.amountDueVnd,
          currency: 'VND',
          receivedAt: now,
          recordedBy: actor.userId,
        })
        .returning()
      if (!receipt)
        fail(503, 'PAYMENT_UNAVAILABLE', 'Payment could not be recorded')
      const allocations = await replaceAllocations(tx, receipt, [
        { orderId, amountVnd: receipt.amountVnd, purpose: 'payment' },
      ])
      await auditAllocationChange(
        tx,
        actor,
        receipt,
        allocationSnapshot(receipt, []),
        allocationSnapshot(receipt, allocations),
        reference,
        'Demo payment; no real bank transaction or accountant verification',
      )
      await finalizeReceipt(tx, actor, order)
      await appendOrderEvent(tx, actor, orderId, BANK_TRANSFER_DEMO_COMPLETED, {
        paymentId: receipt.id,
        amountVnd: receipt.amountVnd,
        receivedAt: now.toISOString(),
        reference,
        mode: 'demo',
      })
      return { orderId, status: 'paid', paymentId: receipt.id }
    },
  )
}
