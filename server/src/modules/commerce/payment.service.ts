import { and, eq, isNull, ne } from 'drizzle-orm'
import {
  carriers,
  codCollections,
  collectionDecisions,
  orders,
  paymentClassifications,
  payments,
  shipments,
} from '../../db/schema.js'
import {
  lockCodReceiptIdentity,
  verifiedCodCollection,
} from './cod-reconciliation.service.js'
import { latestCollectionDecision } from './collection-decision.js'
import type {
  BankReconciliationInput,
  CarrierRemittanceInput,
  CodCollectionInput,
  CollectionResolutionInput,
  PaymentClassificationInput,
  PaymentInput,
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
} from './commerce.persistence.js'
import { type Actor, MAX_RECOVERY_ATTEMPTS } from './commerce.types.js'
import {
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
  completeDelivery,
  paymentSummaryForOrder,
  refreshCodOrderFinancials,
} from './payment-ledger.js'
import {
  createReceiptInTransaction,
  lockAllocationOrders,
} from './payment-receipt.service.js'
import { lockMerchantReceiptIdentity } from './receiving-account.service.js'
import { cancelReservedOrder } from './reservation.service.js'

type CollectionParty = 'customer' | 'carrier'

function assertCodReceipt(
  actor: Actor,
  order: Order,
  party: CollectionParty,
  receivedAt: Date,
  now: Date,
) {
  if (
    order.paymentMethod !== 'cod' ||
    !order.deliveredAt ||
    !['delivered', 'completed'].includes(order.status)
  )
    fail(
      409,
      'COD_NOT_DELIVERED',
      'COD receipts require an acknowledged delivery',
    )
  assertOccurredAt(receivedAt, order.deliveredAt, now)
  const failures =
    party === 'carrier'
      ? order.carrierCollectionFailureCount
      : order.collectionFailureCount
  if (failures >= MAX_RECOVERY_ATTEMPTS && actor.role !== 'admin')
    fail(
      403,
      'ADMIN_RECONCILIATION_REQUIRED',
      'Administrator must verify receipts after the failure limit',
    )
}

