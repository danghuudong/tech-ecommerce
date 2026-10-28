import { eq } from 'drizzle-orm'
import {
  checkoutQuotes,
  paymentBalanceReviews,
  payments,
} from '../../db/schema.js'
import { verifiedCodCollection } from './cod-reconciliation.service.js'
import type {
  PaymentAllocationInput,
  PaymentReceiptCreateInput,
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
  type Order,
  type Transaction,
} from './commerce.persistence.js'
import { type Actor, MAX_RECOVERY_ATTEMPTS } from './commerce.types.js'
import {
  allocatedPaymentsForOrders,
  allocationPlan,
  allocationSnapshot,
  allocationsForCollections,
  allocationsForReceipt,
  allocationTotal,
  auditAllocationChange,
  replaceAllocations,
} from './payment-allocation.js'
import { finalizeReceipt } from './payment-finalization.js'
import {
  assertFinancialsVerified,
  paymentSummaryForOrder,
} from './payment-ledger.js'
import {
  findMerchantReceipt,
  getReceivingAccount,
  lockMerchantReceiptIdentity,
} from './receiving-account.service.js'

export async function lockAllocationOrders(tx: Transaction, ids: string[]) {
  const result: Order[] = []
  for (const id of [...new Set(ids)].sort())
    result.push(await lockOrder(tx, id))
  return result
}

