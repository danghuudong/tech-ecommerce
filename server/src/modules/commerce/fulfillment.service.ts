import { eq } from 'drizzle-orm'
import { carriers, orders, shipments } from '../../db/schema.js'
import { assertBankPaymentApproved } from './bank-payment-policy.js'
import {
  appendOrderEvent,
  assertOccurredAt,
  assertOrderAccess,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  getOrderItems,
  lockOrder,
  type Transaction,
} from './commerce.persistence.js'
import { MAX_RECOVERY_ATTEMPTS, type ReceiptLine } from './commerce.types.js'
import { changeStock } from './inventory.service.js'
import {
  completeDelivery,
  paymentSummaryForOrder,
  refundUnallocatedPayment,
} from './payment-ledger.js'
import { assertReservationActive } from './reservation.service.js'

async function lockShipment(tx: Transaction, orderId: string) {
  const [shipment] = await tx
    .select()
    .from(shipments)
    .where(eq(shipments.orderId, orderId))
    .for('update')
  if (!shipment)
    fail(409, 'SHIPMENT_REQUIRED', 'Order has not been handed over')
  return shipment
}

export function dispatchOrder(
  command: Command,
  orderId: string,
  input: {
    carrierId: string
    trackingReference: string
    expectedRevision: number
  },
) {
  return executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      assertOrderAccess(actor, order, true)
      if (order.revision !== input.expectedRevision)
        fail(409, 'ORDER_CHANGED', 'Reload the order before handover')
      if (order.status !== 'packing')
        fail(409, 'INVALID_ORDER_STATE', 'Pack the order before handover')
      await assertReservationActive(tx, order)
      if (order.paymentMethod === 'bank_transfer')
        assertBankPaymentApproved(await paymentSummaryForOrder(tx, order))
      const [carrier] = await tx
        .select({ id: carriers.id })
        .from(carriers)
        .where(eq(carriers.id, input.carrierId))
      if (!carrier)
        fail(404, 'CARRIER_NOT_FOUND', 'Select a registered carrier')
      const [shipment] = await tx
        .insert(shipments)
        .values({ orderId, ...input })
        .onConflictDoNothing({
          target: [shipments.carrierId, shipments.trackingReference],
        })
        .returning({ id: shipments.id })
      if (!shipment)
        fail(
          409,
          'TRACKING_REFERENCE_IN_USE',
          'This carrier tracking reference already belongs to another shipment',
        )
      for (const item of await getOrderItems(tx, orderId))
        await changeStock(tx, actor, {
          productId: item.productId,
          orderId,
          kind: 'ship',
          onHandDelta: -item.quantity,
          reservedDelta: -item.quantity,
          reason: 'Shipment handed over',
          reference: shipment.id,
        })
      const now = await databaseNow(tx)
      await tx
        .update(orders)
        .set({
          status: 'shipped',
          stockState: 'committed',
          revision: order.revision + 1,
          updatedAt: now,
        })
        .where(eq(orders.id, orderId))
      await appendOrderEvent(tx, actor, orderId, 'shipment_handed_over', {
        shipmentId: shipment.id,
        carrierId: input.carrierId,
        trackingReference: input.trackingReference,
      })
      return { orderId, shipmentId: shipment.id }
    },
  )
}

export function recordDelivery(
  command: Command,
  orderId: string,
  input: {
    proofReference?: string | undefined
    deliveredAt: Date
    expectedRevision: number
  },
) {
  const proofReference = input.proofReference ?? null
  return executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      assertOrderAccess(actor, order, true)
      const shipment = await lockShipment(tx, orderId)
      if (order.revision !== input.expectedRevision)
        fail(409, 'ORDER_CHANGED', 'Reload the order before recording delivery')
      if (shipment.status === 'delivered') {
        if (
          shipment.proofReference !== proofReference ||
          shipment.deliveredAt?.getTime() !== input.deliveredAt.getTime()
        )
          fail(
            409,
            'DELIVERY_ALREADY_RECORDED',
            'A different delivery acknowledgement is already recorded',
          )
        await completeDelivery(tx, actor, order)
        return { orderId, shipmentId: shipment.id }
      }
      if (
        order.status !== 'shipped' ||
        !['in_transit', 'delivery_failed'].includes(shipment.status)
      )
        fail(
          409,
          'INVALID_SHIPMENT_STATE',
          'Shipment is not eligible for delivery acknowledgement',
        )
      const now = await databaseNow(tx)
      assertOccurredAt(input.deliveredAt, shipment.createdAt, now)
      await tx
        .update(shipments)
        .set({
          status: 'delivered',
          proofReference,
          deliveredAt: input.deliveredAt,
          updatedAt: now,
        })
        .where(eq(shipments.id, shipment.id))
      await tx
        .update(orders)
        .set({
          status: 'delivered',
          deliveredAt: input.deliveredAt,
          revision: order.revision + 1,
          updatedAt: now,
        })
        .where(eq(orders.id, orderId))
      await appendOrderEvent(tx, actor, orderId, 'shipment_delivered', {
        shipmentId: shipment.id,
        previousShipmentStatus: shipment.status,
        proofReference,
        deliveredAt: input.deliveredAt.toISOString(),
      })
      await completeDelivery(tx, actor, {
        ...order,
        status: 'delivered',
        deliveredAt: input.deliveredAt,
        revision: order.revision + 1,
      })
      return { orderId, shipmentId: shipment.id }
    },
  )
}