export function recordPayment(
  command: Command,
  orderId: string,
  input: PaymentInput,
) {
  return executeCommand(
    { ...command, permission: 'accountant' },
    async (tx, actor) => ({
      orderId,
      ...(await createReceiptInTransaction(tx, actor, {
        ...input,
        allocations: [{ orderId, amountVnd: input.amountVnd }],
        evidenceReference: input.reference,
        evidenceVerified: true,
        reason: 'Verified customer payment allocated to the requested order',
      })),
    }),
  )
}
export function recordCodCollection(
  command: Command,
  orderId: string,
  input: CodCollectionInput,
) {
  return executeCommand(
    { ...command, permission: 'accountant' },
    async (tx, actor) => {
      await lockCodReceiptIdentity(tx, input.carrierId, input.reference)
      const order = await lockOrder(tx, orderId)
      assertOrderWorkAccess(actor, order, false)
      const matchingReceipts = await tx
        .select()
        .from(codCollections)
        .where(
          and(
            eq(codCollections.carrierId, input.carrierId),
            eq(codCollections.reference, input.reference),
          ),
        )
      if (matchingReceipts.some((row) => row.reconciliationRequired))
        fail(
          409,
          'COD_COLLECTION_RECONCILIATION_REQUIRED',
          'Administrator must resolve the existing duplicate receipt group',
        )
      const existing = matchingReceipts.find((row) => !row.duplicateOfId)
      if (existing) {
        if (
          existing.orderId !== orderId ||
          existing.amountVnd !== input.amountVnd ||
          existing.currency !== input.currency ||
          existing.receivedAt.getTime() !== input.receivedAt.getTime()
        )
          fail(
            409,
            'COD_COLLECTION_REFERENCE_CONFLICT',
            'Collection reference was used for different details',
          )
        return { orderId, collectionId: existing.id }
      }
      assertCodReceipt(
        actor,
        order,
        'customer',
        input.receivedAt,
        await databaseNow(tx),
      )
      const [carrier] = await tx
        .select()
        .from(carriers)
        .where(eq(carriers.id, input.carrierId))
      if (!carrier)
        fail(404, 'CARRIER_NOT_FOUND', 'Select a registered carrier')
      const [shipment] = await tx
        .select({ carrierId: shipments.carrierId })
        .from(shipments)
        .where(eq(shipments.orderId, orderId))
      if (!shipment?.carrierId)
        fail(
          409,
          'SHIPMENT_CARRIER_REQUIRED',
          'Administrator must identify the historical shipment carrier first',
        )
      if (shipment.carrierId !== input.carrierId)
        fail(
          422,
          'COD_CARRIER_MISMATCH',
          'The collection carrier must match the shipment carrier',
        )
      const [receipt] = await tx
        .insert(codCollections)
        .values({
          carrierId: carrier.id,
          carrier: carrier.name,
          reference: input.reference,
          amountVnd: input.amountVnd,
          currency: input.currency,
          receivedAt: input.receivedAt,
          orderId,
          recordedBy: actor.userId,
        })
        .onConflictDoNothing()
        .returning({ id: codCollections.id })
      if (!receipt)
        fail(
          409,
          'COD_COLLECTION_REFERENCE_CONFLICT',
          'Collection reference was recorded concurrently',
        )
      const summary = await finalizeReceipt(tx, actor, order)
      await appendOrderEvent(tx, actor, orderId, 'customer_paid_carrier', {
        collectionId: receipt.id,
        carrierId: carrier.id,
        carrierCode: carrier.code,
        reference: input.reference,
        amountVnd: input.amountVnd,
        receivedAt: input.receivedAt.toISOString(),
        amountDueVnd: summary.amountDueVnd,
        carrierAmountDueVnd: summary.carrierAmountDueVnd,
      })
      return { orderId, collectionId: receipt.id }
    },
  )
}

