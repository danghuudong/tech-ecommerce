import { type Request, Router } from 'express'
import { z } from 'zod'
import { db } from '../../config/db.js'
import { env } from '../../config/env.js'
import {
  type AuthenticatedRequest,
  requireAdminAuth,
  requireAuth,
} from '../../middlewares/auth.middleware.js'
import { clearCart, getCart, setCartItem } from './cart.service.js'
import {
  adjustStock,
  createProduct,
  getProduct,
  listProducts,
  staffProducts,
  stockHistory,
  updateProduct,
} from './catalog.service.js'
import {
  checkoutPolicy,
  createQuote,
  getQuote,
  placeOrder,
} from './checkout.service.js'
import {
  adjustCodCollections,
  getCodAdjustmentContext,
  listCarrierAllocationWork,
  listCodAdjustmentHistory,
} from './cod-adjustment.service.js'
import {
  createCarrier,
  listCarriers,
  listCodReconciliationWork,
  reconcileCodCollections,
} from './cod-reconciliation.service.js'
import {
  addressUpdateSchema,
  assignmentSchema,
  bankReconciliationSchema,
  carrierCreateSchema,
  carrierRemittanceSchema,
  cartItemSchema,
  catalogListSchema,
  checkoutSchema,
  codCollectionAdjustmentSchema,
  codCollectionReconciliationSchema,
  codCollectionSchema,
  collectionFailureSchema,
  collectionResolutionSchema,
  deliverySchema,
  dispatchSchema,
  emptySchema,
  idSchema,
  manualRefundAttemptSchema,
  orderDeletionSchema,
  orderListSchema,
  orderRevisionSchema,
  orderUndoSchema,
  paginationSchema,
  paymentAllocationAdjustmentSchema,
  paymentBalanceReviewDecisionSchema,
  paymentBalanceReviewListSchema,
  paymentClassificationSchema,
  paymentReceiptCreateSchema,
  paymentReceiptReconciliationSchema,
  paymentSchema,
  placeOrderSchema,
  productCreateSchema,
  productListSchema,
  productUpdateSchema,
  reasonSchema,
  receivingAccountCreateSchema,
  receivingAccountListSchema,
  refundAttemptSchema,
  refundExceptionSettlementSchema,
  refundOutcomeSchema,
  refundRecoveryReceiptSchema,
  returnApprovalSchema,
  returnReceiptSchema,
  returnRequestSchema,
  roleUpdateSchema,
  shipmentCarrierSchema,
  shipmentReturnSchema,
  staffOrderSettingsSchema,
  staffUserListSchema,
  stockAdjustmentSchema,
} from './commerce.contracts.js'
import { type Command, fail, resolveActor } from './commerce.persistence.js'
import type { CommandResult } from './commerce.types.js'
import {
  dispatchOrder,
  receiveUndeliveredShipment,
  recordDelivery,
  recordDeliveryFailure,
  retryDelivery,
} from './fulfillment.service.js'
import {
  getOrder,
  listAfterSaleWork,
  listOrders,
  listRoleHistory,
  listStaffUsers,
} from './order.queries.js'
import {
  advanceOrder,
  assignOrder,
  cancelOrder,
  changeRole,
  updateAddress,
} from './order.service.js'
import {
  getOrderAssignmentSummary,
  getStaffShift,
  updateStaffOrderSettings,
} from './order-assignment.service.js'
import { deleteOrder, restoreOrder } from './order-deletion.service.js'
import { undoOrderStep } from './order-undo.service.js'
import { getOrderUndoDocument } from './order-undo-document.service.js'
import {
  classifyLegacyCodPayment,
  reconcileBankDeadline,
  recordCarrierRemittance,
  recordCodCollection,
  recordCollectionFailure,
  recordPayment,
  resolveCollection,
} from './payment.service.js'
import {
  decidePaymentBalanceReview,
  getPaymentBalanceReview,
  listPaymentBalanceReviewHistory,
  listPaymentBalanceReviews,
  recordRefundRecovery,
} from './payment-balance-review.service.js'
import { recordPaymentReceipt } from './payment-receipt.service.js'
import {
  adjustPaymentAllocations,
  getReceiptAllocationContext,
  listAllocationHistory,
  listReceiptReconciliationHistory,
  listReceiptReconciliationWork,
  listUnallocatedReceiptWork,
  reconcilePaymentReceipt,
} from './payment-reconciliation.service.js'
import {
  createReceivingAccount,
  listReceivingAccounts,
  listReceivingBanks,
} from './receiving-account.service.js'
import {
  recordRefundExceptionSettlement,
  recordRefundOutcome,
  startManualRefundAttempt,
  startRefundAttempt,
} from './refund.service.js'
import {
  decideReturn,
  receiveReturn,
  requestReturn,
  withdrawReturn,
} from './return.service.js'
import {
  getShipmentCarrierContext,
  identifyShipmentCarrier,
} from './shipment-carrier.service.js'

