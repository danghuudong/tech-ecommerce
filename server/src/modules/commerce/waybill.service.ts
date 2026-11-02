import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { carriers, orderEvents, orders, shipments } from '../../db/schema.js'
import { assertBankPaymentApproved } from './bank-payment-policy.js'
import {
  type CarrierRecipientResultInput,
  type SavedWaybillVerificationInput,
  type WaybillCorrectionInput,
  type WaybillInput,
  waybillVerificationSchema,
} from './commerce.contracts.js'
import {
  appendOrderEvent,
  assertOccurredAt,
  assertOrderAccess,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  lockOrder,
  type Order,
  type Transaction,
} from './commerce.persistence.js'
import type { Actor } from './commerce.types.js'
import { canRecordCarrierRecipientResult } from './order-recipient-policy.js'
import { paymentSummaryForOrder } from './payment-ledger.js'
import { assertReservationActive } from './reservation.service.js'
import {
  canCorrectWaybill,
  recipientMatches,
  waybillVerification,
} from './waybill-policy.js'

type VerificationInput = {
  recipientVerified?: true | undefined
  paymentVerified?: true | undefined
}
type Shipment = typeof shipments.$inferSelect

export function assertWaybillVerification(input: VerificationInput) {
  if (
    !waybillVerificationSchema.safeParse({
      recipientVerified: input.recipientVerified,
      paymentVerified: input.paymentVerified,
    }).success
  )
    fail(
      422,
      'WAYBILL_VERIFICATION_REQUIRED',
      'Verify the recipient and collection instructions on the waybill',
    )
}

function verificationDetails(order: Order, shipment: Shipment) {
  return {
    shipmentId: shipment.id,
    carrierId: shipment.carrierId,
    trackingReference: shipment.trackingReference,
    recipient: { ...order.recipient },
    paymentMethod: order.paymentMethod,
    codAmountVnd: order.paymentMethod === 'cod' ? order.totalVnd : 0,
  }
}

async function verifySavedWaybill(
  tx: Transaction,
  actor: Actor,
  order: Order,
  shipment: Shipment,
  input: VerificationInput,
  requireAll: boolean,
) {
  if (
    shipment.recipientSnapshot &&
    !recipientMatches(shipment.recipientSnapshot, order.recipient)
  )
    fail(
      409,
      'WAYBILL_RECIPIENT_MISMATCH',
      'Reconcile the confirmed waybill recipient with the carrier before handover',
    )
  const events = await tx
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, order.id))
    .orderBy(orderEvents.createdAt, orderEvents.id)
  const verified = waybillVerification(order, shipment, events)
  if (
    requireAll &&
    ((!verified.recipient && input.recipientVerified !== true) ||
      (!verified.payment && input.paymentVerified !== true))
  )
    fail(
      422,
      'WAYBILL_VERIFICATION_REQUIRED',
      'Verify the changed recipient or collection instructions before handover',
    )
  const recipientVerified =
    !verified.recipient && input.recipientVerified === true
  const paymentVerified = !verified.payment && input.paymentVerified === true
  if (recipientVerified || paymentVerified) {
    if (recipientVerified && !shipment.recipientSnapshot)
      await tx
        .update(shipments)
        .set({
          recipientSnapshot: order.recipient,
          updatedAt: await databaseNow(tx),
        })
        .where(eq(shipments.id, shipment.id))
    await appendOrderEvent(tx, actor, order.id, 'waybill_verified', {
      ...verificationDetails(order, shipment),
      recipientVerified,
      paymentVerified,
    })
  }
}

export async function ensureWaybill(
  tx: Transaction,
  actor: Actor,
  order: Order,
  input: Pick<WaybillInput, 'carrierId' | 'trackingReference'> &
    VerificationInput,
) {
  const [existing] = await tx
    .select()
    .from(shipments)
    .where(eq(shipments.orderId, order.id))
    .for('update')
  if (existing) {
    if (
      existing.status !== 'ready_to_ship' ||
      existing.carrierId !== input.carrierId ||
      existing.trackingReference !== input.trackingReference
    )
      fail(
        409,
        'WAYBILL_ALREADY_CONFIRMED',
        'Use the confirmed waybill; carrier changes require verified carrier evidence',
      )
    await verifySavedWaybill(tx, actor, order, existing, input, true)
    return existing
  }
  assertWaybillVerification(input)
  const [carrier] = await tx
    .select({ id: carriers.id })
    .from(carriers)
    .where(eq(carriers.id, input.carrierId))
  if (!carrier) fail(404, 'CARRIER_NOT_FOUND', 'Select a registered carrier')
  const now = await databaseNow(tx)
  const [shipment] = await tx
    .insert(shipments)
    .values({
      orderId: order.id,
      carrierId: input.carrierId,
      trackingReference: input.trackingReference,
      recipientSnapshot: order.recipient,
      status: 'ready_to_ship',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [shipments.carrierId, shipments.trackingReference],
    })
    .returning()
  if (!shipment)
    fail(
      409,
      'TRACKING_REFERENCE_IN_USE',
      'This carrier tracking reference already belongs to another shipment',
    )
  await appendOrderEvent(tx, actor, order.id, 'waybill_confirmed', {
    shipmentId: shipment.id,
    carrierId: shipment.carrierId,
    trackingReference: shipment.trackingReference,
    recipient: { ...order.recipient },
    paymentMethod: order.paymentMethod,
    codAmountVnd: order.paymentMethod === 'cod' ? order.totalVnd : 0,
    recipientVerified: true,
    paymentVerified: true,
  })
  return shipment
}

