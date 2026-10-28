import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../config/db.js'
import {
  orders,
  paymentAllocationAdjustments,
  paymentAllocations,
  paymentReceiptReconciliations,
  payments,
} from '../../db/schema.js'
import type {
  PaymentAllocationAdjustmentInput,
  PaymentReceiptReconciliationInput,
} from './commerce.contracts.js'
import {
  appendOrderEvent,
  assertOccurredAt,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  resolveActor,
} from './commerce.persistence.js'
import {
  allocationPlan,
  allocationSnapshot,
  allocationsForReceipt,
  allocationTotal,
  auditAllocationChange,
  replaceAllocations,
} from './payment-allocation.js'
import { finalizeReceipt } from './payment-finalization.js'
import {
  lockAllocationOrders,
  validateAllocationPlan,
} from './payment-receipt.service.js'
import {
  getReceivingAccount,
  lockMerchantReceiptIdentity,
} from './receiving-account.service.js'

export function listReceiptReconciliationWork(
  userId: string,
  input: { limit: number; offset: number },
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'admin')
    return {
      items: await tx
        .select()
        .from(payments)
        .where(eq(payments.receiptReconciliationRequired, true))
        .orderBy(payments.createdAt, payments.id)
        .limit(input.limit)
        .offset(input.offset),
      ...input,
    }
  })
}

export function listReceiptReconciliationHistory(
  userId: string,
  paymentId: string,
  input: { limit: number; offset: number },
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'admin')
    return {
      items: await tx
        .select()
        .from(paymentReceiptReconciliations)
        .where(eq(paymentReceiptReconciliations.paymentId, paymentId))
        .orderBy(
          desc(paymentReceiptReconciliations.createdAt),
          desc(paymentReceiptReconciliations.id),
        )
        .limit(input.limit)
        .offset(input.offset),
      ...input,
    }
  })
}