export const commerceRouter = Router()

function userId(request: AuthenticatedRequest) {
  if (!request.user) fail(401, 'UNAUTHORIZED', 'Authentication required')
  return request.user.id
}

function id(request: Request, parameter: string) {
  return idSchema.parse(request.params[parameter])
}

function mutation<S extends z.ZodType>(
  method: 'post' | 'put' | 'patch',
  path: string,
  scope: string,
  schema: S,
  run: (
    command: Command,
    input: z.output<S>,
    request: Request,
  ) => Promise<CommandResult>,
  status = 200,
) {
  commerceRouter[method](
    path,
    async (request: AuthenticatedRequest, response) => {
      const input = schema.parse(request.body ?? {})
      const key = idSchema.parse(request.get('Idempotency-Key'))
      const params = Object.fromEntries(
        Object.entries(request.params).map(([name, value]) => [
          name,
          name === 'userId'
            ? z.string().trim().min(1).max(200).parse(value)
            : idSchema.parse(value),
        ]),
      )
      const command: Command = {
        userId: userId(request),
        key,
        scope: `${scope}:${JSON.stringify(params)}`,
        payload: { params, input },
      }
      response.status(status).json({ data: await run(command, input, request) })
    },
  )
}

commerceRouter.get('/products', async (request, response) => {
  const input = catalogListSchema.parse(request.query)
  response.json({
    data: await listProducts(input),
  })
})
commerceRouter.get('/products/:productId', async (request, response) =>
  response.json({ data: await getProduct(id(request, 'productId')) }),
)

commerceRouter.use((request, response, next) =>
  /^\/(staff|admin)(\/|$)/i.test(request.path)
    ? requireAdminAuth(request, response, next)
    : requireAuth(request, response, next),
)
commerceRouter.use((request, response, next) => {
  response.set('Cache-Control', 'private, no-store')
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.get('Origin')
    if (
      (origin &&
        origin !== new URL(env.CLIENT_ORIGIN).origin &&
        origin !== new URL(env.BETTER_AUTH_URL).origin) ||
      (!origin && request.get('Sec-Fetch-Site') === 'cross-site')
    )
      fail(403, 'UNTRUSTED_ORIGIN', 'Request origin is not allowed')
    if (!request.is('application/json'))
      fail(415, 'JSON_REQUIRED', 'Mutations require application/json')
  }
  next()
})

