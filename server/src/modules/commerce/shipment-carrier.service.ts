import { createHash } from 'node:crypto'
import { and, eq, inArray, ne, notInArray, or } from 'drizzle-orm'
import { db } from '../../config/db.js'
import {
  carriers,
  codCollections,
  collectionDecisions,
  orders,
  shipments,
} from '../../db/schema.js'
import { lockCodReceiptIdentity } from './cod-reconciliation.service.js'
import { latestCollectionDecision } from './collection-decision.js'
import type { ShipmentCarrierInput } from './commerce.contracts.js'
import {
  appendOrderEvent,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  lockOrder,
  type Order,
  resolveActor,
  type Transaction,
} from './commerce.persistence.js'
import { allocatedPaymentsForOrders } from './payment-allocation.js'
import { paymentSummaryForOrder } from './payment-ledger.js'

async function readCarrierContext(tx: Transaction, order: Order) {
  const [shipment] = await tx
    .select()
    .from(shipments)
    .where(eq(shipments.orderId, order.id))
  if (!shipment)
    fail(409, 'SHIPMENT_REQUIRED', 'Order has not been handed over')
  const owned = await tx
    .select()
    .from(codCollections)
    .where(eq(codCollections.orderId, order.id))
    .orderBy(codCollections.id)
  const roots = owned.filter((row) => !row.duplicateOfId)
  const rootsById = new Map(roots.map((row) => [row.id, row]))
  // Keep a reconciled physical receipt and its inactive duplicates in one identity group.
  const records = roots.length
    ? await tx
        .select()
        .from(codCollections)
        .where(
          or(
            eq(codCollections.orderId, order.id),
            inArray(
              codCollections.duplicateOfId,
              roots.map((row) => row.id),
            ),
            ...roots.map((row) =>
              and(
                eq(codCollections.carrierId, row.carrierId),
                eq(codCollections.reference, row.reference),
              ),
            ),
          ),
        )
        .orderBy(codCollections.id)
    : owned
  const [carrier] = shipment.carrierId
    ? await tx
        .select()
        .from(carriers)
        .where(eq(carriers.id, shipment.carrierId))
    : []
  const collections = records.map((row) => {
    const root = rootsById.get(row.duplicateOfId ?? row.id)
    return {
      id: row.id,
      orderId: row.orderId,
      canonicalRootId: root?.id ?? null,
      carrierId: row.carrierId,
      carrierName: row.carrier,
      reference: row.reference,
      revision: row.revision,
      amountVnd: row.amountVnd,
      currency: row.currency,
      receivedAt: row.receivedAt.toISOString(),
      duplicateOfId: row.duplicateOfId,
      reconciliationRequired: row.reconciliationRequired,
      active: !row.duplicateOfId && !row.reconciliationRequired,
    }
  })
  const relatedOrderIds = [
    ...new Set([
      order.id,
      ...collections
        .filter((row) => row.canonicalRootId)
        .map((row) => row.orderId),
    ]),
  ].sort()
  const collectionIds = new Set(collections.map((row) => row.id))
  const receipts = (await allocatedPaymentsForOrders(tx, relatedOrderIds))
    .filter(
      (row) =>
        row.orderId === order.id ||
        (row.codCollectionId && collectionIds.has(row.codCollectionId)),
    )
    .map((row) => ({
      id: row.id,
      allocationId: row.allocationId,
      orderId: row.orderId,
      collectionId: row.codCollectionId,
      revision: row.revision,
      reference: row.reference,
      amountVnd: row.amountVnd,
      receiptAmountVnd: row.receiptAmountVnd,
      source: row.source,
      receivedAt: row.receivedAt.toISOString(),
      receivingAccountId: row.receivingAccountId,
      duplicateOfId: row.duplicateOfId,
      reconciliationRequired: row.receiptReconciliationRequired,
    }))
  const decisionRecords = await tx
    .select()
    .from(collectionDecisions)
    .where(
      and(
        eq(collectionDecisions.orderId, order.id),
        eq(collectionDecisions.party, 'carrier'),
      ),
    )
    .orderBy(collectionDecisions.createdAt, collectionDecisions.id)
  const currentDecision = latestCollectionDecision(decisionRecords, 'carrier')
  const decisions = decisionRecords.map((row) => ({
    id: row.id,
    disposition: row.disposition,
    amountVnd: row.amountVnd,
    responsibleParty: row.responsibleParty,
    responsibleCarrierId: row.responsibleCarrierId,
    supersedesDecisionId: row.supersedesDecisionId,
    kind: row.kind,
    cashReceivedVndAtDecision: row.cashReceivedVndAtDecision,
    current: row.id === currentDecision?.id,
    reference: row.reference,
    createdAt: row.createdAt.toISOString(),
  }))
  const financials = await paymentSummaryForOrder(tx, order)
  const codReviewPending =
    !financials.balancesVerified ||
    records.some((row) => {
      const root = rootsById.get(row.duplicateOfId ?? row.id)
      return (
        row.reconciliationRequired ||
        (row.orderId !== order.id && !root) ||
        (root &&
          (root.carrierId !== row.carrierId ||
            root.reference !== row.reference))
      )
    })
  const snapshot = {
    orderId: order.id,
    orderRevision: order.revision,
    shipment: {
      id: shipment.id,
      carrierId: shipment.carrierId,
      carrierName: carrier?.name ?? null,
      trackingReference: shipment.trackingReference,
    },
    collections,
    receipts,
    decisions,
    carrierDecisionBalance: {
      receivableVnd: financials.balancesVerified
        ? financials.carrierDecision.debtVnd
        : null,
      writtenOffVnd: financials.balancesVerified
        ? financials.carrierDecision.writtenOffVnd
        : null,
      unresolvedVnd: financials.balancesVerified
        ? financials.carrierDecision.unresolvedVnd
        : null,
    },
    codReviewPending: Boolean(codReviewPending),
  }
  return {
    ...snapshot,
    fingerprint: createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex'),
    relatedOrderIds,
  }
}