async function lockPackingOrder(
  tx: Transaction,
  actor: Actor,
  orderId: string,
  expectedRevision: number,
) {
  const order = await lockOrder(tx, orderId)
  assertOrderAccess(actor, order, true)
  if (order.revision !== expectedRevision)
    fail(409, 'ORDER_CHANGED', 'Reload the order before changing its waybill')
  if (order.status !== 'packing' || order.stockState !== 'reserved')
    fail(
      409,
      'WAYBILL_CORRECTION_CLOSED',
      'Waybills can only be changed before handover',
    )
  await assertReservationActive(tx, order)
  if (order.paymentMethod === 'bank_transfer')
    assertBankPaymentApproved(await paymentSummaryForOrder(tx, order))
  return order
}

async function lockReadyWaybill(
  tx: Transaction,
  order: Order,
  shipmentId: string,
) {
  const [shipment] = await tx
    .select()
    .from(shipments)
    .where(eq(shipments.orderId, order.id))
    .for('update')
  if (
    !shipment ||
    shipment.id !== shipmentId ||
    !canCorrectWaybill(order, shipment)
  )
    fail(
      409,
      'WAYBILL_CORRECTION_CLOSED',
      'Only the saved waybill awaiting handover can be changed',
    )
  return shipment
}

export function verifyWaybill(
  command: Command,
  orderId: string,
  input: SavedWaybillVerificationInput,
) {
  return executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      const order = await lockPackingOrder(
        tx,
        actor,
        orderId,
        input.expectedRevision,
      )
      const shipment = await lockReadyWaybill(tx, order, input.shipmentId)
      if (input.recipientVerified !== true && input.paymentVerified !== true)
        fail(
          422,
          'WAYBILL_VERIFICATION_REQUIRED',
          'Select the recipient or collection instructions to verify',
        )
      await verifySavedWaybill(tx, actor, order, shipment, input, false)
      await tx
        .update(orders)
        .set({ revision: order.revision + 1, updatedAt: await databaseNow(tx) })
        .where(eq(orders.id, orderId))
      return { orderId, shipmentId: shipment.id }
    },
  )
}

export function correctWaybill(
  command: Command,
  orderId: string,
  input: WaybillCorrectionInput,
) {
  return executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      const order = await lockPackingOrder(
        tx,
        actor,
        orderId,
        input.expectedRevision,
      )
      const shipment = await lockReadyWaybill(tx, order, input.shipmentId)
      if (
        shipment.carrierId === input.carrierId &&
        shipment.trackingReference === input.trackingReference
      )
        fail(
          422,
          'WAYBILL_UNCHANGED',
          'Change the carrier or tracking reference before saving a correction',
        )
      assertWaybillVerification(input)
      const [carrier] = await tx
        .select()
        .from(carriers)
        .where(eq(carriers.id, input.carrierId))
      if (!carrier)
        fail(404, 'CARRIER_NOT_FOUND', 'Select a registered carrier')
      const [previousCarrier] = shipment.carrierId
        ? await tx
            .select({ name: carriers.name })
            .from(carriers)
            .where(eq(carriers.id, shipment.carrierId))
        : []
      const [conflict] = await tx
        .select({ id: shipments.id })
        .from(shipments)
        .where(
          and(
            eq(shipments.carrierId, input.carrierId),
            eq(shipments.trackingReference, input.trackingReference),
            ne(shipments.id, shipment.id),
          ),
        )
        .limit(1)
      if (conflict)
        fail(
          409,
          'TRACKING_REFERENCE_IN_USE',
          'This carrier tracking reference already belongs to another shipment',
        )
      const now = await databaseNow(tx)
      const [updated] = await tx
        .update(shipments)
        .set({
          carrierId: input.carrierId,
          trackingReference: input.trackingReference,
          recipientSnapshot: order.recipient,
          updatedAt: now,
        })
        .where(eq(shipments.id, shipment.id))
        .returning()
      if (!updated)
        fail(
          409,
          'WAYBILL_CORRECTION_CLOSED',
          'The saved waybill is no longer available',
        )
      await tx
        .update(orders)
        .set({ revision: order.revision + 1, updatedAt: now })
        .where(eq(orders.id, orderId))
      await appendOrderEvent(tx, actor, orderId, 'waybill_corrected', {
        ...verificationDetails(order, updated),
        previousCarrierId: shipment.carrierId,
        previousCarrierName: previousCarrier?.name ?? null,
        previousTrackingReference: shipment.trackingReference,
        carrierName: carrier.name,
        reason: input.reason,
        recipientVerified: true,
        paymentVerified: true,
      })
      return { orderId, shipmentId: shipment.id }
    },
  )
}

