import type { orderEvents, shipments } from '../../db/schema.js'
import type { Order } from './commerce.persistence.js'

type Shipment = typeof shipments.$inferSelect
type Event = typeof orderEvents.$inferSelect

export function canCorrectWaybill(order: Order, shipment: Shipment | null) {
  return Boolean(
    !order.deletedAt &&
      order.status === 'packing' &&
      order.stockState === 'reserved' &&
      shipment?.status === 'ready_to_ship' &&
      shipment.handedOverAt === null,
  )
}

export function recipientMatches(value: unknown, recipient: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !recipient ||
    typeof recipient !== 'object' ||
    Array.isArray(recipient)
  )
    return false
  const snapshot = value as Record<string, unknown>
  const expected = recipient as Record<string, unknown>
  return (
    ['name', 'phone', 'addressLine', 'province', 'district', 'ward'] as const
  ).every(
    (field) =>
      typeof snapshot[field] === 'string' &&
      snapshot[field] === expected[field],
  )
}

// Verification belongs to the saved waybill and the facts actually checked,
// rather than to the order's revision (which also changes for unrelated work).
export function waybillVerification(
  order: Order,
  shipment: Shipment,
  events: Event[],
) {
  let recipient: Event | null = null
  let payment: Event | null = null
  for (const event of events) {
    const sameShipment = event.details.shipmentId === shipment.id
    if (
      sameShipment &&
      (event.type === 'waybill_corrected' ||
        (['shipment_carrier_identified', 'shipment_carrier_corrected'].includes(
          event.type,
        ) &&
          event.details.previousCarrierId !== event.details.carrierId))
    ) {
      recipient = null
      payment = null
    }
    if (
      event.type === 'recipient_changed' ||
      (sameShipment &&
        event.type === 'carrier_recipient_change_recorded' &&
        event.details.outcome === 'accepted' &&
        !recipientMatches(
          event.details.previousRecipient,
          event.details.requestedRecipient,
        ))
    )
      recipient = null
    if (
      !['waybill_confirmed', 'waybill_corrected', 'waybill_verified'].includes(
        event.type,
      ) ||
      event.details.shipmentId !== shipment.id ||
      event.details.carrierId !== shipment.carrierId ||
      event.details.trackingReference !== shipment.trackingReference
    )
      continue
    if (event.details.recipientVerified === true) recipient = event
    if (event.details.paymentVerified === true) payment = event
  }
  return {
    recipient:
      recipient &&
      recipientMatches(recipient.details.recipient, order.recipient) &&
      recipientMatches(shipment.recipientSnapshot, order.recipient)
        ? recipient
        : null,
    payment:
      payment &&
      payment.details.paymentMethod === order.paymentMethod &&
      payment.details.codAmountVnd ===
        (order.paymentMethod === 'cod' ? order.totalVnd : 0)
        ? payment
        : null,
  }
}
