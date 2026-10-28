import type { ProductCategoryId } from '@/features/catalog/types/product'

export type Role = 'customer' | 'staff' | 'accountant' | 'admin'
export type PaymentMethod = 'cod' | 'bank_transfer'
export type OrderStatus =
  | 'placed'
  | 'confirmed'
  | 'packing'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled'

export interface Session {
  user: { id: string; name: string; email: string }
  session: { id: string; expiresAt: string }
}

export interface Actor {
  userId: string
  role: Role
}

export interface Recipient {
  name: string
  phone: string
  province: string
  district: string
  ward: string
  addressLine: string
}

export interface Page<T> {
  items: T[]
  limit: number
  offset: number
  total?: number
}

export interface CatalogProduct {
  id: string
  sku: string
  name: string
  description: string | null
  category: ProductCategoryId | null
  brand: string | null
  priceVnd: number
  availableQuantity: number
}

export interface PriceLine {
  productId: string
  name: string
  sku: string
  quantity: number
  unitPriceVnd: number
  lineTotalVnd: number
}

export interface CartLine extends PriceLine {
  availableQuantity: number
  eligible: boolean
}

export interface Cart {
  id: string | null
  version: number
  items: CartLine[]
  subtotalVnd: number
  checkoutEligible: boolean
}

export interface CheckoutPolicy {
  deliveryMethods: {
    id: 'standard'
    shippingFeeVnd: number
    freeShippingThresholdVnd: number
  }[]
  paymentMethods: PaymentMethod[]
  bankTransferConfigured: boolean
  returnWindowDays: number
}

export interface Quote {
  id: string
  cartVersion: number | null
  lines: PriceLine[]
  recipient: Recipient
  paymentMethod: PaymentMethod
  subtotalVnd: number
  shippingFeeVnd: number
  totalVnd: number
  expiresAt: string
  expired: boolean
  status: 'open' | 'expired' | 'accepted'
  acceptedOrderId: string | null
}

export interface OrderSummary {
  id: string
  code: string
  status: OrderStatus
  revision: number
  recipient: Recipient
  totalVnd: number
  paymentMethod: PaymentMethod
  paymentStatus: string
  paidVnd: number
  amountDueVnd: number | null
  refundedVnd: number
  customerPaidToCarrierVnd: number
  carrierRemittedVnd: number
  carrierAmountDueVnd: number | null
  balancesVerified: boolean
  paymentReviewRequired: boolean
  paymentReviewOverdue: boolean
  bankPaymentApproved: boolean
  paymentDeadlineAt: string | null
  createdAt: string
  assignedTo?: string | null
  assignedToName?: string | null
  assignedAt?: string | null
  assignmentSource?: 'automatic' | 'manual' | null
  assignmentOverdue?: boolean
  assignmentWaitingSince?: string | null
  assignmentWaitingOverdue?: boolean
  assignmentDeadlineSoon?: boolean
  assignmentNeedsHandover?: boolean
  assignmentNeedsRebalance?: boolean
  assignmentHandoverReview?: boolean
  reservationExpiresAt?: string | null
  deletedAt?: string | null
}

export interface OrderStats {
  deleted?: number
  total: number
  unassigned: number
  mine: number
  assignmentOverdue: number
  assignmentWaitingOverdue: number
  assignmentDeadlineSoon: number
  assignmentHandoverReview: number
  placed: number
  packing: number
  shipped: number
  paymentReviewRequired: number
  paymentReviewOverdue: number
}

export interface OrderPage extends Page<OrderSummary> {
  total: number
  stats: OrderStats
}

export interface StaffOrderSettings {
  enabled: boolean
  acceptingOrders: boolean
  maxActiveOrders: number
  activeOrders: number
  fulfillmentOrders: number
  deliveryIssueOrders: number
  returnOrders: number
  blockedPaymentOrders: number
  shiftEndsAt: string | null
  receivingNow: boolean
  lastAssignedAt: string | null
  revision: number
}

export interface StaffShiftStatus {
  serverTime: string
  settings: Pick<
    StaffOrderSettings,
    | 'enabled'
    | 'acceptingOrders'
    | 'maxActiveOrders'
    | 'activeOrders'
    | 'shiftEndsAt'
    | 'receivingNow'
  > | null
  latestShift: {
    startedAt: string
  } | null
}