export function recordCarrierRemittance(
  command: Command,
  orderId: string,
  input: CarrierRemittanceInput,
) {
  return executeCommand(
    { ...command, permission: 'accountant' },
    async (tx, actor) => {
      const plan =
        'allocations' in input
          ? input.allocations
          : [
              {
                orderId,
                collectionId: input.collectionId,
                amountVnd: input.amountVnd,
              },
            ]
      if (!plan.some((item) => item.orderId === orderId))
        fail(
          422,
          'CARRIER_REMITTANCE_ORDER_REQUIRED',
          'Include the requested order in the remittance allocations',
        )
      await lockMerchantReceiptIdentity(tx, input.reference)
      const allocationOrders = await lockAllocationOrders(
        tx,
        plan.map((item) => item.orderId),
      )
      for (const order of allocationOrders)
        assertOrderWorkAccess(actor, order, false)
      const allocations: {
        orderId: string
        collectionId: string
        amountVnd: number
      }[] = []
      for (const item of plan) {
        const collection = await verifiedCodCollection(
          tx,
          item.orderId,
          item.collectionId,
        )
        if (allocations.some((row) => row.collectionId === collection.id))
          fail(
            422,
            'CARRIER_REMITTANCE_DUPLICATE_COLLECTION',
            'Use each canonical collection only once',
          )
        allocations.push({ ...item, collectionId: collection.id })
      }
      return {
        orderId,
        ...(await createReceiptInTransaction(tx, actor, {
          receivingAccountId: input.receivingAccountId,
          amountVnd: input.amountVnd,
          currency: input.currency,
          reference: input.reference,
          receivedAt: input.receivedAt,
          receiptVerified: input.receiptVerified,
          source: 'carrier',
          method: 'cod',
          allocations,
          evidenceReference: input.reference,
          evidenceVerified: true,
          reason:
            'Verified carrier remittance allocated to customer collections',
        })),
      }
    },
  )
}
export function reconcileBankDeadline(
  command: Command,
  orderId: string,
  input: BankReconciliationInput,
) {
  return executeCommand(
    { ...command, permission: 'accountant' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      assertOrderWorkAccess(actor, order, false)
      if (input.outcome === 'accept_late_payment' && actor.role !== 'admin')
        fail(
          403,
          'ADMIN_RECONCILIATION_REQUIRED',
          'Administrator must approve late payment',
        )
      const now = await databaseNow(tx)
      if (
        actor.role !== 'admin' &&
        (order.paymentReviewEscalatedAt !== null ||
          (order.paymentReviewDueAt !== null &&
            order.paymentReviewDueAt <= now))
      )
        fail(
          403,
          'BANK_RECONCILIATION_ESCALATED',
          'Administrator must reconcile a bank review after its SLA',
        )
      if (
        order.paymentMethod !== 'bank_transfer' ||
        !order.reservationExpiresAt ||
        order.reservationExpiresAt > now ||
        order.stockState !== 'reserved'
      )
        fail(
          409,
          'BANK_RECONCILIATION_NOT_REQUIRED',
          'Only an expired bank reservation can be reconciled',
        )
      if (!order.paymentDeadlineAt)
        fail(
          409,
          'PAYMENT_DEADLINE_UNKNOWN',
          'Original payment deadline must be known before deadline reconciliation',
        )
      assertOccurredAt(
        input.statementCheckedThrough,
        order.paymentDeadlineAt,
        now,
      )
      const summary = await paymentSummaryForOrder(tx, order)
      assertFinancialsVerified(summary)
      if (input.verifiedOnTimeReceivedVnd !== summary.onTimePaidVnd)
        fail(
          409,
          'BANK_STATEMENT_BALANCE_CHANGED',
          'Record all verified statement receipts before reconciling the deadline',
        )
      if (summary.bankPaymentApproved)
        fail(
          409,
          'PAYMENT_RECEIVED_ON_TIME',
          'An order approved for bank fulfillment cannot be cancelled for nonpayment',
        )
      if (
        input.outcome === 'accept_late_payment' &&
        !summary.fulfillmentPaymentSatisfied
      )
        fail(
          409,
          'PAYMENT_REQUIRED',
          'Verify full payment or authorize fulfillment after accepting the refund loss before approving late payment',
        )
      await appendOrderEvent(tx, actor, orderId, 'bank_deadline_reconciled', {
        outcome: input.outcome,
        deadline: order.paymentDeadlineAt.toISOString(),
        statementReference: input.statementReference,
        statementCheckedThrough: input.statementCheckedThrough.toISOString(),
        verifiedOnTimeReceivedVnd: input.verifiedOnTimeReceivedVnd,
        ...(input.outcome === 'accept_late_payment'
          ? {
              paymentEvidenceFingerprint: summary.bankPaymentFingerprint,
            }
          : {}),
        reason: input.reason,
      })
      if (input.outcome === 'cancel_unpaid')
        await cancelReservedOrder(
          tx,
          actor,
          order,
          input.reason,
          now,
          'bank_reconciled',
        )
      else
        await tx
          .update(orders)
          .set({
            reservationExpiresAt: null,
            paymentReviewRequiredAt: null,
            latePaymentAcceptedAt: now,
            staffWorkStartedAt: now,
            latePaymentAcceptedBy: actor.userId,
            latePaymentAcceptedFingerprint: summary.bankPaymentFingerprint,
            revision: order.revision + 1,
            updatedAt: now,
          })
          .where(eq(orders.id, orderId))
      return { orderId, outcome: input.outcome }
    },
  )
}

