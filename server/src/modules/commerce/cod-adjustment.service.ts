import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../config/db.js'
import {
  carriers,
  codCollectionAdjustments,
  codCollections,
  orders as orderTable,
  paymentAllocations,
  paymentClassifications,
  payments,
} from '../../db/schema.js'
import {
  lockCodReceiptIdentity,
  verifiedCodCollection,
} from './cod-reconciliation.service.js'
import type {
  CodCollectionAdjustmentInput,
  PaymentAllocationInput,
} from './commerce.contracts.js'
import {
  appendOrderEvent,
  assertOccurredAt,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  resolveActor,
  type Transaction,
} from './commerce.persistence.js'
import {
  allocatedPaymentsForOrders,
  allocationPlan,
  allocationSnapshot,
  allocationsForCollections,
  allocationsForReceipt,
  allocationTotal,
  auditAllocationChange,
  mergeAllocationPlan,
  replaceAllocations,
} from './payment-allocation.js'
import { finalizeReceipt } from './payment-finalization.js'
import {
  lockAllocationOrders,
  validateAllocationPlan,
} from './payment-receipt.service.js'
import { lockMerchantReceiptIdentity } from './receiving-account.service.js'

function collectionSnapshot(row: typeof codCollections.$inferSelect) {
  return {
    id: row.id,
    orderId: row.orderId,
    carrierId: row.carrierId,
    carrier: row.carrier,
    reference: row.reference,
    currency: row.currency,
    amountVnd: row.amountVnd,
    receivedAt: row.receivedAt.toISOString(),
    revision: row.revision,
    reconciliationRequired: row.reconciliationRequired,
    duplicateOfId: row.duplicateOfId,
  }
}

