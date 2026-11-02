import type { OrderDetail } from './types'

export const packingChecks = [
  { key: 'productsChecked', label: 'Đúng sản phẩm, đủ số lượng' },
  { key: 'conditionChecked', label: 'Hàng không hư hỏng, đủ phụ kiện' },
  { key: 'packagingChecked', label: 'Đã bọc bảo vệ và đóng kín kiện hàng' },
] as const

type PackingCheckKey = (typeof packingChecks)[number]['key']
export type PackingChecklist = Record<PackingCheckKey, boolean>

export function packingChecklistKey(order: Pick<OrderDetail, 'items'>) {
  // Recipient and collection instructions do not invalidate a physical packing check.
  return JSON.stringify({
    items: order.items
      .map(({ id, productId, skuSnapshot, nameSnapshot, quantity }) => ({
        id,
        productId,
        skuSnapshot,
        nameSnapshot,
        quantity,
      }))
      .sort((first, second) => first.id.localeCompare(second.id)),
  })
}

export function recipientVerificationKey(
  order: Pick<OrderDetail, 'recipient'>,
) {
  const { name, phone, addressLine, province, district, ward } = order.recipient
  return JSON.stringify({ name, phone, addressLine, province, district, ward })
}

export function paymentVerificationKey(
  order: Pick<OrderDetail, 'paymentMethod' | 'prices'>,
) {
  return JSON.stringify({
    paymentMethod: order.paymentMethod,
    codAmountVnd: order.paymentMethod === 'cod' ? order.prices.totalVnd : 0,
  })
}

export function packingChecklistVerified(
  value: unknown,
): value is Record<PackingCheckKey, true> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const checklist = value as Record<string, unknown>
  return packingChecks.every(({ key }) => checklist[key] === true)
}