export function confirmWaybill(
  command: Command,
  orderId: string,
  input: WaybillInput,
) {
  return executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      const order = await lockPackingOrder(
        tx,
        actor,
        orderId,
        input.expectedRevision,
      )
      const shipment = await ensureWaybill(tx, actor, order, input)
      await tx
        .update(orders)
        .set({ revision: order.revision + 1, updatedAt: await databaseNow(tx) })
        .where(eq(orders.id, orderId))
      return { orderId, shipmentId: shipment.id }
    },
  )
}

export function recordCarrierRecipientResult(
  command: Command,
  orderId: string,
  input: CarrierRecipientResultInput,
) {
  return executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      assertOrderAccess(actor, order, true)
      if (order.revision !== input.expectedRevision)
        fail(
          409,
          'ORDER_CHANGED',
          'Reload the order before recording the carrier result',
        )
      const [shipment] = await tx
        .select()
        .from(shipments)
        .where(eq(shipments.orderId, orderId))
        .for('update')
      if (
        !shipment ||
        shipment.id !== input.shipmentId ||
        shipment.carrierId !== input.carrierId ||
        shipment.trackingReference !== input.trackingReference ||
        !canRecordCarrierRecipientResult(order, shipment)
      )
        fail(
          409,
          'CARRIER_RECIPIENT_CHANGE_CLOSED',
          'Only a confirmed waybill before delivery can receive a recipient change',
        )
      const now = await databaseNow(tx)
      assertOccurredAt(input.confirmedAt, shipment.createdAt, now)
      if (input.evidenceVerified !== true)
        fail(
          422,
          'CARRIER_EVIDENCE_REQUIRED',
          'Verify the carrier response before recording it',
        )
      if (input.outcome === 'accepted') {
        const [previous] = await tx
          .select({ details: orderEvents.details })
          .from(orderEvents)
          .where(
            and(
              eq(orderEvents.orderId, orderId),
              eq(orderEvents.type, 'carrier_recipient_change_recorded'),
              sql`${orderEvents.details}->>'outcome' = 'accepted'`,
              sql`${orderEvents.details}->>'shipmentId' = ${shipment.id}`,
              sql`${orderEvents.details}->>'carrierId' = ${shipment.carrierId}`,
              sql`${orderEvents.details}->>'trackingReference' = ${shipment.trackingReference}`,
            ),
          )
          .orderBy(desc(orderEvents.createdAt), desc(orderEvents.id))
          .limit(1)
        const previousTime = previous?.details.confirmedAt
        if (
          typeof previousTime === 'string' &&
          input.confirmedAt.getTime() <= Date.parse(previousTime)
        )
          fail(
            409,
            'CARRIER_RESULT_OUTDATED',
            'A later carrier recipient update is already recorded; reconcile the latest result',
          )
      }
      if (input.outcome === 'accepted')
        await tx
          .update(shipments)
          .set({ recipientSnapshot: input.recipient, updatedAt: now })
          .where(eq(shipments.id, shipment.id))
      await tx
        .update(orders)
        .set({
          ...(input.outcome === 'accepted'
            ? { recipient: input.recipient }
            : {}),
          revision: order.revision + 1,
          updatedAt: now,
        })
        .where(eq(orders.id, orderId))
      await appendOrderEvent(
        tx,
        actor,
        orderId,
        'carrier_recipient_change_recorded',
        {
          stage: order.status,
          shipmentId: shipment.id,
          carrierId: shipment.carrierId,
          trackingReference: shipment.trackingReference,
          outcome: input.outcome,
          previousRecipient: { ...order.recipient },
          requestedRecipient: { ...input.recipient },
          reference: input.reference,
          reason: input.reason,
          confirmedAt: input.confirmedAt.toISOString(),
          evidenceVerified: true,
        },
      )
      return { orderId, shipmentId: shipment.id, outcome: input.outcome }
    },
  )
}