export interface OrderAssignmentSummary {
  pendingOrders: number
  eligibleOrders: number
  overdueAssignments: number
  receivingStaff: number
  availableStaff: number
  queueSlaMinutes: number
  deadlineWarningMinutes: number
  waitingOverdueOrders: number
  deadlineAtRiskOrders: number
  handoverOrders: number
  rebalanceOrders: number
  overloadedStaff: number
  overCapacityOrders: number
  handoverReviewOrders: number
  blockedPaymentOrders: number
  oldestWaitingOrders: {
    id: string
    code: string
    reservationExpiresAt: string | null
    assignmentWaitingSince: string | null
    assignmentWaitingOverdue: boolean
    assignmentDeadlineSoon: boolean
    assignmentNeedsHandover: boolean
    assignmentNeedsRebalance: boolean
  }[]
}

export interface OrderItem {
  id: string
  productId: string
  nameSnapshot: string
  skuSnapshot: string
  quantity: number
  unitPriceVnd: number
  lineTotalVnd: number
  remainingReturnableQuantity: number
}

export type ReturnStatus =
  | 'requested'
  | 'approved'
  | 'receiving'
  | 'received'
  | 'rejected'
  | 'withdrawn'
  | 'closed'

export interface ReturnRecord {
  id: string
  orderId: string
  status: ReturnStatus
  reason: string
  responsibility: 'customer' | 'store' | 'carrier'
  decidedBy: string | null
  decisionReason: string | null
  createdAt: string
  updatedAt: string
}

export interface OrderReturn extends ReturnRecord {
  decidedByName?: string | null
  lines: {
    id: string
    orderItemId: string
    quantity: number
    receivedQuantity: number
    restockedQuantity: number
  }[]
  receipts: { id: string; proofReference: string; createdAt: string }[]
  permittedActions: string[]
}

export interface RefundAttempt {
  id: string
  number: number
  mode: 'standard' | 'manual'
  status: string
  requestedAmountVnd: number
  settledAmountVnd: number
  actualSettledVnd: number
  remainderNotSentVerified: boolean
  reason: string | null
  recordedBy: string
  recordedByName?: string | null
  resolvedBy: string | null
  resolvedByName?: string | null
  permittedActions: string[]
  createdAt: string
}

export interface Refund {
  id: string
  orderId: string
  returnId: string | null
  amountVnd: number
  status: string
  attemptCount: number
  remainingVnd: number
  settledVnd: number
  attempts: RefundAttempt[]
  permittedActions: string[]
  startBlockedReason?: 'REFUND_CHECKER_UNAVAILABLE' | null
}

export type OrderDeletionBlockReason =
  | 'ORDER_DELETION_NOT_TERMINAL'
  | 'ORDER_DELETION_RECONCILIATION_REQUIRED'
  | 'ORDER_DELETION_RETURNS_PENDING'
  | 'ORDER_DELETION_FINANCIAL_WORK_PENDING'

export type OrderUndoBlockReason =
  | 'ORDER_UNDO_DELETED'
  | 'STAFF_ACCESS_REQUIRED'
  | 'ORDER_ASSIGNED_ELSEWHERE'
  | 'ORDER_UNDO_ADMIN_REQUIRED'
  | 'ASSIGNMENT_REQUIRED'
  | 'ORDER_UNDO_AFTER_SALE_ACTIVITY'
  | 'ORDER_UNDO_FINANCIAL_ACTIVITY'
  | 'ORDER_UNDO_RECONCILIATION_REQUIRED'
  | 'ORDER_UNDO_RESERVATION_EXPIRED'
  | 'ORDER_UNDO_STATE_MISMATCH'
  | 'ORDER_UNDO_HISTORY_REQUIRED'
  | 'ORDER_UNDO_CONFIRMATION_EXPIRED'
  | 'ORDER_UNDO_SHIPMENT_ACTIVITY'

export interface OrderUndo {
  action: 'confirmation' | 'packing' | 'handover' | 'delivery'
  targetStatus: OrderStatus
  allowed: boolean
  blockedReason: OrderUndoBlockReason | null
  requiresAdmin: boolean
  requiresEvidence: boolean
  requiresConfirmationRenewal: boolean
  maxConfirmationRenewalHours: number | null
  collectionFailuresToCorrect?: {
    customer: number
    carrier: number
  } | null
  confirmationExpiresAt: string | null
  originalConfirmationExpiresAt: string | null
}

