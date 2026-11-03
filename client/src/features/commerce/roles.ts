import type { Role } from './types'

export const roleLabels: Record<Role, string> = {
  customer: 'Khách hàng',
  staff: 'Nhân viên xử lý đơn',
  accountant: 'Kế toán',
  admin: 'Quản trị viên',
}

export const canManagePayments = (role: Role | undefined) =>
  role === 'accountant' || role === 'admin'

export const canManageOrders = (role: Role | undefined) =>
  role === 'staff' || role === 'admin'

export function getAfterSaleLabel(role: Role | undefined) {
  if (role === 'staff') return 'Trả hàng'
  if (role === 'accountant') return 'Hoàn tiền'
  return 'Trả hàng & hoàn tiền'
}
