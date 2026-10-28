import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../config/db.js'
import {
  carriers,
  codCollectionReconciliations,
  codCollections,
  payments,
} from '../../db/schema.js'
import {
  appendOrderEvent,
  type Command,
  executeCommand,
  fail,
  lockOrder,
  resolveActor,
  type Transaction,
} from './commerce.persistence.js'
import {
  allocationPlan,
  allocationSnapshot,
  allocationsForCollections,
  allocationsForReceipt,
  auditAllocationChange,
  mergeAllocationPlan,
  replaceAllocations,
} from './payment-allocation.js'
import { refreshCodOrderFinancials } from './payment-ledger.js'
import { lockMerchantReceiptIdentity } from './receiving-account.service.js'

export function createCarrier(
  command: Command,
  input: { code: string; name: string },
) {
  return executeCommand(
    { ...command, permission: 'admin' },
    async (tx, actor) => {
      const code = input.code.trim().toLowerCase()
      const [carrier] = await tx
        .insert(carriers)
        .values({ code, name: input.name, createdBy: actor.userId })
        .onConflictDoNothing({ target: carriers.code })
        .returning({ id: carriers.id })
      if (!carrier)
        fail(
          409,
          'CARRIER_CODE_EXISTS',
          'Canonical carrier code is already registered',
        )
      return { carrierId: carrier.id, code }
    },
  )
}

export async function listCarriers(
  userId: string,
  input: { limit: number; offset: number; q?: string | undefined },
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'workforce')
    const filter = input.q
      ? sql`strpos(lower(concat_ws(' ', ${carriers.code}, ${carriers.name})), lower(${input.q})) > 0`
      : undefined
    const [count] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(carriers)
      .where(filter)
    return {
      total: count?.total ?? 0,
      items: await tx
        .select()
        .from(carriers)
        .where(filter)
        .orderBy(carriers.code)
        .limit(input.limit)
        .offset(input.offset),
      ...input,
    }
  })
}

export async function listCodReconciliationWork(
  userId: string,
  input: { limit: number; offset: number },
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'admin')
    return {
      items: await tx
        .select({ collection: codCollections, carrierCode: carriers.code })
        .from(codCollections)
        .innerJoin(carriers, eq(carriers.id, codCollections.carrierId))
        .where(eq(codCollections.reconciliationRequired, true))
        .orderBy(
          codCollections.carrierId,
          codCollections.reference,
          codCollections.id,
        )
        .limit(input.limit)
        .offset(input.offset),
      ...input,
    }
  })
}