commerceRouter.get(
  '/commerce/me',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await db.transaction((tx) => resolveActor(tx, userId(request))),
    }),
)
commerceRouter.get(
  '/staff/me',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await db.transaction((tx) =>
        resolveActor(tx, userId(request), 'workforce'),
      ),
    }),
)
commerceRouter.get('/checkout/policy', (_request, response) =>
  response.json({ data: checkoutPolicy() }),
)
commerceRouter.get('/cart', async (request: AuthenticatedRequest, response) =>
  response.json({ data: await getCart(userId(request)) }),
)
mutation(
  'put',
  '/cart/items/:productId',
  'cart:set_item',
  cartItemSchema,
  (command, input, request) =>
    setCartItem(command, id(request, 'productId'), input),
)
mutation(
  'post',
  '/cart/clear',
  'cart:clear',
  z.strictObject({ expectedVersion: z.number().int().min(0) }),
  (command, input) => clearCart(command, input.expectedVersion),
)
mutation(
  'post',
  '/checkout/quotes',
  'checkout:quote',
  checkoutSchema,
  (command, input) => createQuote(command, input),
  201,
)
commerceRouter.get(
  '/checkout/quotes/:quoteId',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await getQuote(userId(request), id(request, 'quoteId')),
    }),
)
mutation(
  'post',
  '/orders',
  'orders:place',
  placeOrderSchema,
  (command, input) => placeOrder(command, input.quoteId),
  201,
)
commerceRouter.get('/orders', async (request: AuthenticatedRequest, response) =>
  response.json({
    data: await listOrders(
      userId(request),
      orderListSchema.parse(request.query),
    ),
  }),
)
commerceRouter.get(
  '/orders/:orderId',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await getOrder(userId(request), id(request, 'orderId')),
    }),
)
mutation(
  'patch',
  '/orders/:orderId/recipient',
  'orders:recipient',
  addressUpdateSchema,
  (command, input, request) =>
    updateAddress(command, id(request, 'orderId'), input),
)
mutation(
  'post',
  '/orders/:orderId/cancel',
  'orders:cancel',
  reasonSchema,
  (command, input, request) =>
    cancelOrder(command, id(request, 'orderId'), input.reason),
)
mutation(
  'post',
  '/orders/:orderId/returns',
  'returns:request',
  returnRequestSchema,
  (command, input, request) =>
    requestReturn(command, id(request, 'orderId'), input),
  201,
)
mutation(
  'post',
  '/returns/:returnId/withdraw',
  'returns:withdraw',
  reasonSchema,
  (command, input, request) =>
    withdrawReturn(command, id(request, 'returnId'), input.reason),
)