export interface OrderDetail {
  id: string
  code: string
  serverTime: string
  revision: number
  undo?: OrderUndo | null
  deletion?: {
    deletedAt: string | null
    deletedBy: string | null
    reason: string | null
    blockedReason: OrderDeletionBlockReason | null
  }
  status: OrderStatus
  recipient: Recipient
  paymentMethod: PaymentMethod
  bankInstructions: {
    bankName: string
    accountNumber: string
    accountHolder: string
  } | null
  bankTransferReference: string | null
  paymentDeadlineAt: string | null
  paymentReviewRequired: boolean
  paymentReview: {
    required: boolean
    overdue: boolean
    responsibleRole: string
  }
  stockState: string
  reservationExpiresAt: string | null
  reservationExpired: boolean
  prices: {
    subtotalVnd: number
    shippingFeeVnd: number
    totalVnd: number
    adjustedTotalVnd: number
    returnedGoodsVnd: number
    shippingCreditVnd: number
  }
  items: OrderItem[]
  payment: {
    status: string
    paidVnd: number
    amountDueVnd: number | null
    balancesVerified: boolean
    refundedVnd: number
    netRefundedVnd: number
    refundDueVnd: number | null
    pendingRefundVnd: number
    bankPaymentApproved: boolean
    onTimeReceivedVnd: number | null
    latePaymentApprovalRequired: boolean
    customerPaidToCarrierVnd: number
    customerDirectReceivedVnd: number
    purchaseAmountDueVnd: number | null
    carrierRemittedVnd: number
    carrierAmountDueVnd: number | null
    receipts: {
      id: string
      reference: string
      amountVnd: number
      receivedAt: string
      duplicate: boolean
      receiptReconciliationRequired: boolean
      allocationSummary?: {
        totalVnd: number
        orders: {
          orderId: string
          orderCode: string
          amountVnd: number
        }[]
      }
    }[]
    collection: {
      status: string
      failureCount: number
      resolution: string
      issueReason?: string | null
    } | null
    carrierCollection: {
      status: string
      failureCount: number
      resolution: string
      issueReason: string | null
      currentDecision: {
        id: string
        reference: string
        responsibleParty: string
        responsibleCarrierId: string | null
        disposition: 'debt' | 'written_off'
        kind: 'resolution' | 'responsibility_correction'
        supersedesDecisionId: string | null
      } | null
      receivableVnd: number | null
      writtenOffVnd: number | null
      collections: {
        id: string
        carrierId: string
        reference: string
        receivedAt: string
        amountVnd: number
        active: boolean
        remainingVnd: number | null
      }[]
    } | null
  }
  shipment: {
    id: string
    createdAt: string
    carrierId: string | null
    carrier: Carrier | null
    trackingReference: string
    status: string
    failedAttempts: number
    failureReason: string | null
  } | null
  returns: OrderReturn[]
  refunds: Refund[]
  returnWindowEndsAt: string | null
  permittedActions: { customer: string[]; staff: string[] }
  history: {
    id: string
    type: string
    createdAt: string
    actorUserId?: string | null
    actorName?: string | null
    details?: Record<string, unknown>
  }[]
  assignedTo?: string | null
  createdAt: string
  assignedToName?: string | null
  assignedAt?: string | null
  assignmentSource?: 'automatic' | 'manual' | null
  assignmentOverdue?: boolean
  assignmentWaitingSince?: string | null
  assignmentWaitingOverdue?: boolean
  assignmentDeadlineSoon?: boolean
  assignmentNeedsHandover?: boolean
  assignmentNeedsRebalance?: boolean
  assignmentHandoverReview?: boolean
  deliveredAt: string | null
  cancellationReason: string | null
}

export interface Carrier {
  id: string
  code: string
  name: string
}

export interface ReceivingBank {
  bin: string
  code: string
  shortName: string
  name: string
}

export interface ReceivingAccount {
  id: string
  channel: 'bank_transfer' | 'cash'
  providerCode: string
  accountReference: string
  name: string
  bank?: ReceivingBank | null
}

export type ReceivingAccountPage = Page<ReceivingAccount> & { total: number }

export interface ReceiptWork {
  receipt: {
    id: string
    reference: string
    amountVnd: number
    revision: number
    receivedAt: string
    receiptReconciliationRequired: boolean
  }
  allocatedVnd: number
  unallocatedVnd: number
}