export function recordDeliveryFailure(
  command: Command,
  orderId: string,
  reason: string,
) {
  return executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      assertOrderAccess(actor, order, true)
      const shipment = await lockShipment(tx, orderId)
      if (order.status !== 'shipped' || shipment.status !== 'in_transit')
        fail(
          409,
          'INVALID_SHIPMENT_STATE',
          'Only an active delivery attempt can fail',
        )
      if (shipment.failedAttempts >= MAX_RECOVERY_ATTEMPTS)
        fail(
          409,
          'DELIVERY_RETRY_EXHAUSTED',
          'Receive the returned shipment; delivery retry limit was reached',
        )
      const now = await databaseNow(tx)
      await tx
        .update(shipments)
        .set({
          status: 'delivery_failed',
          failedAttempts: shipment.failedAttempts + 1,
          failureReason: reason,
          updatedAt: now,
        })
        .where(eq(shipments.id, shipment.id))
      await tx
        .update(orders)
        .set({
          staffWorkStartedAt: now,
          revision: order.revision + 1,
          updatedAt: now,
        })
        .where(eq(orders.id, orderId))
      await appendOrderEvent(tx, actor, orderId, 'delivery_failed', {
        reason,
        failedAttempts: shipment.failedAttempts + 1,
        nextOperation:
          shipment.failedAttempts + 1 < MAX_RECOVERY_ATTEMPTS
            ? 'retry_delivery_or_receive_return'
            : 'receive_return',
      })
      return { orderId, shipmentId: shipment.id }
    },
  )
}

export function retryDelivery(command: Command, orderId: string) {
  return executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      assertOrderAccess(actor, order, true)
      const shipment = await lockShipment(tx, orderId)
      if (order.status !== 'shipped' || shipment.status !== 'delivery_failed')
        fail(
          409,
          'INVALID_SHIPMENT_STATE',
          'Only a failed delivery can be retried',
        )
      if (shipment.failedAttempts >= MAX_RECOVERY_ATTEMPTS)
        fail(
          409,
          'DELIVERY_RETRY_EXHAUSTED',
          'Receive the returned shipment; delivery retry limit was reached',
        )
      await tx
        .update(shipments)
        .set({ status: 'in_transit', updatedAt: await databaseNow(tx) })
        .where(eq(shipments.id, shipment.id))
      await appendOrderEvent(tx, actor, orderId, 'delivery_retry_started', {
        shipmentId: shipment.id,
      })
      return { orderId, shipmentId: shipment.id }
    },
  )
}

export function receiveUndeliveredShipment(
  command: Command,
  orderId: string,
  input: {
    proofReference?: string | undefined
    reason: string
    items: ReceiptLine[]
  },
) {
  const proofReference = input.proofReference ?? null
  return executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      assertOrderAccess(actor, order, true)
      const shipment = await lockShipment(tx, orderId)
      if (order.status !== 'shipped' || shipment.status !== 'delivery_failed')
        fail(
          409,
          'INVALID_SHIPMENT_STATE',
          'Only an undelivered shipment can be received back',
        )
      const items = await getOrderItems(tx, orderId)
      if (
        items.length !== input.items.length ||
        items.some(
          (item) =>
            !input.items.some(
              (line) =>
                line.orderItemId === item.id && line.quantity <= item.quantity,
            ),
        )
      )
        fail(
          422,
          'RETURNED_SHIPMENT_MISMATCH',
          'Account for each shipment item using its actual received quantity',
        )
      const missingItems = items.filter((item) =>
        input.items.some(
          (line) =>
            line.orderItemId === item.id && line.quantity < item.quantity,
        ),
      )
      if (missingItems.length && actor.role !== 'admin')
        fail(
          403,
          'ADMIN_RECONCILIATION_REQUIRED',
          'Administrator must reconcile missing goods before closing the undelivered shipment',
        )
      for (const item of items) {
        const receipt = input.items.find((line) => line.orderItemId === item.id)
        if (receipt && receipt.resellableQuantity > 0)
          await changeStock(tx, actor, {
            productId: item.productId,
            orderId,
            kind: 'return',
            onHandDelta: receipt.resellableQuantity,
            reservedDelta: 0,
            reason: input.reason,
            reference: `${shipment.id}:${item.id}`,
          })
      }
      const now = await databaseNow(tx)
      await tx
        .update(shipments)
        .set({
          status: 'returned',
          proofReference,
          returnedAt: now,
          updatedAt: now,
        })
        .where(eq(shipments.id, shipment.id))
      await tx
        .update(orders)
        .set({
          status: 'cancelled',
          stockState: 'released',
          reservationExpiresAt: null,
          paymentReviewRequiredAt: null,
          cancelledAt: now,
          cancellationReason: input.reason,
          revision: order.revision + 1,
          updatedAt: now,
        })
        .where(eq(orders.id, orderId))
      await refundUnallocatedPayment(tx, actor, order, 'return_to_sender')
      await appendOrderEvent(
        tx,
        actor,
        orderId,
        'undelivered_shipment_received',
        {
          proofReference,
          reason: input.reason,
          items: input.items.map((line) => ({ ...line })),
          missingItems: missingItems.map((item) => ({
            orderItemId: item.id,
            quantity:
              item.quantity -
              (input.items.find((line) => line.orderItemId === item.id)
                ?.quantity ?? 0),
          })),
          refundRequired:
            (
              await paymentSummaryForOrder(tx, {
                ...order,
                status: 'cancelled',
              })
            ).refundDueVnd > 0,
        },
      )
      return { orderId, shipmentId: shipment.id }
    },
  )
}