// Every operation creating or resolving a receipt acquires this before order locks.
export async function lockCodReceiptIdentity(
  tx: Transaction,
  carrierId: string,
  reference: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(7348023, hashtext(${`${carrierId}:${reference}`}))`,
  )
}

// Order lock protects remittance amounts and any canonical-link changes.
export async function verifiedCodCollection(
  tx: Transaction,
  orderId: string,
  collectionId: string,
) {
  let [collection] = await tx
    .select()
    .from(codCollections)
    .where(eq(codCollections.id, collectionId))
  if (!collection || collection.orderId !== orderId)
    fail(
      404,
      'COD_COLLECTION_NOT_FOUND',
      'Customer collection was not found for this order',
    )
  if (collection.duplicateOfId) {
    const [canonical] = await tx
      .select()
      .from(codCollections)
      .where(eq(codCollections.id, collection.duplicateOfId))
    if (!canonical || canonical.orderId !== orderId)
      fail(
        409,
        'COD_COLLECTION_DUPLICATE',
        'Collection belongs to a reconciled receipt on another order',
      )
    collection = canonical
  }
  if (collection.reconciliationRequired || collection.duplicateOfId)
    fail(
      409,
      'COD_COLLECTION_RECONCILIATION_REQUIRED',
      'Administrator must verify the ambiguous receipt group first',
    )
  return collection
}

export function reconcileCodCollections(
  command: Command,
  collectionId: string,
  input: {
    evidenceReference: string
    reason: string
    evidenceVerified: true
    verifiedAmountVnd: number
    verifiedReceivedAt: Date
  },
) {
  return executeCommand(
    { ...command, permission: 'admin' },
    async (tx, actor) => {
      const [metadata] = await tx
        .select()
        .from(codCollections)
        .where(eq(codCollections.id, collectionId))
      if (!metadata)
        fail(
          404,
          'COD_COLLECTION_NOT_FOUND',
          'Customer collection was not found',
        )
      await lockCodReceiptIdentity(tx, metadata.carrierId, metadata.reference)
      const group = await tx
        .select()
        .from(codCollections)
        .where(
          and(
            eq(codCollections.carrierId, metadata.carrierId),
            eq(codCollections.reference, metadata.reference),
          ),
        )
        .orderBy(codCollections.id)
      const receiptMetadata = await allocationsForCollections(
        tx,
        group.map((row) => row.id),
      )
      for (const reference of [
        ...new Set(receiptMetadata.map((row) => row.reference)),
      ].sort())
        await lockMerchantReceiptIdentity(tx, reference)
      const lockedOrders = []
      for (const orderId of [
        ...new Set(group.map((row) => row.orderId)),
      ].sort())
        lockedOrders.push(await lockOrder(tx, orderId))
      const [existing] = await tx
        .select()
        .from(codCollectionReconciliations)
        .where(eq(codCollectionReconciliations.collectionId, collectionId))
      if (existing) {
        const retained = group.find((row) => row.id === collectionId)
        if (
          existing.evidenceReference !== input.evidenceReference ||
          existing.reason !== input.reason ||
          retained?.amountVnd !== input.verifiedAmountVnd ||
          retained.receivedAt.getTime() !== input.verifiedReceivedAt.getTime()
        )
          fail(
            409,
            'COD_RECONCILIATION_CONFLICT',
            'A different reconciliation was already recorded',
          )
        return { collectionId, reconciliationId: existing.id }
      }
      const primary = group.find((row) => row.id === collectionId)
      if (
        !primary ||
        group.length < 2 ||
        group.some((row) => !row.reconciliationRequired || row.duplicateOfId) ||
        lockedOrders.some((order) => order.paymentMethod !== 'cod')
      )
        fail(
          409,
          'COD_RECONCILIATION_NOT_REQUIRED',
          'Select a primary receipt from an unresolved duplicate group',
        )
      if (
        primary.amountVnd !== input.verifiedAmountVnd ||
        primary.receivedAt.getTime() !== input.verifiedReceivedAt.getTime()
      )
        fail(
          409,
          'COD_RECEIPT_EVIDENCE_CONFLICT',
          'Verified statement amount and date must match the retained receipt',
        )
      const groupIds = group.map((row) => row.id)
      const remittances = await allocationsForCollections(tx, groupIds)
      if (
        remittances.some(
          (row) => !receiptMetadata.some((previous) => previous.id === row.id),
        )
      )
        fail(
          409,
          'COD_REMITTANCES_CHANGED',
          'Refresh the receipt group before reconciling',
        )
      if (
        remittances.some((receipt) => receipt.orderId !== primary.orderId) ||
        remittances.reduce((sum, receipt) => sum + receipt.amountVnd, 0) >
          primary.amountVnd
      )
        fail(
          409,
          'COD_REMITTANCE_EVIDENCE_CONFLICT',
          'Use the evidence-based collection adjustment to correct merchant cash allocations or collection facts',
        )
      const duplicates = group
        .filter((row) => row.id !== collectionId)
        .map((row) => row.id)
      for (const paymentId of [...new Set(remittances.map((row) => row.id))]) {
        const [receipt] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, paymentId))
        if (!receipt) fail(404, 'PAYMENT_NOT_FOUND', 'Receipt was not found')
        const previous = await allocationsForReceipt(tx, paymentId)
        const plan = mergeAllocationPlan(
          allocationPlan(previous).map((row) =>
            row.collectionId && duplicates.includes(row.collectionId)
              ? { ...row, collectionId }
              : row,
          ),
        )
        const next = await replaceAllocations(tx, receipt, plan)
        const [updated] = await tx
          .update(payments)
          .set({ revision: receipt.revision + 1 })
          .where(eq(payments.id, paymentId))
          .returning()
        if (!updated) fail(404, 'PAYMENT_NOT_FOUND', 'Receipt was not found')
        await auditAllocationChange(
          tx,
          actor,
          updated,
          allocationSnapshot(receipt, previous),
          allocationSnapshot(updated, next),
          input.evidenceReference,
          input.reason,
        )
      }
      await tx
        .update(codCollections)
        .set({
          duplicateOfId: collectionId,
          reconciliationRequired: false,
          revision: sql`${codCollections.revision} + 1`,
        })
        .where(inArray(codCollections.id, duplicates))
      await tx
        .update(codCollections)
        .set({ reconciliationRequired: false, revision: primary.revision + 1 })
        .where(eq(codCollections.id, collectionId))
      const [reconciliation] = await tx
        .insert(codCollectionReconciliations)
        .values({
          collectionId,
          duplicateIds: duplicates,
          evidenceReference: input.evidenceReference,
          reason: input.reason,
          decidedBy: actor.userId,
        })
        .returning({ id: codCollectionReconciliations.id })
      if (!reconciliation)
        fail(
          503,
          'COD_RECONCILIATION_UNAVAILABLE',
          'Reconciliation could not be recorded',
        )
      for (const order of lockedOrders) {
        await appendOrderEvent(
          tx,
          actor,
          order.id,
          'cod_collections_reconciled',
          {
            collectionId,
            duplicateIds: duplicates,
            reconciliationId: reconciliation.id,
            evidenceReference: input.evidenceReference,
            reason: input.reason,
            verifiedAmountVnd: input.verifiedAmountVnd,
            verifiedReceivedAt: input.verifiedReceivedAt.toISOString(),
          },
        )
        await refreshCodOrderFinancials(tx, actor, order)
      }
      return {
        collectionId,
        reconciliationId: reconciliation.id,
        duplicateIds: duplicates,
      }
    },
  )
}