export function recordCollectionFailure(
  command: Command,
  orderId: string,
  reason: string,
  party: CollectionParty = 'customer',
) {
  return executeCommand(
    { ...command, permission: 'accountant' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      assertOrderWorkAccess(actor, order, false)
      const payment = await paymentSummaryForOrder(tx, order)
      assertFinancialsVerified(payment)
      const amountDueVnd =
        party === 'carrier'
          ? payment.carrierAmountDueVnd
          : payment.purchaseAmountDueVnd
      const resolution =
        party === 'carrier'
          ? order.carrierCollectionResolution
          : order.collectionResolution
      const failures =
        party === 'carrier'
          ? order.carrierCollectionFailureCount
          : order.collectionFailureCount
      if (
        order.paymentMethod !== 'cod' ||
        !['delivered', 'completed'].includes(order.status) ||
        resolution !== 'open' ||
        amountDueVnd <= 0
      )
        fail(
          409,
          'COLLECTION_NOT_OUTSTANDING',
          'Only an unresolved delivered COD balance can be retried',
        )
      if (failures >= MAX_RECOVERY_ATTEMPTS)
        fail(
          409,
          'COLLECTION_RETRY_EXHAUSTED',
          'Administrator must verify receipts or resolve the balance',
        )
      const failureCount = failures + 1
      await tx
        .update(orders)
        .set({
          ...(party === 'carrier'
            ? {
                carrierCollectionFailureCount: failureCount,
                carrierCollectionIssueReason: reason,
              }
            : {
                collectionFailureCount: failureCount,
                collectionIssueReason: reason,
              }),
          revision: order.revision + 1,
          updatedAt: await databaseNow(tx),
        })
        .where(eq(orders.id, orderId))
      await appendOrderEvent(tx, actor, orderId, 'cod_collection_failed', {
        party,
        reason,
        failureCount,
        amountDueVnd,
        nextOperation:
          failureCount < MAX_RECOVERY_ATTEMPTS
            ? 'verify_collection_receipt'
            : 'admin_resolve_collection',
      })
      return { orderId, party, failureCount }
    },
  )
}