export function getShipmentCarrierContext(userId: string, orderId: string) {
  return db.transaction(
    async (tx) => {
      await resolveActor(tx, userId, 'admin')
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
      if (!order) fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
      return readCarrierContext(tx, order)
    },
    { isolationLevel: 'repeatable read' },
  )
}

export function identifyShipmentCarrier(
  command: Command,
  orderId: string,
  input: ShipmentCarrierInput,
) {
  return executeCommand(
    { ...command, permission: 'admin' },
    async (tx, actor) => {
      const [metadata] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
      if (!metadata) fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
      const initial = await readCarrierContext(tx, metadata)
      if (initial.fingerprint !== input.expectedFingerprint)
        fail(
          409,
          'SHIPMENT_CARRIER_CONTEXT_CHANGED',
          'Review the current shipment and COD evidence before saving',
        )

      // Match the receipt writers' identity -> order lock order, including destination identities.
      const identities = new Map<
        string,
        { carrierId: string; reference: string }
      >()
      for (const row of initial.collections) {
        for (const carrierId of [
          row.carrierId,
          ...(row.canonicalRootId ? [input.carrierId] : []),
        ])
          identities.set(`${carrierId}:${row.reference}`, {
            carrierId,
            reference: row.reference,
          })
      }
      for (const key of [...identities.keys()].sort()) {
        const identity = identities.get(key)
        if (identity)
          await lockCodReceiptIdentity(
            tx,
            identity.carrierId,
            identity.reference,
          )
      }
      const lockedOrders: Order[] = []
      for (const id of initial.relatedOrderIds)
        lockedOrders.push(await lockOrder(tx, id))
      const order = lockedOrders.find((row) => row.id === orderId)
      if (!order) fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
      const context = await readCarrierContext(tx, order)
      if (context.fingerprint !== input.expectedFingerprint)
        fail(
          409,
          'SHIPMENT_CARRIER_CONTEXT_CHANGED',
          'Shipment, collection or remittance evidence changed while reviewing',
        )
      const [carrier] = await tx
        .select()
        .from(carriers)
        .where(eq(carriers.id, input.carrierId))
      if (!carrier)
        fail(404, 'CARRIER_NOT_FOUND', 'Select a registered carrier')

      const changedCollections = context.collections.filter(
        (row) => row.canonicalRootId && row.carrierId !== carrier.id,
      )
      // Establishing shipment identity must remain possible before legacy cash can
      // be classified. Re-attributing existing collection identities needs verified cash.
      if (changedCollections.length && context.codReviewPending)
        fail(
          409,
          'SHIPMENT_COD_REVIEW_REQUIRED',
          'Resolve ambiguous COD receipts and remittances before changing collection carrier identities',
        )
      const carrierChanged = context.shipment.carrierId !== carrier.id
      const previousDecision = context.decisions.find((row) => row.current)
      const responsibilityRequired = Boolean(
        previousDecision &&
          previousDecision.responsibleCarrierId !== carrier.id,
      )
      if (
        responsibilityRequired &&
        (!input.responsibilityCorrection ||
          input.responsibilityCorrection.expectedDecisionId !==
            previousDecision?.id)
      )
        fail(
          409,
          'CARRIER_RESPONSIBILITY_CORRECTION_REQUIRED',
          'Verify a replacement responsibility decision for the current carrier decision',
        )
      if (
        input.responsibilityCorrection &&
        (!responsibilityRequired ||
          input.responsibilityCorrection.expectedDecisionId !==
            previousDecision?.id)
      )
        fail(
          409,
          'SHIPMENT_CARRIER_CONTEXT_CHANGED',
          'Refresh the current carrier responsibility decision',
        )
      if (
        !carrierChanged &&
        !changedCollections.length &&
        !responsibilityRequired
      )
        fail(
          409,
          'SHIPMENT_CARRIER_UNCHANGED',
          'The shipment and COD evidence already use this carrier',
        )
      const financialEvidence =
        context.collections.some((row) => row.active) ||
        context.receipts.some(
          (row) => !row.duplicateOfId && row.source === 'carrier',
        ) ||
        context.decisions.length > 0
      const reconciliationRequired =
        responsibilityRequired ||
        changedCollections.length > 0 ||
        (carrierChanged &&
          context.shipment.carrierId !== null &&
          financialEvidence)
      if (reconciliationRequired && !input.codReconciliation)
        fail(
          409,
          'SHIPMENT_COD_RECONCILIATION_REQUIRED',
          'Verify the existing collections, remittances and carrier debt evidence before changing attribution',
        )

      const roots = context.collections.filter(
        (row) => row.id === row.canonicalRootId,
      )
      if (
        changedCollections.length &&
        new Set(roots.map((row) => row.reference)).size !== roots.length
      )
        fail(
          409,
          'COD_CARRIER_REFERENCE_CONFLICT',
          'Distinct existing receipts would share one carrier reference',
        )
      if (changedCollections.length) {
        const groupIds = context.collections
          .filter((row) => row.canonicalRootId)
          .map((row) => row.id)
        const [collision] = await tx
          .select({ id: codCollections.id })
          .from(codCollections)
          .where(
            and(
              eq(codCollections.carrierId, carrier.id),
              inArray(
                codCollections.reference,
                changedCollections.map((row) => row.reference),
              ),
              notInArray(codCollections.id, groupIds),
            ),
          )
          .limit(1)
        if (collision)
          fail(
            409,
            'COD_CARRIER_REFERENCE_CONFLICT',
            'The destination carrier reference already belongs to another receipt group',
          )
      }
      const [trackingConflict] = await tx
        .select({ id: shipments.id })
        .from(shipments)
        .where(
          and(
            eq(shipments.carrierId, carrier.id),
            eq(shipments.trackingReference, context.shipment.trackingReference),
            ne(shipments.id, context.shipment.id),
          ),
        )
        .limit(1)
      if (trackingConflict)
        fail(
          409,
          'TRACKING_REFERENCE_IN_USE',
          'The carrier tracking reference is already used by another shipment',
        )

      const corrections = []
      for (const row of changedCollections) {
        await tx
          .update(codCollections)
          .set({
            carrierId: carrier.id,
            carrier: carrier.name,
            revision: row.revision + 1,
          })
          .where(eq(codCollections.id, row.id))
        corrections.push({
          ...row,
          previousCarrierId: row.carrierId,
          previousCarrierName: row.carrierName,
          carrierId: carrier.id,
          carrierName: carrier.name,
          previousRevision: row.revision,
          revision: row.revision + 1,
        })
      }
      const now = await databaseNow(tx)
      let responsibilityDecisionId: string | null = null
      if (previousDecision && input.responsibilityCorrection) {
        const [replacement] = await tx
          .insert(collectionDecisions)
          .values({
            orderId,
            party: 'carrier',
            kind: 'responsibility_correction',
            supersedesDecisionId: previousDecision.id,
            responsibleCarrierId: carrier.id,
            responsibleParty: carrier.name,
            // Retain the original approval and recovery baseline. Reassigning
            // responsibility never renews debt, increases coverage or forgives cash.
            disposition: previousDecision.disposition,
            amountVnd: previousDecision.amountVnd,
            cashReceivedVndAtDecision:
              previousDecision.cashReceivedVndAtDecision,
            reference: input.responsibilityCorrection.reference,
            reason: input.reason,
            decidedBy: actor.userId,
          })
          .onConflictDoNothing({ target: collectionDecisions.reference })
          .returning({ id: collectionDecisions.id })
        if (!replacement)
          fail(
            409,
            'COLLECTION_REFERENCE_CONFLICT',
            'Use a new reference for the responsibility correction decision',
          )
        responsibilityDecisionId = replacement.id
        await appendOrderEvent(
          tx,
          actor,
          orderId,
          'carrier_responsibility_corrected',
          {
            decisionId: replacement.id,
            supersedesDecisionId: previousDecision.id,
            previousReference: previousDecision.reference,
            previousResponsibleParty: previousDecision.responsibleParty,
            previousCarrierId: previousDecision.responsibleCarrierId,
            responsibleParty: carrier.name,
            responsibleCarrierId: carrier.id,
            disposition: previousDecision.disposition,
            amountVnd: previousDecision.amountVnd,
            cashReceivedVndAtDecision:
              previousDecision.cashReceivedVndAtDecision,
            reference: input.responsibilityCorrection.reference,
            evidenceReference:
              input.codReconciliation?.evidenceReference ??
              input.evidenceReference,
            evidenceVerified: true,
            reason: input.reason,
          },
        )
      }
      if (carrierChanged)
        await tx
          .update(shipments)
          .set({ carrierId: carrier.id, updatedAt: now })
          .where(eq(shipments.id, context.shipment.id))
      const type = context.shipment.carrierId
        ? 'shipment_carrier_corrected'
        : 'shipment_carrier_identified'
      const changedOrderIds = new Set([
        orderId,
        ...changedCollections.map((row) => row.orderId),
      ])
      for (const related of lockedOrders) {
        if (!changedOrderIds.has(related.id)) continue
        // Identity corrections preserve cash amounts, allocations, delivery and stock facts.
        await tx
          .update(orders)
          .set({ revision: related.revision + 1, updatedAt: now })
          .where(eq(orders.id, related.id))
        if (!carrierChanged && !changedCollections.length) continue
        await appendOrderEvent(
          tx,
          actor,
          related.id,
          related.id === orderId ? type : 'cod_carrier_corrected',
          {
            shipmentId: context.shipment.id,
            shipmentOrderId: orderId,
            previousCarrierId: context.shipment.carrierId,
            previousCarrierName: context.shipment.carrierName,
            carrierId: carrier.id,
            carrierName: carrier.name,
            trackingReference: context.shipment.trackingReference,
            evidenceReference: input.evidenceReference,
            evidenceVerified: true,
            reason: input.reason,
            codEvidenceReference:
              input.codReconciliation?.evidenceReference ?? null,
            codEvidenceVerified: Boolean(input.codReconciliation),
            reviewedFingerprint: input.expectedFingerprint,
            collectionCorrections: corrections,
            reviewedCollections: context.collections,
            reviewedReceipts: context.receipts,
            reviewedCarrierDecisions: context.decisions,
            responsibilityDecisionId,
          },
        )
      }
      return {
        orderId,
        shipmentId: context.shipment.id,
        responsibilityDecisionId,
      }
    },
  )
}
