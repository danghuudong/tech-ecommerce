import type { Order } from './commerce.persistence.js'
import type { Role } from './commerce.types.js'

export function canEditOrderRecipient(
  role: Role,
  order: Pick<Order, 'status' | 'deletedAt'>,
  hasWaybill: boolean,
) {
  if (order.deletedAt || hasWaybill) return false
  if (role === 'customer') return order.status === 'placed'
  return (
    (role === 'staff' || role === 'admin') &&
    ['placed', 'confirmed', 'packing'].includes(order.status)
  )
}

export function canRecordCarrierRecipientResult(
  order: Pick<Order, 'status' | 'deletedAt'>,
  shipment: { status: string; carrierId: string | null } | null | undefined,
) {
  if (order.deletedAt || !shipment?.carrierId) return false
  return (
    (order.status === 'packing' && shipment.status === 'ready_to_ship') ||
    (order.status === 'shipped' &&
      ['in_transit', 'delivery_failed'].includes(shipment.status))
  )
}