export function classifyLegacyCodPayment(
  command: Command,
  orderId: string,
  paymentId: string,
  input: PaymentClassificationInput,
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
      const order = await lockOrder(tx, orderId)
      const allocations = await allocationsForReceipt(tx, paymentId)
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
        .for('update')
      if (payment?.method !== 'cod' || order.paymentMethod !== 'cod')
        fail(
          404,
          'LEGACY_COD_PAYMENT_NOT_FOUND',
          'COD receipt was not found for this order',
        )
      if (payment.duplicateOfId)
        fail(
          409,
          'PAYMENT_RECEIPT_DUPLICATE',
          'A duplicate merchant receipt cannot be classified as additional money',
        )
      const collection =
        input.source === 'carrier'
          ? await verifiedCodCollection(tx, orderId, input.collectionId)
          : null
      const [existing] = await tx
        .select()
        .from(paymentClassifications)
        .where(eq(paymentClassifications.paymentId, paymentId))
      if (existing) {
        if (
          existing.source !== input.source ||
          existing.codCollectionId !== (collection?.id ?? null) ||
          existing.evidenceReference !== input.evidenceReference ||
          existing.reason !== input.reason
        )
          fail(
            409,
            'PAYMENT_CLASSIFICATION_CONFLICT',
            'Receipt classification is immutable',
          )
        return { orderId, paymentId, classificationId: existing.id }
      }
      if (payment.source !== 'legacy')
        fail(
          409,
          'PAYMENT_NOT_LEGACY',
          'Only an unclassified legacy COD receipt can be classified',
        )
      if (
        allocations.length !== 1 ||
        allocations[0]?.orderId !== orderId ||
        allocations[0].amountVnd !== payment.amountVnd
      )
        fail(
          409,
          'LEGACY_ALLOCATION_CHANGED',
          'Classify a complete legacy allocation for this order',
        )
      if (collection) {
        assertOccurredAt(
          payment.receivedAt,
          collection.receivedAt,
          await databaseNow(tx),
        )
        const remittances = (
          await allocationsForCollections(tx, [collection.id])
        ).filter((row) => row.id !== paymentId)
        const remaining = collection.amountVnd - allocationTotal(remittances)
        if (payment.amountVnd > remaining)
          fail(
            409,
            'CARRIER_REMITTANCE_EXCEEDED',
            'Legacy receipt exceeds the unremitted collection balance',
          )
      }
      const [updatedPayment] = await tx
        .update(payments)
        .set({
          source: input.source,
          revision: payment.revision + 1,
        })
        .where(eq(payments.id, paymentId))
        .returning()
      if (!updatedPayment)
        fail(404, 'PAYMENT_NOT_FOUND', 'Receipt was not found')
      const next = await replaceAllocations(tx, updatedPayment, [
        {
          orderId,
          amountVnd: payment.amountVnd,
          ...(collection ? { collectionId: collection.id } : {}),
        },
      ])
      await auditAllocationChange(
        tx,
        actor,
        updatedPayment,
        allocationSnapshot(payment, allocations),
        allocationSnapshot(updatedPayment, next),
        input.evidenceReference,
        input.reason,
      )
      const [classification] = await tx
        .insert(paymentClassifications)
        .values({
          paymentId,
          source: input.source,
          codCollectionId: collection?.id ?? null,
          evidenceReference: input.evidenceReference,
          reason: input.reason,
          decidedBy: actor.userId,
        })
        .returning({ id: paymentClassifications.id })
      if (!classification)
        fail(
          503,
          'PAYMENT_CLASSIFICATION_UNAVAILABLE',
          'Classification could not be recorded',
        )
      await appendOrderEvent(
        tx,
        actor,
        orderId,
        'legacy_cod_payment_classified',
        {
          paymentId,
          classificationId: classification.id,
          previousSource: 'legacy',
          source: input.source,
          collectionId: collection?.id ?? null,
          amountVnd: payment.amountVnd,
          evidenceReference: input.evidenceReference,
          reason: input.reason,
        },
      )
      const summary = await refreshCodOrderFinancials(tx, actor, order)
      return {
        orderId,
        paymentId,
        classificationId: classification.id,
        balancesVerified: summary.balancesVerified,
        customerPaidVnd: summary.customerPaidVnd,
        merchantReceivedVnd: summary.merchantReceivedVnd,
        carrierRemittedVnd: summary.carrierRemittedVnd,
      }
    },
  )
}