export async function validateAllocationPlan(
  tx: Transaction,
  actor: Actor,
  receipt: Pick<
    typeof payments.$inferSelect,
    'method' | 'source' | 'amountVnd' | 'receivedAt' | 'receivingAccountId'
  >,
  plan: PaymentAllocationInput[],
  orders: Order[],
  options: { excludePaymentIds?: string[]; enforceCapacity?: boolean } = {},
) {
  if (allocationTotal(plan) > receipt.amountVnd)
    fail(
      409,
      'PAYMENT_ALLOCATION_EXCEEDED',
      'Allocated money exceeds the physical receipt',
    )
  if (receipt.source === 'legacy' && receipt.method === 'cod')
    fail(
      409,
      'COD_RECONCILIATION_REQUIRED',
      'Classify the legacy COD receipt before changing its allocations',
    )
  const now = await databaseNow(tx)
  const account = receipt.receivingAccountId
    ? await getReceivingAccount(tx, receipt.receivingAccountId)
    : null
  const verified: PaymentAllocationInput[] = []
  let remittingCarrierId: string | undefined
  for (const item of plan) {
    const order = orders.find((row) => row.id === item.orderId)
    if (!order)
      fail(
        409,
        'PAYMENT_ALLOCATION_ORDER_CHANGED',
        'Allocation order is not locked',
      )
    assertOrderWorkAccess(actor, order, false)
    if (item.purpose === 'refund_recovery') {
      if (actor.role !== 'admin')
        fail(
          403,
          'ADMIN_RECONCILIATION_REQUIRED',
          'Only an administrator can record refund recovery',
        )
      if (
        receipt.source === 'carrier' ||
        item.collectionId ||
        !item.reviewId ||
        !account
      )
        fail(
          422,
          'REFUND_RECOVERY_MISMATCH',
          'Refund recovery requires identified customer cash and its balance review',
        )
      const [review] = await tx
        .select()
        .from(paymentBalanceReviews)
        .where(eq(paymentBalanceReviews.id, item.reviewId))
      if (!review || review.orderId !== order.id)
        fail(
          404,
          'PAYMENT_REVIEW_NOT_FOUND',
          'Balance review was not found for this order',
        )
      const summary = await paymentSummaryForOrder(tx, order)
      assertFinancialsVerified(summary)
      const previous = (
        await allocatedPaymentsForOrders(tx, [order.id])
      ).filter(
        (row) =>
          row.purpose === 'refund_recovery' &&
          !row.duplicateOfId &&
          !row.receiptReconciliationRequired &&
          options.excludePaymentIds?.includes(row.id),
      )
      if (
        item.amountVnd >
        summary.refundDiscrepancyVnd + allocationTotal(previous)
      )
        fail(
          409,
          'REFUND_RECOVERY_EXCEEDED',
          'Recovery exceeds the verified refund discrepancy',
        )
      const firstSettlement = summary.settlements
        .map((row) => row.settledAt)
        .sort((a, b) => a.getTime() - b.getTime())[0]
      if (!firstSettlement)
        fail(
          409,
          'REFUND_RECOVERY_NOT_DUE',
          'No executed refund can be recovered',
        )
      assertOccurredAt(receipt.receivedAt, firstSettlement, now)
      verified.push(item)
      continue
    }
    if (
      order.paymentMethod === 'bank_transfer' &&
      account?.channel !== 'bank_transfer'
    )
      fail(
        422,
        'RECEIVING_CHANNEL_MISMATCH',
        'A prepaid bank order requires a bank receiving account',
      )
    if (receipt.source === 'carrier') {
      if (order.paymentMethod !== 'cod')
        fail(
          422,
          'PAYMENT_SOURCE_MISMATCH',
          'Carrier remittances require COD orders',
        )
      if (!item.collectionId)
        fail(
          422,
          'COD_COLLECTION_REQUIRED',
          'Carrier money requires a verified customer collection',
        )
      const collection = await verifiedCodCollection(
        tx,
        order.id,
        item.collectionId,
      )
      if (collection.id !== item.collectionId)
        fail(409, 'COD_COLLECTION_DUPLICATE', 'Use the canonical collection ID')
      if (remittingCarrierId && remittingCarrierId !== collection.carrierId)
        fail(
          422,
          'CARRIER_REMITTANCE_CARRIER_MISMATCH',
          'A carrier remittance must belong to one carrier',
        )
      remittingCarrierId = collection.carrierId
      assertOccurredAt(receipt.receivedAt, collection.receivedAt, now)
      if (options.enforceCapacity !== false) {
        const others = (
          await allocationsForCollections(tx, [collection.id])
        ).filter((row) => !options.excludePaymentIds?.includes(row.id))
        if (item.amountVnd > collection.amountVnd - allocationTotal(others))
          fail(
            409,
            'CARRIER_REMITTANCE_EXCEEDED',
            'Allocation exceeds the collection amount not yet remitted',
          )
      }
    } else if (item.collectionId)
      fail(
        422,
        'PAYMENT_SOURCE_MISMATCH',
        'Customer money cannot be counted as a carrier remittance',
      )
    if (order.paymentMethod === 'cod') {
      if (
        !order.deliveredAt ||
        !['delivered', 'completed'].includes(order.status)
      )
        fail(
          409,
          'COD_NOT_DELIVERED',
          'COD allocations require an acknowledged delivery',
        )
      assertOccurredAt(receipt.receivedAt, order.deliveredAt, now)
      const failures =
        receipt.source === 'carrier'
          ? order.carrierCollectionFailureCount
          : order.collectionFailureCount
      if (failures >= MAX_RECOVERY_ATTEMPTS && actor.role !== 'admin')
        fail(
          403,
          'ADMIN_RECONCILIATION_REQUIRED',
          'Administrator must verify money after the collection failure limit',
        )
    } else {
      const [quote] = await tx
        .select({ createdAt: checkoutQuotes.createdAt })
        .from(checkoutQuotes)
        .where(eq(checkoutQuotes.id, order.quoteId))
      if (!quote) fail(404, 'QUOTE_NOT_FOUND', 'Checkout quote was not found')
      assertOccurredAt(receipt.receivedAt, quote.createdAt, now)
    }
    verified.push(item)
  }
  return verified
}

