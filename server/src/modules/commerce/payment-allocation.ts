import { and, eq, getTableColumns, inArray, isNull } from 'drizzle-orm'
import {
  orders,
  paymentAllocationAdjustments,
  paymentAllocations,
  payments,
  receivingAccounts,
} from '../../db/schema.js'
import type { PaymentAllocationInput } from './commerce.contracts.js'
import { fail, type Transaction } from './commerce.persistence.js'
import type { Actor } from './commerce.types.js'

export const allocatedPaymentColumns = {
  ...getTableColumns(payments),
  method: orders.paymentMethod,
  orderId: paymentAllocations.orderId,
  codCollectionId: paymentAllocations.codCollectionId,
  amountVnd: paymentAllocations.amountVnd,
  allocationId: paymentAllocations.id,
  receiptAmountVnd: payments.amountVnd,
  recordedForOrderId: payments.orderId,
  recordedPaymentMethod: payments.method,
  receivingChannel: receivingAccounts.channel,
  purpose: paymentAllocations.purpose,
  reviewId: paymentAllocations.reviewId,
}
export type AllocatedPayment = typeof payments.$inferSelect & {
  allocationId: string
  receiptAmountVnd: number
  recordedForOrderId: string
  recordedPaymentMethod: typeof payments.$inferSelect.method
  receivingChannel: typeof receivingAccounts.$inferSelect.channel | null
  purpose: typeof paymentAllocations.$inferSelect.purpose
  reviewId: string | null
}

export async function allocatedPaymentsForOrders(
  tx: Transaction,
  orderIds: string[],
): Promise<AllocatedPayment[]> {
  if (!orderIds.length) return []
  return tx
    .select(allocatedPaymentColumns)
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .innerJoin(orders, eq(orders.id, paymentAllocations.orderId))
    .leftJoin(
      receivingAccounts,
      eq(receivingAccounts.id, payments.receivingAccountId),
    )
    .where(inArray(paymentAllocations.orderId, orderIds))
    .orderBy(payments.createdAt, payments.id, paymentAllocations.id)
}

export async function allocationsForReceipt(
  tx: Transaction,
  paymentId: string,
) {
  return tx
    .select()
    .from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, paymentId))
    .orderBy(paymentAllocations.id)
}

export async function allocationsForCollections(
  tx: Transaction,
  collectionIds: string[],
) {
  if (!collectionIds.length) return []
  return tx
    .select(allocatedPaymentColumns)
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .innerJoin(orders, eq(orders.id, paymentAllocations.orderId))
    .leftJoin(
      receivingAccounts,
      eq(receivingAccounts.id, payments.receivingAccountId),
    )
    .where(
      and(
        inArray(paymentAllocations.codCollectionId, collectionIds),
        isNull(payments.duplicateOfId),
      ),
    )
    .orderBy(paymentAllocations.id)
}

export function allocationTotal(items: { amountVnd: number }[]) {
  const total = items.reduce((sum, item) => sum + item.amountVnd, 0)
  if (!Number.isSafeInteger(total))
    fail(
      422,
      'PAYMENT_ALLOCATION_LIMIT',
      'Allocation total exceeds safe integer precision',
    )
  return total
}

export function allocationPlan(
  items: (typeof paymentAllocations.$inferSelect)[],
): PaymentAllocationInput[] {
  return items.map((item) => ({
    orderId: item.orderId,
    amountVnd: item.amountVnd,
    purpose: item.purpose,
    ...(item.reviewId ? { reviewId: item.reviewId } : {}),
    ...(item.codCollectionId ? { collectionId: item.codCollectionId } : {}),
  }))
}

export function mergeAllocationPlan(items: PaymentAllocationInput[]) {
  const result = new Map<string, PaymentAllocationInput>()
  for (const item of items) {
    const key = `${item.orderId}:${item.collectionId ?? 'customer'}:${item.purpose ?? 'payment'}`
    const existing = result.get(key)
    result.set(
      key,
      existing
        ? { ...item, amountVnd: allocationTotal([existing, item]) }
        : item,
    )
  }
  return [...result.values()]
}