commerceRouter.get(
  '/staff/products',
  async (request: AuthenticatedRequest, response) => {
    const input = paginationSchema.parse(request.query)
    response.json({
      data: await staffProducts(userId(request), input.limit, input.offset),
    })
  },
)
commerceRouter.get(
  '/staff/products/:productId/stock-history',
  async (request: AuthenticatedRequest, response) => {
    const input = paginationSchema.parse(request.query)
    response.json({
      data: await stockHistory(
        userId(request),
        id(request, 'productId'),
        input.limit,
        input.offset,
      ),
    })
  },
)
mutation(
  'post',
  '/admin/products',
  'catalog:create',
  productCreateSchema,
  (command, input) => createProduct(command, input),
  201,
)
mutation(
  'patch',
  '/admin/products/:productId',
  'catalog:update',
  productUpdateSchema,
  (command, input, request) =>
    updateProduct(command, id(request, 'productId'), input),
)
mutation(
  'post',
  '/admin/products/:productId/stock-adjustments',
  'inventory:adjust',
  stockAdjustmentSchema,
  (command, input, request) =>
    adjustStock(command, id(request, 'productId'), input),
)
commerceRouter.get(
  '/admin/users',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listStaffUsers(
        userId(request),
        staffUserListSchema.parse(request.query),
      ),
    }),
)
commerceRouter.get(
  '/admin/role-history',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listRoleHistory(
        userId(request),
        paginationSchema.parse(request.query),
      ),
    }),
)
commerceRouter.get(
  '/staff/shift',
  async (request: AuthenticatedRequest, response) =>
    response.json({ data: await getStaffShift(userId(request)) }),
)
commerceRouter.get(
  '/admin/order-assignment',
  async (request: AuthenticatedRequest, response) =>
    response.json({ data: await getOrderAssignmentSummary(userId(request)) }),
)
mutation(
  'patch',
  '/admin/users/:userId/order-assignment',
  'assignment-settings:update',
  staffOrderSettingsSchema,
  (command, input, request) =>
    updateStaffOrderSettings(
      command,
      z.string().trim().min(1).max(200).parse(request.params.userId),
      input,
    ),
)
mutation(
  'patch',
  '/admin/users/:userId/role',
  'roles:update',
  roleUpdateSchema,
  (command, input, request) =>
    changeRole(
      command,
      z.string().trim().min(1).max(200).parse(request.params.userId),
      input.role,
      input.reason,
    ),
)
commerceRouter.get(
  '/staff/orders',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listOrders(
        userId(request),
        orderListSchema.parse(request.query),
        true,
      ),
    }),
)
mutation(
  'post',
  '/admin/orders/:orderId/delete',
  'orders:delete',
  orderDeletionSchema,
  (command, input, request) =>
    deleteOrder(command, id(request, 'orderId'), input),
)
mutation(
  'post',
  '/admin/orders/:orderId/restore',
  'orders:restore',
  orderDeletionSchema,
  (command, input, request) =>
    restoreOrder(command, id(request, 'orderId'), input),
)
commerceRouter.get(
  '/staff/orders/:orderId',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await getOrder(userId(request), id(request, 'orderId'), true),
    }),
)
mutation(
  'patch',
  '/staff/orders/:orderId/recipient',
  'orders:recipient',
  addressUpdateSchema,
  (command, input, request) =>
    updateAddress(command, id(request, 'orderId'), input, true),
)
mutation(
  'post',
  '/staff/orders/:orderId/cancel',
  'orders:cancel',
  reasonSchema,
  (command, input, request) =>
    cancelOrder(command, id(request, 'orderId'), input.reason, true),
)
commerceRouter.get(
  '/staff/returns',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listAfterSaleWork(
        userId(request),
        paginationSchema.parse(request.query),
        'returns',
      ),
    }),
)
commerceRouter.get(
  '/staff/refunds',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listAfterSaleWork(
        userId(request),
        paginationSchema.parse(request.query),
        'refunds',
      ),
    }),
)
mutation(
  'post',
  '/staff/orders/:orderId/assignment',
  'orders:assign',
  assignmentSchema,
  (command, input, request) =>
    assignOrder(command, id(request, 'orderId'), input),
)
mutation(
  'post',
  '/staff/orders/:orderId/confirm',
  'orders:confirm',
  orderRevisionSchema,
  (command, input, request) =>
    advanceOrder(
      command,
      id(request, 'orderId'),
      'confirm',
      input.expectedRevision,
    ),
)
mutation(
  'post',
  '/staff/orders/:orderId/pack',
  'orders:pack',
  orderRevisionSchema,
  (command, input, request) =>
    advanceOrder(
      command,
      id(request, 'orderId'),
      'pack',
      input.expectedRevision,
    ),
)
commerceRouter.get(
  '/staff/orders/:orderId/undo-documents/:documentId',
  async (request: AuthenticatedRequest, response) => {
    const document = await getOrderUndoDocument(
      userId(request),
      id(request, 'orderId'),
      id(request, 'documentId'),
    )
    response
      .attachment(document.fileName)
      .type('application/octet-stream')
      .set('X-Content-Type-Options', 'nosniff')
      .send(document.content)
  },
)
mutation(
  'post',
  '/staff/orders/:orderId/undo',
  'orders:undo',
  orderUndoSchema,
  (command, input, request) =>
    undoOrderStep(command, id(request, 'orderId'), input),
)
mutation(
  'post',
  '/staff/orders/:orderId/payments',
  'payments:receipt',
  paymentSchema,
  (command, input, request) =>
    recordPayment(command, id(request, 'orderId'), input),
  201,
)
mutation(
  'post',
  '/staff/payment-receipts',
  'payments:record_receipt_with_allocations',
  paymentReceiptCreateSchema,
  (command, input) => recordPaymentReceipt(command, input),
  201,
)
commerceRouter.get(
  '/admin/payment-receipts/unallocated',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listUnallocatedReceiptWork(
        userId(request),
        paginationSchema.parse(request.query),
      ),
    }),
)
commerceRouter.get(
  '/admin/payment-balance-reviews',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listPaymentBalanceReviews(
        userId(request),
        paymentBalanceReviewListSchema.parse(request.query),
      ),
    }),
)
commerceRouter.get(
  '/admin/payment-balance-reviews/:reviewId',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await getPaymentBalanceReview(
        userId(request),
        id(request, 'reviewId'),
      ),
    }),
)
commerceRouter.get(
  '/admin/payment-balance-reviews/:reviewId/decision-history',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listPaymentBalanceReviewHistory(
        userId(request),
        id(request, 'reviewId'),
        paginationSchema.parse(request.query),
      ),
    }),
)
mutation(
  'post',
  '/admin/payment-balance-reviews/:reviewId/decisions',
  'payments:decide_balance_review',
  paymentBalanceReviewDecisionSchema,
  (command, input, request) =>
    decidePaymentBalanceReview(command, id(request, 'reviewId'), input),
  201,
)
mutation(
  'post',
  '/admin/payment-balance-reviews/:reviewId/recoveries',
  'payments:record_refund_recovery',
  refundRecoveryReceiptSchema,
  (command, input, request) =>
    recordRefundRecovery(command, id(request, 'reviewId'), input),
  201,
)
commerceRouter.get(
  '/admin/payment-receipts/:paymentId/allocations',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await getReceiptAllocationContext(
        userId(request),
        id(request, 'paymentId'),
      ),
    }),
)
commerceRouter.get(
  '/admin/payment-receipts/:paymentId/allocation-history',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listAllocationHistory(
        userId(request),
        id(request, 'paymentId'),
        paginationSchema.parse(request.query),
      ),
    }),
)
mutation(
  'post',
  '/admin/payment-receipts/:paymentId/allocations',
  'payments:adjust_allocations',
  paymentAllocationAdjustmentSchema,
  (command, input, request) =>
    adjustPaymentAllocations(command, id(request, 'paymentId'), input),
  201,
)
mutation(
  'post',
  '/staff/orders/:orderId/collection-failure',
  'payments:collection_failure',
  collectionFailureSchema,
  (command, input, request) =>
    recordCollectionFailure(
      command,
      id(request, 'orderId'),
      input.reason,
      input.party,
    ),
)
mutation(
  'post',
  '/staff/orders/:orderId/cod-collections',
  'payments:customer_paid_carrier',
  codCollectionSchema,
  (command, input, request) =>
    recordCodCollection(command, id(request, 'orderId'), input),
  201,
)
commerceRouter.get(
  '/staff/carriers',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listCarriers(
        userId(request),
        productListSchema.parse(request.query),
      ),
    }),
)
mutation(
  'post',
  '/admin/carriers',
  'carriers:create',
  carrierCreateSchema,
  (command, input) => createCarrier(command, input),
  201,
)
commerceRouter.get(
  '/staff/receiving-accounts',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listReceivingAccounts(
        userId(request),
        receivingAccountListSchema.parse(request.query),
      ),
    }),
)
commerceRouter.get(
  '/staff/receiving-banks',
  async (request: AuthenticatedRequest, response) =>
    response.json({ data: await listReceivingBanks(userId(request)) }),
)
mutation(
  'post',
  '/admin/receiving-accounts',
  'payments:create_receiving_account',
  receivingAccountCreateSchema,
  (command, input) => createReceivingAccount(command, input),
  201,
)
commerceRouter.get(
  '/admin/payment-receipts/reconciliation',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listReceiptReconciliationWork(
        userId(request),
        paginationSchema.parse(request.query),
      ),
    }),
)
commerceRouter.get(
  '/admin/payment-receipts/:paymentId/reconciliation-history',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listReceiptReconciliationHistory(
        userId(request),
        id(request, 'paymentId'),
        paginationSchema.parse(request.query),
      ),
    }),
)
mutation(
  'post',
  '/admin/payment-receipts/:paymentId/reconciliation',
  'payments:reconcile_receipt_identity',
  paymentReceiptReconciliationSchema,
  (command, input, request) =>
    reconcilePaymentReceipt(command, id(request, 'paymentId'), input),
  201,
)
commerceRouter.get(
  '/admin/cod-collections/:collectionId/cross-carrier-context',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await getCodAdjustmentContext(
        userId(request),
        id(request, 'collectionId'),
        true,
      ),
    }),
)
commerceRouter.get(
  '/admin/cod-collections/:collectionId/adjustment-context',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await getCodAdjustmentContext(
        userId(request),
        id(request, 'collectionId'),
      ),
    }),
)
commerceRouter.get(
  '/admin/cod-collections/:collectionId/adjustment-history',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listCodAdjustmentHistory(
        userId(request),
        id(request, 'collectionId'),
        paginationSchema.parse(request.query),
      ),
    }),
)
commerceRouter.get(
  '/admin/carrier-remittances/allocation-review',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listCarrierAllocationWork(
        userId(request),
        paginationSchema.parse(request.query),
      ),
    }),
)
mutation(
  'post',
  '/admin/cod-collections/:collectionId/adjustment',
  'payments:adjust_cod_collection',
  codCollectionAdjustmentSchema,
  (command, input, request) =>
    adjustCodCollections(command, id(request, 'collectionId'), input),
  201,
)
mutation(
  'post',
  '/admin/orders/:orderId/payments/:paymentId/classification',
  'payments:classify_legacy_cod',
  paymentClassificationSchema,
  (command, input, request) =>
    classifyLegacyCodPayment(
      command,
      id(request, 'orderId'),
      id(request, 'paymentId'),
      input,
    ),
  201,
)
commerceRouter.get(
  '/admin/cod-collections/reconciliation',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listCodReconciliationWork(
        userId(request),
        paginationSchema.parse(request.query),
      ),
    }),
)
mutation(
  'post',
  '/admin/cod-collections/:collectionId/reconciliation',
  'payments:reconcile_duplicate_collections',
  codCollectionReconciliationSchema,
  (command, input, request) =>
    reconcileCodCollections(command, id(request, 'collectionId'), input),
  201,
)
commerceRouter.get(
  '/admin/payment-reviews',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listOrders(
        userId(request),
        {
          ...orderListSchema.parse(request.query),
          paymentReviewRequired: true,
          deletion: 'all',
        },
        true,
        true,
      ),
    }),
)
commerceRouter.get(
  '/admin/cod-reconciliation-orders',
  async (request: AuthenticatedRequest, response) =>
    response.json({
      data: await listOrders(
        userId(request),
        {
          ...orderListSchema.parse(request.query),
          codReconciliationRequired: true,
          deletion: 'all',
        },
        true,
        true,
      ),
    }),
)
mutation(
  'post',
  '/staff/orders/:orderId/carrier-remittances',
  'payments:carrier_remittance',
  carrierRemittanceSchema,
  (command, input, request) =>
    recordCarrierRemittance(command, id(request, 'orderId'), input),
  201,
)
mutation(
  'post',
  '/staff/orders/:orderId/bank-reconciliation',
  'payments:bank_reconciliation',
  bankReconciliationSchema,
  (command, input, request) =>
    reconcileBankDeadline(command, id(request, 'orderId'), input),
)
mutation(
  'post',
  '/staff/orders/:orderId/dispatch',
  'fulfillment:dispatch',
  dispatchSchema,
  (command, input, request) =>
    dispatchOrder(command, id(request, 'orderId'), input),
  201,
)
commerceRouter.get(
  '/staff/orders/:orderId/shipment/carrier',
  async (request: AuthenticatedRequest, response) => {
    response.json({
      data: await getShipmentCarrierContext(
        userId(request),
        id(request, 'orderId'),
      ),
    })
  },
)
mutation(
  'post',
  '/staff/orders/:orderId/shipment/carrier',
  'fulfillment:identify-carrier',
  shipmentCarrierSchema,
  (command, input, request) =>
    identifyShipmentCarrier(command, id(request, 'orderId'), input),
)
mutation(
  'post',
  '/admin/orders/:orderId/collection-resolutions',
  'payments:resolve_collection',
  collectionResolutionSchema,
  (command, input, request) =>
    resolveCollection(command, id(request, 'orderId'), input),
  201,
)
mutation(
  'post',
  '/staff/orders/:orderId/delivery',
  'fulfillment:delivery',
  deliverySchema,
  (command, input, request) =>
    recordDelivery(command, id(request, 'orderId'), input),
)
mutation(
  'post',
  '/staff/orders/:orderId/delivery-failure',
  'fulfillment:failure',
  reasonSchema,
  (command, input, request) =>
    recordDeliveryFailure(command, id(request, 'orderId'), input.reason),
)
mutation(
  'post',
  '/staff/orders/:orderId/retry-delivery',
  'fulfillment:retry',
  emptySchema,
  (command, _input, request) => retryDelivery(command, id(request, 'orderId')),
)
mutation(
  'post',
  '/staff/orders/:orderId/returned-shipment',
  'fulfillment:returned',
  shipmentReturnSchema,
  (command, input, request) =>
    receiveUndeliveredShipment(command, id(request, 'orderId'), input),
)
mutation(
  'post',
  '/staff/returns/:returnId/approve',
  'returns:approve',
  returnApprovalSchema,
  (command, input, request) =>
    decideReturn(
      command,
      id(request, 'returnId'),
      'approve',
      input.reason,
      input.responsibility,
    ),
)
for (const decision of ['reject', 'close'] as const)
  mutation(
    'post',
    `/staff/returns/:returnId/${decision}`,
    `returns:${decision}`,
    reasonSchema,
    (command, input, request) =>
      decideReturn(command, id(request, 'returnId'), decision, input.reason),
  )