export function getCodAdjustmentContext(
  userId: string,
  collectionId: string,
  crossCarrier = false,
) {
  return db.transaction(
    async (tx) => {
      await resolveActor(tx, userId, 'admin')
      const [primary] = await tx
        .select()
        .from(codCollections)
        .where(eq(codCollections.id, collectionId))
      if (!primary)
        fail(
          404,
          'COD_COLLECTION_NOT_FOUND',
          'Customer collection was not found',
        )
      const group = await tx
        .select()
        .from(codCollections)
        .where(
          and(
            crossCarrier
              ? undefined
              : eq(codCollections.carrierId, primary.carrierId),
            eq(codCollections.reference, primary.reference),
          ),
        )
        .orderBy(codCollections.id)
      const receipts = await allocatedPaymentsForOrders(tx, [
        ...new Set(group.map((row) => row.orderId)),
      ])
      return {
        primary,
        collections: group,
        receipts,
        orders: await tx
          .select({ id: orderTable.id, code: orderTable.code })
          .from(orderTable)
          .where(
            inArray(orderTable.id, [
              ...new Set(group.map((row) => row.orderId)),
            ]),
          )
          .orderBy(orderTable.id),
        expectedRemittances: receipts
          .filter(
            (row) =>
              !row.duplicateOfId &&
              group.some((item) => item.id === row.codCollectionId),
          )
          .map((row) => ({
            paymentId: row.id,
            allocationId: row.allocationId,
            revision: row.revision,
          })),
        legacyRemittanceCandidates: receipts
          .filter(
            (row) =>
              row.source === 'legacy' &&
              row.recordedPaymentMethod === 'cod' &&
              !row.duplicateOfId,
          )
          .map((row) => ({
            paymentId: row.id,
            allocationId: row.allocationId,
            revision: row.revision,
          })),
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

async function crossCarrierGroup(
  tx: Transaction,
  reference: string,
  merge: NonNullable<CodCollectionAdjustmentInput['crossCarrierMerge']>,
) {
  const selected = await tx
    .select()
    .from(codCollections)
    .where(
      inArray(
        codCollections.id,
        merge.expectedCollections.map((row) => row.id),
      ),
    )
  const carrierIds = [
    ...new Set([...selected.map((row) => row.carrierId), merge.carrierId]),
  ]
  const group = await tx
    .select()
    .from(codCollections)
    .where(
      and(
        eq(codCollections.reference, reference),
        inArray(codCollections.carrierId, carrierIds),
      ),
    )
    .orderBy(codCollections.id)
  if (
    selected.length !== merge.expectedCollections.length ||
    group.length !== selected.length ||
    selected.some((row) => row.reference !== reference) ||
    new Set(selected.map((row) => row.carrierId)).size < 2 ||
    group.some(
      (row) =>
        !merge.expectedCollections.some(
          (expected) =>
            expected.id === row.id && expected.revision === row.revision,
        ) ||
        (row.duplicateOfId &&
          !group.some((root) => root.id === row.duplicateOfId)),
    )
  )
    fail(
      409,
      'COD_CROSS_CARRIER_GROUP_CHANGED',
      'Review every member of the selected receipt identities, including the destination carrier',
    )
  return group
}

export function listCodAdjustmentHistory(
  userId: string,
  collectionId: string,
  input: { limit: number; offset: number },
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'admin')
    return {
      items: await tx
        .select()
        .from(codCollectionAdjustments)
        .where(
          or(
            eq(codCollectionAdjustments.collectionId, collectionId),
            sql`exists (select 1 from jsonb_array_elements(${codCollectionAdjustments.before}->'collections') as member where member->>'id' = ${collectionId})`,
          ),
        )
        .orderBy(
          desc(codCollectionAdjustments.createdAt),
          desc(codCollectionAdjustments.id),
        )
        .limit(input.limit)
        .offset(input.offset),
      ...input,
    }
  })
}

export function listCarrierAllocationWork(
  userId: string,
  input: { limit: number; offset: number },
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'admin')
    const remitted = sql<number>`(select coalesce(sum(${paymentAllocations.amountVnd}), 0)::float8 from ${paymentAllocations}
      inner join ${payments} on ${payments.id} = ${paymentAllocations.paymentId}
      where ${paymentAllocations.codCollectionId} = ${codCollections.id} and ${payments.duplicateOfId} is null and not ${payments.receiptReconciliationRequired})`
    return {
      items: await tx
        .select({
          collection: codCollections,
          remittedVnd: remitted,
          unallocatedCarrierCashVnd: sql<number>`${remitted} - ${codCollections.amountVnd}`,
        })
        .from(codCollections)
        .where(
          and(
            isNull(codCollections.duplicateOfId),
            eq(codCollections.reconciliationRequired, false),
            sql`${remitted} > ${codCollections.amountVnd}`,
          ),
        )
        .orderBy(codCollections.createdAt, codCollections.id)
        .limit(input.limit)
        .offset(input.offset),
      ...input,
    }
  })
}