export function reconcilePaymentReceipt(
  command: Command,
  paymentId: string,
  input: PaymentReceiptReconciliationInput,
) {
  return executeCommand(
    { ...command, permission: 'admin' },
    async (tx, actor) => {
      const [metadata] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
      if (!metadata)
        fail(404, 'PAYMENT_NOT_FOUND', 'Merchant receipt was not found')
      await lockMerchantReceiptIdentity(tx, metadata.reference)
      const account = await getReceivingAccount(tx, input.receivingAccountId)
      const [canonical] = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.receivingAccountId, account.id),
            eq(payments.reference, metadata.reference),
            eq(payments.receiptReconciliationRequired, false),
            isNull(payments.duplicateOfId),
          ),
        )
      const previousAllocations = await allocationsForReceipt(tx, paymentId)
      const canonicalAllocations = canonical
        ? await allocationsForReceipt(tx, canonical.id)
        : []
      const plan =
        input.allocations ??
        (previousAllocations.length === 1 &&
        previousAllocations[0]?.amountVnd === metadata.amountVnd
          ? allocationPlan(previousAllocations).map((item) => ({
              ...item,
              amountVnd: input.verifiedAmountVnd,
            }))
          : allocationPlan(previousAllocations))
      if (input.duplicateOfId && input.allocations)
        fail(
          422,
          'DUPLICATE_ALLOCATION_FORBIDDEN',
          'A duplicate keeps its history and cannot allocate additional cash',
        )
      const orders = await lockAllocationOrders(tx, [
        metadata.orderId,
        ...previousAllocations.map((item) => item.orderId),
        ...plan.map((item) => item.orderId),
        ...canonicalAllocations.map((item) => item.orderId),
        ...(canonical ? [canonical.orderId] : []),
      ])
      const [receipt] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
        .for('update')
      if (
        !receipt ||
        receipt.orderId !== metadata.orderId ||
        receipt.revision !== input.expectedRevision
      )
        fail(
          409,
          'PAYMENT_CHANGED',
          'Receipt allocation or revision changed; refresh before reconciling',
        )
      if (canonical) {
        const [current] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, canonical.id))
        if (
          !current ||
          current.orderId !== canonical.orderId ||
          current.revision !== canonical.revision
        )
          fail(
            409,
            'PAYMENT_CHANGED',
            'Canonical receipt allocation changed; refresh before reconciling',
          )
      }
      if (receipt.duplicateOfId)
        fail(
          409,
          'PAYMENT_ALREADY_DUPLICATE',
          'The duplicate decision is immutable',
        )
      // Historic entry mistakes must be correctable from real statement evidence.
      // Preserve the old facts below; this operation never issues a transfer.
      assertOccurredAt(
        input.verifiedReceivedAt,
        new Date(0),
        await databaseNow(tx),
      )
      if (input.duplicateOfId) {
        if (
          !canonical ||
          canonical.id !== input.duplicateOfId ||
          canonical.id === paymentId ||
          canonical.amountVnd !== input.verifiedAmountVnd ||
          canonical.receivedAt.getTime() !== input.verifiedReceivedAt.getTime()
        )
          fail(
            409,
            'PAYMENT_DUPLICATE_EVIDENCE_CONFLICT',
            'Select the verified receipt for the same receiving account, transaction, amount and date',
          )
      } else if (canonical && canonical.id !== paymentId) {
        fail(
          409,
          'PAYMENT_REFERENCE_CONFLICT',
          'This account transaction already has a verified receipt; reconcile the duplicate with evidence',
        )
      }
      if (!input.duplicateOfId) {
        if (allocationTotal(plan) > input.verifiedAmountVnd)
          fail(
            409,
            'ALLOCATION_PLAN_REQUIRED',
            'Provide corrected allocations within the verified receipt amount',
          )
        if (receipt.source === 'legacy' && receipt.method === 'cod') {
          if (input.allocations)
            fail(
              409,
              'COD_RECONCILIATION_REQUIRED',
              'Classify legacy COD cash before changing its attribution',
            )
        } else
          await validateAllocationPlan(
            tx,
            actor,
            {
              ...receipt,
              receivingAccountId: account.id,
              amountVnd: input.verifiedAmountVnd,
              receivedAt: input.verifiedReceivedAt,
            },
            plan,
            orders,
            { excludePaymentIds: [receipt.id], enforceCapacity: false },
          )
      }
      const before = allocationSnapshot(receipt, previousAllocations)
      const [updated] = await tx
        .update(payments)
        .set({
          receivingAccountId: account.id,
          receiptReconciliationRequired: false,
          duplicateOfId: input.duplicateOfId ?? null,
          amountVnd: input.verifiedAmountVnd,
          receivedAt: input.verifiedReceivedAt,
          revision: receipt.revision + 1,
        })
        .where(eq(payments.id, paymentId))
        .returning()
      if (!updated)
        fail(404, 'PAYMENT_NOT_FOUND', 'Merchant receipt was not found')
      const nextAllocations = input.duplicateOfId
        ? previousAllocations
        : await replaceAllocations(tx, updated, plan)
      const after = allocationSnapshot(updated, nextAllocations)
      await auditAllocationChange(
        tx,
        actor,
        updated,
        before,
        after,
        input.evidenceReference,
        input.reason,
      )
      const [decision] = await tx
        .insert(paymentReceiptReconciliations)
        .values({
          paymentId,
          evidenceReference: input.evidenceReference,
          reason: input.reason,
          before,
          after,
          decidedBy: actor.userId,
        })
        .returning({ id: paymentReceiptReconciliations.id })
      if (!decision)
        fail(
          503,
          'PAYMENT_RECONCILIATION_UNAVAILABLE',
          'Reconciliation could not be recorded',
        )
      for (const order of orders) {
        await appendOrderEvent(
          tx,
          actor,
          order.id,
          'merchant_receipt_reconciled',
          {
            paymentId,
            reconciliationId: decision.id,
            evidenceReference: input.evidenceReference,
            reason: input.reason,
            before,
            after,
          },
        )
        await finalizeReceipt(tx, actor, order)
      }
      return {
        paymentId,
        orderId: receipt.orderId,
        reconciliationId: decision.id,
        duplicateOfId: updated.duplicateOfId,
      }
    },
  )
}