mutation(
  'post',
  '/staff/returns/:returnId/receipts',
  'returns:receipt',
  returnReceiptSchema,
  (command, input, request) =>
    receiveReturn(command, id(request, 'returnId'), input),
  201,
)
mutation(
  'post',
  '/staff/refunds/:refundId/attempts',
  'refunds:start',
  refundAttemptSchema,
  (command, input, request) =>
    startRefundAttempt(command, id(request, 'refundId'), input.amountVnd),
  201,
)
mutation(
  'post',
  '/staff/refunds/:refundId/attempts/:attemptId/outcome',
  'refunds:outcome',
  refundOutcomeSchema,
  (command, input, request) =>
    recordRefundOutcome(
      command,
      id(request, 'refundId'),
      id(request, 'attemptId'),
      input,
    ),
)
mutation(
  'post',
  '/admin/refunds/:refundId/attempts',
  'refunds:manual_start',
  manualRefundAttemptSchema,
  (command, input, request) =>
    startManualRefundAttempt(
      command,
      id(request, 'refundId'),
      input.reason,
      input.amountVnd,
    ),
  201,
)
mutation(
  'post',
  '/admin/refunds/:refundId/attempts/:attemptId/exception-settlements',
  'refunds:exception_settlement',
  refundExceptionSettlementSchema,
  (command, input, request) =>
    recordRefundExceptionSettlement(
      command,
      id(request, 'refundId'),
      id(request, 'attemptId'),
      input,
    ),
  201,
)