export function adjustCodCollections(
  command: Command,
  collectionId: string,
  input: CodCollectionAdjustmentInput,
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
      const merge = input.crossCarrierMerge
      if (merge) {
        const initialGroup = await crossCarrierGroup(
          tx,
          metadata.reference,
          merge,
        )
        // Identity locks always precede merchant receipt locks and sorted order locks.
        for (const carrierId of [
          ...new Set([
            ...initialGroup.map((row) => row.carrierId),
            merge.carrierId,
          ]),
        ].sort())
          await lockCodReceiptIdentity(tx, carrierId, metadata.reference)
      } else {
        await lockCodReceiptIdentity(tx, metadata.carrierId, metadata.reference)
      }
      const group = merge
        ? await crossCarrierGroup(tx, metadata.reference, merge)
        : await tx
            .select()
            .from(codCollections)
            .where(
              and(
                eq(codCollections.carrierId, metadata.carrierId),
                eq(codCollections.reference, metadata.reference),
              ),
            )
            .orderBy(codCollections.id)
      const [destinationCarrier] = merge
        ? await tx
            .select()
            .from(carriers)
            .where(eq(carriers.id, merge.carrierId))
        : []
      if (merge && !destinationCarrier)
        fail(404, 'CARRIER_NOT_FOUND', 'Select a registered carrier')
      const primary = group.find((row) => row.id === collectionId)
      if (!primary || primary.revision !== input.expectedRevision)
        fail(
          409,
          'COD_COLLECTION_CHANGED',
          'Refresh the collection revision before adjusting it',
        )
      const groupIds = group.map((row) => row.id)
      const initial = await allocationsForCollections(tx, groupIds)
      const paymentIds = [
        ...new Set([
          ...initial.map((row) => row.id),
          ...input.legacyRemittanceIds,
        ]),
      ]
      const receiptMetadata = paymentIds.length
        ? await tx
            .select()
            .from(payments)
            .where(inArray(payments.id, paymentIds))
        : []
      if (receiptMetadata.length !== paymentIds.length)
        fail(
          404,
          'PAYMENT_NOT_FOUND',
          'A selected physical receipt was not found',
        )
      for (const reference of [
        ...new Set(receiptMetadata.map((row) => row.reference)),
      ].sort())
        await lockMerchantReceiptIdentity(tx, reference)
      const receipts = paymentIds.length
        ? await tx
            .select()
            .from(payments)
            .where(inArray(payments.id, paymentIds))
        : []
      const plans = new Map<
        string,
        Awaited<ReturnType<typeof allocationsForReceipt>>
      >()
      for (const receipt of receipts)
        plans.set(receipt.id, await allocationsForReceipt(tx, receipt.id))
      const targetIds = [
        ...new Set(input.remittanceAllocations.map((row) => row.collectionId)),
      ].filter((id) => !groupIds.includes(id))
      const targets = targetIds.length
        ? await tx
            .select()
            .from(codCollections)
            .where(inArray(codCollections.id, targetIds))
        : []
      if (targets.length !== targetIds.length)
        fail(
          404,
          'COD_ALLOCATION_TARGET_NOT_FOUND',
          'Allocation target was not found',
        )
      const orders = await lockAllocationOrders(
        tx,
        [...group, ...targets]
          .map((row) => row.orderId)
          .concat(
            [...plans.values()].flat().map((row) => row.orderId),
            receipts.map((row) => row.orderId),
          ),
      )
      if (merge) await crossCarrierGroup(tx, metadata.reference, merge)
      if (orders.some((row) => row.paymentMethod !== 'cod'))
        fail(
          409,
          'COD_ORDER_REQUIRED',
          'All adjusted receipt contexts must be COD orders',
        )
      const owner = orders.find((row) => row.id === primary.orderId)
      if (!owner?.deliveredAt)
        fail(
          409,
          'COD_DELIVERY_REQUIRED',
          'A customer collection requires acknowledged delivery',
        )
      assertOccurredAt(
        input.verifiedReceivedAt,
        owner.deliveredAt,
        await databaseNow(tx),
      )
      const selected = await allocationsForCollections(tx, groupIds)
      if (selected.some((row) => !paymentIds.includes(row.id)))
        fail(409, 'COD_REMITTANCES_CHANGED', 'Refresh the remittance manifest')
      for (const id of input.legacyRemittanceIds) {
        const receipt = receipts.find((row) => row.id === id)
        const allocations = plans.get(id) ?? []
        if (
          receipt?.source !== 'legacy' ||
          receipt.method !== 'cod' ||
          receipt.duplicateOfId ||
          allocations.length !== 1 ||
          !group.some((row) => row.orderId === allocations[0]?.orderId) ||
          allocations[0]?.amountVnd !== receipt.amountVnd
        )
          fail(
            409,
            'COD_LEGACY_REMITTANCE_MISMATCH',
            'Verify a complete unclassified COD receipt in this group',
          )
        const [row] = (
          await allocatedPaymentsForOrders(tx, [allocations[0].orderId])
        ).filter((item) => item.id === id)
        if (!row)
          fail(409, 'COD_REMITTANCES_CHANGED', 'Legacy allocation changed')
        selected.push(row)
      }
      if (
        selected.length !== input.expectedRemittances.length ||
        selected.some(
          (row) =>
            !input.expectedRemittances.some(
              (item) =>
                item.allocationId === row.allocationId &&
                item.paymentId === row.id &&
                item.revision === row.revision,
            ),
        )
      )
        fail(
          409,
          'COD_REMITTANCES_CHANGED',
          'Verify every current allocation and receipt revision in this group',
        )
      if (
        input.remittanceAllocations.some(
          (item) =>
            !selected.some((row) => row.allocationId === item.allocationId),
        )
      )
        fail(
          422,
          'COD_ALLOCATION_PAYMENT_MISMATCH',
          'Only selected allocations can be moved',
        )
      if (
        merge &&
        selected.some(
          (row) =>
            !input.remittanceAllocations.some(
              (item) =>
                item.allocationId === row.allocationId &&
                item.amountVnd !== undefined,
            ),
        )
      )
        fail(
          422,
          'COD_MERGE_ALLOCATION_REQUIRED',
          'Explicitly reconcile every allocation when merging receipts across carriers',
        )
      for (const target of targets) {
        const canonical = await verifiedCodCollection(
          tx,
          target.orderId,
          target.id,
        )
        if (canonical.id !== target.id)
          fail(
            409,
            'COD_ALLOCATION_TARGET_DUPLICATE',
            'Use canonical target collection IDs',
          )
      }
      const before = {
        collections: group.map(collectionSnapshot),
        receipts: receipts.map((row) =>
          allocationSnapshot(row, plans.get(row.id) ?? []),
        ),
      }
      await tx
        .update(codCollections)
        .set({ duplicateOfId: null, reconciliationRequired: true })
        .where(inArray(codCollections.id, groupIds))
      for (const row of group)
        await tx
          .update(codCollections)
          .set({
            duplicateOfId: row.id === collectionId ? null : collectionId,
            reconciliationRequired: false,
            revision: row.revision + 1,
            ...(destinationCarrier
              ? {
                  carrierId: destinationCarrier.id,
                  carrier: destinationCarrier.name,
                }
              : {}),
            ...(row.id === collectionId
              ? {
                  amountVnd: input.verifiedAmountVnd,
                  receivedAt: input.verifiedReceivedAt,
                }
              : {}),
          })
          .where(eq(codCollections.id, row.id))
      const afterReceipts = []
      for (const receipt of receipts) {
        const oldAllocations = plans.get(receipt.id) ?? []
        const plan: PaymentAllocationInput[] = oldAllocations.flatMap((row) => {
          if (!selected.some((item) => item.allocationId === row.id))
            return allocationPlan([row])
          const requestedAllocation = input.remittanceAllocations.find(
            (item) => item.allocationId === row.id,
          )
          const amountVnd = requestedAllocation?.amountVnd ?? row.amountVnd
          if (amountVnd > row.amountVnd)
            fail(
              422,
              'COD_MERGE_ALLOCATION_EXCEEDED',
              'An adjustment cannot create additional merchant cash',
            )
          if (amountVnd === 0) return []
          const requested = requestedAllocation?.collectionId ?? collectionId
          if (groupIds.includes(requested) && requested !== collectionId)
            fail(
              422,
              'COD_ALLOCATION_TARGET_DUPLICATE',
              'Use the selected primary for this group',
            )
          const target =
            requested === collectionId
              ? primary
              : targets.find((item) => item.id === requested)
          if (!target)
            fail(
              404,
              'COD_ALLOCATION_TARGET_NOT_FOUND',
              'Target collection was not found',
            )
          return [
            {
              orderId: target.orderId,
              collectionId: requested,
              amountVnd,
            },
          ]
        })
        const source = input.legacyRemittanceIds.includes(receipt.id)
          ? 'carrier'
          : receipt.source
        const merged = mergeAllocationPlan(plan)
        await validateAllocationPlan(
          tx,
          actor,
          { ...receipt, source },
          merged,
          orders,
          { excludePaymentIds: paymentIds, enforceCapacity: false },
        )
        const allocations = await replaceAllocations(tx, receipt, merged)
        const [updated] = await tx
          .update(payments)
          .set({ source, revision: receipt.revision + 1 })
          .where(eq(payments.id, receipt.id))
          .returning()
        if (!updated) fail(404, 'PAYMENT_NOT_FOUND', 'Receipt was not found')
        if (receipt.source === 'legacy')
          await tx.insert(paymentClassifications).values({
            paymentId: receipt.id,
            source: 'carrier',
            codCollectionId: allocations[0]?.codCollectionId ?? collectionId,
            evidenceReference: input.evidenceReference,
            reason: input.reason,
            decidedBy: actor.userId,
          })
        const snapshot = allocationSnapshot(updated, allocations)
        await auditAllocationChange(
          tx,
          actor,
          updated,
          allocationSnapshot(receipt, oldAllocations),
          snapshot,
          input.evidenceReference,
          input.reason,
        )
        afterReceipts.push(snapshot)
      }
      if (merge) {
        for (const target of [
          { ...primary, amountVnd: input.verifiedAmountVnd },
          ...targets,
        ]) {
          const allocated = await allocationsForCollections(tx, [target.id])
          if (allocationTotal(allocated) > target.amountVnd)
            fail(
              409,
              'COD_MERGE_ALLOCATION_EXCEEDED',
              'Release or reallocate excess remittances before completing the merge',
            )
        }
      }
      const after = {
        collections: (
          await tx
            .select()
            .from(codCollections)
            .where(inArray(codCollections.id, groupIds))
            .orderBy(codCollections.id)
        ).map(collectionSnapshot),
        receipts: afterReceipts,
      }
      const [adjustment] = await tx
        .insert(codCollectionAdjustments)
        .values({
          collectionId,
          before,
          after,
          evidenceReference: input.evidenceReference,
          reason: input.reason,
          decidedBy: actor.userId,
        })
        .returning({ id: codCollectionAdjustments.id })
      if (!adjustment)
        fail(
          503,
          'COD_ADJUSTMENT_UNAVAILABLE',
          'Adjustment could not be recorded',
        )
      const balances = []
      for (const order of orders) {
        await appendOrderEvent(tx, actor, order.id, 'cod_collection_adjusted', {
          collectionId,
          adjustmentId: adjustment.id,
          before,
          after,
          evidenceReference: input.evidenceReference,
          reason: input.reason,
          crossCarrierMerge: destinationCarrier
            ? {
                carrierId: destinationCarrier.id,
                carrierName: destinationCarrier.name,
                evidenceVerified: true,
              }
            : null,
        })
        const balance = await finalizeReceipt(tx, actor, order)
        balances.push({
          orderId: order.id,
          orderCode: order.code,
          balancesVerified: balance.balancesVerified,
          amountDueVnd: balance.balancesVerified ? balance.amountDueVnd : null,
          refundDueVnd: balance.balancesVerified ? balance.refundDueVnd : null,
          carrierOverremittedVnd: balance.balancesVerified
            ? balance.carrierOverremittedVnd
            : null,
        })
      }
      return {
        collectionId,
        carrierId: destinationCarrier?.id ?? primary.carrierId,
        adjustmentId: adjustment.id,
        balances,
        unallocatedReceipts: afterReceipts.map((row) => ({
          paymentId: row.paymentId,
          reference: row.reference,
          unallocatedVnd: row.unallocatedVnd,
        })),
      }
    },
  )
}
