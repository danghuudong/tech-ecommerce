export type Role = 'customer' | 'staff' | 'accountant' | 'admin'
export type Actor = { userId: string; role: Role }
export type AuditActor = Actor | { userId: null; role: 'system' }
export type StaffOrderSettingsValue = {
  enabled: boolean
  acceptingOrders: boolean
  maxActiveOrders: number
  shiftEndsAt: string | null
}
export const DEFAULT_MAX_ACTIVE_ORDERS = 20
export const MAX_ACTIVE_ORDERS = 100
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }
export type CommandResult = Record<string, JsonValue>

export type Recipient = {
  name: string
  phone: string
  addressLine: string
  ward: string
  district: string
  province: string
}

export type BankInstructions = {
  bankName: string
  accountNumber: string
  accountHolder: string
}

export type QuoteLine = {
  productId: string
  sku: string
  name: string
  quantity: number
  unitPriceVnd: number
  lineTotalVnd: number
}

export type ReceiptLine = {
  orderItemId: string
  quantity: number
  resellableQuantity: number
}

export const MAX_VND = 9_999_999_999
export const MAX_LINES = 100
export const MAX_QUANTITY = 99
export const MAX_RECOVERY_ATTEMPTS = 3
export const RETURN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const QUOTE_LIFETIME_MS = 15 * 60 * 1000