export async function createReceiptInTransaction(
  tx: Transaction,
  actor: Actor,
  input: PaymentReceiptCreateInput,
) {
  if (
    input.allocations.some((row) => row.purpose === 'refund_recovery') &&
    actor.role !== 'admin'
  )
    fail(
      403,
      'ADMIN_RECONCILIATION_REQUIRED',
      'Only an administrator can record refund recovery',
    )
  if (allocationTotal(input.allocations) > input.amountVnd)
    fail(
      422,
      'PAYMENT_ALLOCATION_EXCEEDED',
      'Allocated money exceeds the physical receipt',
    )
  await lockMerchantReceiptIdentity(tx, input.reference)
  const account = await getReceivingAccount(tx, input.receivingAccountId)
  const orders = await lockAllocationOrders(
    tx,
    input.allocations.map((row) => row.orderId),
  )
  for (const order of orders) assertOrderWorkAccess(actor, order, false)
  const existing = await findMerchantReceipt(
    tx,
    input.receivingAccountId,
    input.reference,
  )
  if (existing) {
    const previous = await allocationsForReceipt(tx, existing.id)
    const plan = allocationPlan(previous)
    if (
      (existing.source === 'carrier') !== (input.source === 'carrier') ||
      existing.amountVnd !== input.amountVnd ||
      existing.currency !== input.currency ||
      existing.receivedAt.getTime() !== input.receivedAt.getTime() ||
      plan.length !== input.allocations.length ||
      !plan.every((row) =>
        input.allocations.some(
          (item) =>
            item.orderId === row.orderId &&
            item.collectionId === row.collectionId &&
            (item.purpose ?? 'payment') === (row.purpose ?? 'payment') &&
            item.reviewId === row.reviewId &&
            item.amountVnd === row.amountVnd,
        ),
      )
    )
      fail(
        409,
        'PAYMENT_REFERENCE_CONFLICT',
        'The physical receipt already has different facts or current allocations',
      )
    return {
      paymentId: existing.id,
      revision: existing.revision,
      allocationIds: previous.map((row) => row.id),
      unallocatedVnd: existing.amountVnd - allocationTotal(previous),
    }
  }
  const first = input.allocations[0]
  if (!first)
    fail(422, 'PAYMENT_ALLOCATION_REQUIRED', 'Select an initial allocation')
  const firstOrder = orders.find((order) => order.id === first.orderId)
  if (!firstOrder)
    fail(404, 'ORDER_NOT_FOUND', 'Initial allocation order was not found')
  const method =
    input.source === 'carrier'
      ? 'cod'
      : (input.method ?? firstOrder.paymentMethod)
  await validateAllocationPlan(
    tx,
    actor,
    { ...input, method },
    input.allocations,
    orders,
  )
  const [receipt] = await tx
    .insert(payments)
    .values({
      orderId: first.orderId,
      codCollectionId: first.collectionId ?? null,
      method,
      source: input.source,
      receivingAccountId: account.id,
      receiptReconciliationRequired: false,
      reference: input.reference,
      amountVnd: input.amountVnd,
      currency: input.currency,
      receivedAt: input.receivedAt,
      recordedBy: actor.userId,
    })
    .onConflictDoNothing()
    .returning()
  if (!receipt)
    fail(
      409,
      'PAYMENT_REFERENCE_CONFLICT',
      'The physical receipt was recorded concurrently',
    )
  const allocations = await replaceAllocations(tx, receipt, input.allocations)
  await auditAllocationChange(
    tx,
    actor,
    receipt,
    allocationSnapshot(receipt, []),
    allocationSnapshot(receipt, allocations),
    input.evidenceReference,
    input.reason,
  )
  for (const order of orders) {
    const summary = await finalizeReceipt(tx, actor, order)
    const own = allocations.filter((row) => row.orderId === order.id)
    const paymentAmountVnd = allocationTotal(
      own.filter((row) => row.purpose === 'payment'),
    )
    const recoveredRefundVnd = allocationTotal(
      own.filter((row) => row.purpose === 'refund_recovery'),
    )
    await appendOrderEvent(
      tx,
      actor,
      order.id,
      recoveredRefundVnd > 0 && paymentAmountVnd === 0
        ? 'refund_recovery_received'
        : input.source === 'carrier'
          ? 'carrier_remittance_received'
          : 'payment_received',
      {
        paymentId: receipt.id,
        amountVnd: paymentAmountVnd,
        source: input.source,
        recoveredRefundVnd,
        receivedAt: receipt.receivedAt.toISOString(),
        balancesVerified: summary.balancesVerified,
        amountDueVnd: summary.balancesVerified ? summary.amountDueVnd : null,
      },
    )
  }
  return {
    paymentId: receipt.id,
    revision: receipt.revision,
    allocationIds: allocations.map((row) => row.id),
    unallocatedVnd: receipt.amountVnd - allocationTotal(allocations),
  }
}

export function recordPaymentReceipt(
  command: Command,
  input: PaymentReceiptCreateInput,
) {
  return executeCommand({ ...command, permission: 'accountant' }, (tx, actor) =>
    createReceiptInTransaction(tx, actor, input),
  )
}