export function allocationSnapshot(
  receipt: typeof payments.$inferSelect,
  items: (typeof paymentAllocations.$inferSelect)[],
) {
  return {
    paymentId: receipt.id,
    receiptRevision: receipt.revision,
    receiptAmountVnd: receipt.amountVnd,
    source: receipt.source,
    reference: receipt.reference,
    receivedAt: receipt.receivedAt.toISOString(),
    receivingAccountId: receipt.receivingAccountId,
    recordedForOrderId: receipt.orderId,
    duplicateOfId: receipt.duplicateOfId,
    receiptReconciliationRequired: receipt.receiptReconciliationRequired,
    unallocatedVnd: receipt.duplicateOfId
      ? 0
      : receipt.amountVnd - allocationTotal(items),
    allocations: items.map((item) => ({
      allocationId: item.id,
      orderId: item.orderId,
      collectionId: item.codCollectionId,
      amountVnd: item.amountVnd,
      purpose: item.purpose,
      reviewId: item.reviewId,
    })),
  }
}

// Caller owns the receipt identity lock and every affected order lock. The receipt
// revision serializes the complete plan, including allocations outside one COD group.
export async function replaceAllocations(
  tx: Transaction,
  receipt: typeof payments.$inferSelect,
  plan: PaymentAllocationInput[],
) {
  if (!receipt.duplicateOfId && allocationTotal(plan) > receipt.amountVnd)
    fail(
      409,
      'PAYMENT_ALLOCATION_EXCEEDED',
      'Allocations exceed the money on the physical receipt',
    )
  const before = await allocationsForReceipt(tx, receipt.id)
  const retained = new Set<string>()
  for (const item of plan) {
    const existing = before.find(
      (row) =>
        row.orderId === item.orderId &&
        row.codCollectionId === (item.collectionId ?? null) &&
        row.purpose === (item.purpose ?? 'payment') &&
        row.reviewId === (item.reviewId ?? null),
    )
    if (existing) {
      retained.add(existing.id)
      if (existing.amountVnd !== item.amountVnd)
        await tx
          .update(paymentAllocations)
          .set({ amountVnd: item.amountVnd })
          .where(eq(paymentAllocations.id, existing.id))
    }
  }
  const removed = before
    .filter((row) => !retained.has(row.id))
    .map((row) => row.id)
  if (removed.length)
    await tx
      .delete(paymentAllocations)
      .where(inArray(paymentAllocations.id, removed))
  for (const item of plan) {
    if (
      before.some(
        (row) =>
          retained.has(row.id) &&
          row.orderId === item.orderId &&
          row.codCollectionId === (item.collectionId ?? null) &&
          row.purpose === (item.purpose ?? 'payment') &&
          row.reviewId === (item.reviewId ?? null),
      )
    )
      continue
    await tx.insert(paymentAllocations).values({
      paymentId: receipt.id,
      orderId: item.orderId,
      codCollectionId: item.collectionId ?? null,
      purpose: item.purpose ?? 'payment',
      reviewId: item.reviewId ?? null,
      amountVnd: item.amountVnd,
    })
  }
  return allocationsForReceipt(tx, receipt.id)
}

export async function auditAllocationChange(
  tx: Transaction,
  actor: Actor,
  receipt: typeof payments.$inferSelect,
  before: ReturnType<typeof allocationSnapshot>,
  after: ReturnType<typeof allocationSnapshot>,
  evidenceReference: string,
  reason: string,
) {
  const [record] = await tx
    .insert(paymentAllocationAdjustments)
    .values({
      paymentId: receipt.id,
      before,
      after,
      evidenceReference,
      reason,
      decidedBy: actor.userId,
    })
    .returning({ id: paymentAllocationAdjustments.id })
  if (!record)
    fail(
      503,
      'PAYMENT_ALLOCATION_UNAVAILABLE',
      'Allocation history could not be recorded',
    )
  return record.id
}
