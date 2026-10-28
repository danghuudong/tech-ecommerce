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