export function getReceiptAllocationContext(userId: string, paymentId: string) {
  return db.transaction(
    async (tx) => {
      await resolveActor(tx, userId, 'admin')
      const [receipt] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
      if (!receipt) fail(404, 'PAYMENT_NOT_FOUND', 'Receipt was not found')
      const allocations = await allocationsForReceipt(tx, paymentId)
      const orderIds = [...new Set(allocations.map((line) => line.orderId))]
      const orderCodes = orderIds.length
        ? await tx
            .select({ id: orders.id, code: orders.code })
            .from(orders)
            .where(inArray(orders.id, orderIds))
        : []
      const codes = new Map(orderCodes.map((order) => [order.id, order.code]))
      const snapshot = allocationSnapshot(receipt, allocations)
      return {
        receipt,
        allocationRows: allocations,
        ...snapshot,
        allocations: snapshot.allocations.map((line) => {
          const orderCode = codes.get(line.orderId)
          if (!orderCode)
            fail(
              503,
              'ORDER_UNAVAILABLE',
              'Allocated order could not be resolved',
            )
          return { ...line, orderCode }
        }),
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

export function listAllocationHistory(
  userId: string,
  paymentId: string,
  input: { limit: number; offset: number },
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'admin')
    return {
      items: await tx
        .select()
        .from(paymentAllocationAdjustments)
        .where(eq(paymentAllocationAdjustments.paymentId, paymentId))
        .orderBy(
          desc(paymentAllocationAdjustments.createdAt),
          desc(paymentAllocationAdjustments.id),
        )
        .limit(input.limit)
        .offset(input.offset),
      ...input,
    }
  })
}

export function listUnallocatedReceiptWork(
  userId: string,
  input: { limit: number; offset: number },
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'admin')
    const assigned = sql<number>`(select coalesce(sum(${paymentAllocations.amountVnd}), 0)::float8 from ${paymentAllocations}
      where ${paymentAllocations.paymentId} = ${payments.id})`
    return {
      items: await tx
        .select({
          receipt: payments,
          allocatedVnd: assigned,
          unallocatedVnd: sql<number>`${payments.amountVnd} - ${assigned}`,
        })
        .from(payments)
        .where(
          and(
            isNull(payments.duplicateOfId),
            sql`${assigned} < ${payments.amountVnd}`,
          ),
        )
        .orderBy(payments.createdAt, payments.id)
        .limit(input.limit)
        .offset(input.offset),
      ...input,
    }
  })
}

export function adjustPaymentAllocations(
  command: Command,
  paymentId: string,
  input: PaymentAllocationAdjustmentInput,
) {
  return executeCommand(
    { ...command, permission: 'admin' },
    async (tx, actor) => {
      const [metadata] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
      if (!metadata) fail(404, 'PAYMENT_NOT_FOUND', 'Receipt was not found')
      await lockMerchantReceiptIdentity(tx, metadata.reference)
      const [receipt] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
      if (!receipt || receipt.revision !== input.expectedRevision)
        fail(
          409,
          'PAYMENT_CHANGED',
          'Refresh the complete receipt allocation plan before adjusting it',
        )
      if (receipt.duplicateOfId || receipt.receiptReconciliationRequired)
        fail(
          409,
          'RECEIPT_IDENTITY_RECONCILIATION_REQUIRED',
          'Verify the physical receipt identity before allocating its money',
        )
      const previous = await allocationsForReceipt(tx, paymentId)
      const orders = await lockAllocationOrders(tx, [
        receipt.orderId,
        ...previous.map((row) => row.orderId),
        ...input.allocations.map((row) => row.orderId),
      ])
      await validateAllocationPlan(
        tx,
        actor,
        receipt,
        input.allocations,
        orders,
        { excludePaymentIds: [paymentId] },
      )
      const before = allocationSnapshot(receipt, previous)
      const allocations = await replaceAllocations(
        tx,
        receipt,
        input.allocations,
      )
      const [updated] = await tx
        .update(payments)
        .set({ revision: receipt.revision + 1 })
        .where(eq(payments.id, paymentId))
        .returning()
      if (!updated) fail(404, 'PAYMENT_NOT_FOUND', 'Receipt was not found')
      const after = allocationSnapshot(updated, allocations)
      const adjustmentId = await auditAllocationChange(
        tx,
        actor,
        updated,
        before,
        after,
        input.evidenceReference,
        input.reason,
      )
      for (const order of orders) {
        await appendOrderEvent(
          tx,
          actor,
          order.id,
          'payment_allocations_adjusted',
          {
            paymentId,
            adjustmentId,
            evidenceReference: input.evidenceReference,
            reason: input.reason,
            before,
            after,
          },
        )
        await finalizeReceipt(tx, actor, order)
      }
      return {
        paymentId,
        adjustmentId,
        revision: updated.revision,
        unallocatedVnd: updated.amountVnd - allocationTotal(allocations),
      }
    },
  )
}