export function resolveCollection(
  command: Command,
  orderId: string,
  input: CollectionResolutionInput,
) {
  return executeCommand(
    { ...command, permission: 'admin' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      const [responsibleCarrier] =
        input.party === 'carrier'
          ? await tx
              .select({ id: carriers.id, name: carriers.name })
              .from(shipments)
              .innerJoin(carriers, eq(carriers.id, shipments.carrierId))
              .where(eq(shipments.orderId, orderId))
          : []
      if (input.party === 'carrier' && !responsibleCarrier)
        fail(
          409,
          'SHIPMENT_CARRIER_REQUIRED',
          'Identify the shipment carrier before approving its collection decision',
        )
      const responsibleParty =
        responsibleCarrier?.name ?? input.responsibleParty
      const [existing] = await tx
        .select()
        .from(collectionDecisions)
        .where(eq(collectionDecisions.reference, input.reference))
      if (existing) {
        if (
          existing.orderId !== orderId ||
          existing.party !== input.party ||
          existing.disposition !== input.disposition ||
          existing.reason !== input.reason ||
          existing.amountVnd !== input.amountVnd ||
          existing.responsibleParty !== responsibleParty ||
          existing.responsibleCarrierId !== (responsibleCarrier?.id ?? null) ||
          existing.kind !== 'resolution'
        )
          fail(
            409,
            'COLLECTION_RESOLUTION_CONFLICT',
            'A different decision is already recorded',
          )
        return { orderId, decisionId: existing.id }
      }
      const payment = await paymentSummaryForOrder(tx, order)
      assertFinancialsVerified(payment)
      if (responsibleCarrier) {
        const [mismatch] = await tx
          .select({ id: codCollections.id })
          .from(codCollections)
          .where(
            and(
              eq(codCollections.orderId, orderId),
              isNull(codCollections.duplicateOfId),
              ne(codCollections.carrierId, responsibleCarrier.id),
            ),
          )
          .limit(1)
        if (mismatch)
          fail(
            409,
            'CARRIER_DECISION_IDENTITY_MISMATCH',
            'Reconcile the shipment and collection carrier identities before approving carrier debt',
          )
      }
      const amountDueVnd =
        input.party === 'carrier'
          ? payment.carrierAmountDueVnd
          : payment.purchaseAmountDueVnd
      const failures =
        input.party === 'carrier'
          ? order.carrierCollectionFailureCount
          : order.collectionFailureCount
      const resolution =
        input.party === 'carrier'
          ? order.carrierCollectionResolution
          : order.collectionResolution
      const previous = latestCollectionDecision(
        await tx
          .select()
          .from(collectionDecisions)
          .where(
            and(
              eq(collectionDecisions.orderId, orderId),
              eq(collectionDecisions.party, input.party),
            ),
          )
          .orderBy(collectionDecisions.createdAt, collectionDecisions.id),
        input.party,
      )
      const increasedBalance =
        previous !== undefined &&
        (input.party === 'carrier'
          ? payment.carrierDecision.unresolvedVnd
          : payment.customerDecision.unresolvedVnd) > 0
      if (
        order.paymentMethod !== 'cod' ||
        !['delivered', 'completed'].includes(order.status) ||
        failures < MAX_RECOVERY_ATTEMPTS ||
        (!['open', 'debt'].includes(resolution) &&
          !(
            resolution === 'written_off' &&
            input.disposition === 'written_off' &&
            increasedBalance
          )) ||
        (resolution === 'debt' &&
          input.disposition === 'debt' &&
          !increasedBalance) ||
        amountDueVnd <= 0
      )
        fail(
          409,
          'COLLECTION_RESOLUTION_FORBIDDEN',
          'Only an exhausted outstanding COD balance can be resolved',
        )
      if (input.amountVnd !== amountDueVnd)
        fail(
          409,
          'COLLECTION_BALANCE_CHANGED',
          'Reload the outstanding balance before approving a decision',
        )
      const [decision] = await tx
        .insert(collectionDecisions)
        .values({
          orderId,
          ...input,
          responsibleParty,
          responsibleCarrierId: responsibleCarrier?.id ?? null,
          supersedesDecisionId: input.party === 'carrier' ? previous?.id : null,
          cashReceivedVndAtDecision:
            input.party === 'carrier'
              ? payment.carrierRemittedVnd
              : payment.purchaseCashVnd,
          decidedBy: actor.userId,
        })
        .onConflictDoNothing({ target: collectionDecisions.reference })
        .returning({ id: collectionDecisions.id })
      if (!decision)
        fail(
          409,
          'COLLECTION_REFERENCE_CONFLICT',
          'Decision reference was used for another resolution',
        )
      const [updated] = await tx
        .update(orders)
        .set({
          ...(input.party === 'carrier'
            ? { carrierCollectionResolution: input.disposition }
            : { collectionResolution: input.disposition }),
          revision: order.revision + 1,
          updatedAt: await databaseNow(tx),
        })
        .where(eq(orders.id, orderId))
        .returning()
      if (!updated) fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
      await appendOrderEvent(tx, actor, orderId, 'cod_collection_resolved', {
        decisionId: decision.id,
        party: input.party,
        disposition: input.disposition,
        amountVnd: input.amountVnd,
        responsibleParty,
        responsibleCarrierId: responsibleCarrier?.id ?? null,
        reference: input.reference,
        reason: input.reason,
      })
      await completeDelivery(tx, actor, updated)
      return { orderId, decisionId: decision.id }
    },
  )
}
