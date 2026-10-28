import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm'
import { db } from '../../config/db.js'
import { env } from '../../config/env.js'
import {
  carriers,
  codCollections,
  collectionDecisions,
  orderEvents,
  orders,
  paymentAllocations,
  paymentBalanceReviews,
  paymentClassifications,
  payments,
  refundAttempts,
  refunds,
  returnLines,
  returnReceipts,
  returns,
  roleChanges,
  shipments,
  staffOrderSettings,
  user,
} from '../../db/schema.js'
import { latestCollectionDecision } from './collection-decision.js'
import {
  assertOrderAccess,
  databaseNow,
  fail,
  getOrderItems,
  resolveActor,
  staffUserFilter,
} from './commerce.persistence.js'
import {
  type Actor,
  MAX_RECOVERY_ATTEMPTS,
  RETURN_WINDOW_MS,
} from './commerce.types.js'
import {
  assignmentIsOverdue,
  overdueAssignmentFilter,
} from './order-assignment.service.js'
import {
  activeOrderCount,
  assignmentDeadlineWarningFilter,
  assignmentQueueColumns,
  assignmentQueueFilter,
  assignmentWaitingSince,
  handoverReviewFilter,
  overdueWaitingFilter,
  receivingStaffFilter,
  workloadBreakdown,
} from './order-assignment-policy.js'
import { orderDeletionBlockReason } from './order-deletion-policy.js'
import { orderUndoPolicy, readOrderUndoFacts } from './order-undo-policy.js'
import { allocatedPaymentsForOrders } from './payment-allocation.js'
import {
  type OrderFinancials,
  paymentStatus,
  paymentSummaryForOrder,
  readOrderFinancials,
  refundAttemptClosed,
} from './payment-ledger.js'
import {
  canVerifyRefundAttempt,
  hasIndependentRefundChecker,
} from './refund-policy.js'
import { bankReviewState } from './reservation.service.js'
import { returnAllocations } from './return.service.js'

type Pagination = { limit: number; offset: number }
type OrderListInput = Pagination & {
  deletion?: 'active' | 'deleted' | 'all' | undefined
  q?: string | undefined
  paymentMethod?: 'cod' | 'bank_transfer' | undefined
  assignment?: 'mine' | 'unassigned' | undefined
  assignmentOverdue?: boolean | undefined
  assignmentWaitingOverdue?: boolean | undefined
  assignmentDeadlineSoon?: boolean | undefined
  assignmentHandoverReview?: boolean | undefined
  placedOn?: string | undefined
  status?: typeof orders.$inferSelect.status | undefined
  paymentReviewRequired?: boolean | undefined
  paymentReviewOverdue?: boolean | undefined
  codReconciliationRequired?: boolean | undefined
}

function refundActions(
  refund: typeof refunds.$inferSelect,
  latest: typeof refundAttempts.$inferSelect | undefined,
  canWork: boolean,
  actor: Actor,
  balancesVerified = true,
  checkerAvailable = true,
): string[] {
  const { role } = actor
  if (
    !canWork ||
    (role !== 'accountant' && role !== 'admin') ||
    ['settled', 'awaiting_payment', 'voided'].includes(refund.status)
  )
    return []
  if (latest?.mode === 'manual' && role !== 'admin') return []
  if (latest && !refundAttemptClosed(latest))
    return canVerifyRefundAttempt(actor, latest)
      ? ['reconcile_latest_attempt']
      : []
  if (!balancesVerified) return []
  if (!checkerAvailable) return []
  if (
    ['pending', 'partially_settled'].includes(refund.status) &&
    refundAttemptClosed(latest)
  )
    return refund.attemptCount < MAX_RECOVERY_ATTEMPTS ? ['start_attempt'] : []
  if (refund.status === 'needs_review') {
    if (role !== 'admin') return []
    if (latest && refundAttemptClosed(latest)) return ['start_manual_attempt']
  }
  return latest && canVerifyRefundAttempt(actor, latest)
    ? ['reconcile_latest_attempt']
    : []
}

function collectionStatus(
  order: typeof orders.$inferSelect,
  payment: OrderFinancials,
  party: 'customer' | 'carrier' = 'customer',
) {
  if (!payment.balancesVerified) return 'needs_reconciliation'
  if (party === 'customer' && payment.balanceDiscrepancyVnd > 0)
    return paymentStatus(payment)
  if (party === 'carrier' && payment.carrierOverremittedVnd > 0)
    return 'needs_allocation_review'
  const amountDueVnd =
    party === 'carrier'
      ? payment.carrierAmountDueVnd
      : payment.purchaseAmountDueVnd
  const resolution =
    party === 'carrier'
      ? order.carrierCollectionResolution
      : order.collectionResolution
  const failures =
    party === 'carrier'
      ? order.carrierCollectionFailureCount
      : order.collectionFailureCount
  if (order.status === 'cancelled' && party === 'customer') return 'not_due'
  if (amountDueVnd === 0)
    return party === 'customer' && payment.returnedGoodsVnd > 0
      ? 'settled_after_return'
      : 'received'
  const decision =
    party === 'carrier' ? payment.carrierDecision : payment.customerDecision
  if (
    ['debt', 'written_off'].includes(resolution) &&
    decision.unresolvedVnd > 0
  )
    return 'needs_review'
  if (resolution === 'written_off') return 'written_off'
  if (resolution === 'debt') return 'debt'
  if (failures >= MAX_RECOVERY_ATTEMPTS) return 'needs_review'
  return ['delivered', 'completed'].includes(order.status)
    ? 'awaiting_collection'
    : 'awaiting_delivery'
}

function collectionDecisionBalances(
  decisions: (typeof collectionDecisions.$inferSelect)[],
  payment: OrderFinancials,
  party: 'customer' | 'carrier',
) {
  if (!payment.balancesVerified)
    return {
      writtenOffVnd: null,
      recoveredWriteOffVnd: null,
      writeOffOffsetByReturnsVnd: null,
    }
  const writeOff = latestCollectionDecision(
    decisions.filter((record) => record.disposition === 'written_off'),
    party,
  )
  const cash =
    party === 'carrier' ? payment.carrierRemittedVnd : payment.purchaseCashVnd
  const writtenOffVnd =
    party === 'carrier'
      ? payment.carrierDecision.writtenOffVnd
      : payment.customerDecision.writtenOffVnd
  const recoveredWriteOffVnd = writeOff
    ? Math.min(
        writeOff.amountVnd - writtenOffVnd,
        Math.max(0, cash - writeOff.cashReceivedVndAtDecision),
      )
    : 0
  return {
    writtenOffVnd,
    recoveredWriteOffVnd,
    writeOffOffsetByReturnsVnd: Math.max(
      0,
      (writeOff?.amountVnd ?? 0) - writtenOffVnd - recoveredWriteOffVnd,
    ),
  }
}

export async function getOrder(
  userId: string,
  orderId: string,
  staffView = false,
) {
  return db.transaction(
    async (tx) => {
      const identity = await resolveActor(
        tx,
        userId,
        staffView ? 'workforce' : 'signed_in',
      )
      const actor = staffView
        ? identity
        : { ...identity, role: 'customer' as const }
      const now = await databaseNow(tx)
      const [order] = await tx
        .select({ ...getTableColumns(orders), ...assignmentQueueColumns(now) })
        .from(orders)
        .where(eq(orders.id, orderId))
      if (!order) fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
      assertOrderAccess(actor, order)
      const items = await getOrderItems(tx, orderId)
      const paymentRecords = await allocatedPaymentsForOrders(tx, [orderId])
      const collectionRecords = await tx
        .select()
        .from(collectionDecisions)
        .where(eq(collectionDecisions.orderId, orderId))
        .orderBy(collectionDecisions.createdAt, collectionDecisions.id)
      const carrierCollections = await tx
        .select()
        .from(codCollections)
        .where(eq(codCollections.orderId, orderId))
        .orderBy(codCollections.createdAt, codCollections.id)
      const classifications =
        actor.role === 'admin' && paymentRecords.length
          ? await tx
              .select()
              .from(paymentClassifications)
              .where(
                inArray(
                  paymentClassifications.paymentId,
                  paymentRecords.map((payment) => payment.id),
                ),
              )
          : []
      const refundRecords = await tx
        .select()
        .from(refunds)
        .where(eq(refunds.orderId, orderId))
        .orderBy(refunds.createdAt, refunds.id)
      const returnRecords = await tx
        .select()
        .from(returns)
        .where(eq(returns.orderId, orderId))
        .orderBy(returns.createdAt, returns.id)
      const shipmentRecords = await tx
        .select()
        .from(shipments)
        .where(eq(shipments.orderId, orderId))
      const shipmentCarrierId = shipmentRecords[0]?.carrierId
      const [shipmentCarrier] = shipmentCarrierId
        ? await tx
            .select({
              id: carriers.id,
              code: carriers.code,
              name: carriers.name,
            })
            .from(carriers)
            .where(eq(carriers.id, shipmentCarrierId))
        : []
      const events = await tx
        .select()
        .from(orderEvents)
        .where(eq(orderEvents.orderId, orderId))
        .orderBy(orderEvents.createdAt, orderEvents.id)
      const allocations = await returnAllocations(tx, orderId)
      const details = returnRecords.length
        ? await tx
            .select()
            .from(returnLines)
            .where(
              inArray(
                returnLines.returnId,
                returnRecords.map((record) => record.id),
              ),
            )
        : []
      const receipts = returnRecords.length
        ? await tx
            .select()
            .from(returnReceipts)
            .where(
              inArray(
                returnReceipts.returnId,
                returnRecords.map((record) => record.id),
              ),
            )
            .orderBy(returnReceipts.createdAt, returnReceipts.id)
        : []
      const attempts = refundRecords.length
        ? await tx
            .select()
            .from(refundAttempts)
            .where(
              inArray(
                refundAttempts.refundId,
                refundRecords.map((record) => record.id),
              ),
            )
            .orderBy(refundAttempts.number)
        : []
      const paymentSummary = await paymentSummaryForOrder(tx, order)
      const { paidVnd, fullyPaid, overpaidVnd } = paymentSummary
      const { refundedVnd } = paymentSummary
      const verifiedMoney = (amount: number) =>
        paymentSummary.balancesVerified ? amount : null
      const reservationActive =
        !order.reservationExpiresAt || now < order.reservationExpiresAt
      const paymentReview = bankReviewState(order, now)
      const paymentReviewRequired = paymentReview.required
      const owner = order.userId === actor.userId
      const staff = actor.role !== 'customer'
      const actorIds = [
        ...new Set([
          ...(order.assignedTo ? [order.assignedTo] : []),
          ...events.flatMap((event) =>
            event.actorUserId ? [event.actorUserId] : [],
          ),
          ...returnRecords.flatMap((record) =>
            record.decidedBy ? [record.decidedBy] : [],
          ),
          ...attempts.flatMap((attempt) => [
            attempt.recordedBy,
            ...(attempt.resolvedBy ? [attempt.resolvedBy] : []),
          ]),
        ]),
      ]
      const people =
        staff && actorIds.length
          ? await tx
              .select({ id: user.id, name: user.name })
              .from(user)
              .where(inArray(user.id, actorIds))
          : []
      const actorNames = new Map(
        people.map((person) => [person.id, person.name]),
      )
      const canWork =
        (actor.role === 'staff' || actor.role === 'admin') &&
        (actor.role === 'admin' || order.assignedTo === actor.userId)
      const canProcess = canWork && order.assignedTo !== null
      const canFinance = actor.role === 'accountant' || actor.role === 'admin'
      const receiptOrderAllocations =
        canFinance && paymentRecords.length
          ? await tx
              .select({
                paymentId: paymentAllocations.paymentId,
                orderId: paymentAllocations.orderId,
                orderCode: orders.code,
                amountVnd: sql<number>`sum(${paymentAllocations.amountVnd})::float8`,
              })
              .from(paymentAllocations)
              .innerJoin(orders, eq(orders.id, paymentAllocations.orderId))
              .where(
                inArray(paymentAllocations.paymentId, [
                  ...new Set(paymentRecords.map((record) => record.id)),
                ]),
              )
              .groupBy(
                paymentAllocations.paymentId,
                paymentAllocations.orderId,
                orders.code,
              )
              .orderBy(orders.code, paymentAllocations.orderId)
          : []
      const allocationsByReceipt = new Map<
        string,
        { orderId: string; orderCode: string; amountVnd: number }[]
      >()
      for (const { paymentId, ...allocation } of receiptOrderAllocations) {
        const existing = allocationsByReceipt.get(paymentId)
        if (existing) existing.push(allocation)
        else allocationsByReceipt.set(paymentId, [allocation])
      }
      const checkerAvailable =
        canFinance && refundRecords.length > 0
          ? await hasIndependentRefundChecker(tx, actor.userId)
          : false
      const returnWindowEndsAt = order.deliveredAt
        ? new Date(order.deliveredAt.getTime() + RETURN_WINDOW_MS)
        : null
      const canReturn =
        owner &&
        ['delivered', 'completed'].includes(order.status) &&
        returnWindowEndsAt !== null &&
        now <= returnWindowEndsAt
      const itemDetails = items.map((item) => ({
        ...item,
        remainingReturnableQuantity:
          item.quantity - (allocations.get(item.id) ?? 0),
      }))
      const customerActions: string[] = []
      if (owner && ['placed', 'confirmed'].includes(order.status))
        customerActions.push('cancel')
      if (
        owner &&
        reservationActive &&
        ['placed', 'confirmed'].includes(order.status)
      )
        customerActions.push('update_recipient')
      if (
        canReturn &&
        itemDetails.some((item) => item.remainingReturnableQuantity > 0)
      )
        customerActions.push('request_return')
      const staffActions: string[] = []
      if (
        canProcess &&
        (!paymentReviewRequired || owner) &&
        ['placed', 'confirmed', 'packing'].includes(order.status)
      )
        staffActions.push('cancel')
      if (
        canProcess &&
        reservationActive &&
        ['placed', 'confirmed'].includes(order.status)
      )
        staffActions.push('update_recipient')
      if (actor.role === 'admin' && !order.deletedAt)
        staffActions.push('assign')
      if (
        canProcess &&
        reservationActive &&
        order.status === 'placed' &&
        (order.paymentMethod === 'cod' || paymentSummary.bankPaymentApproved)
      )
        staffActions.push('confirm')
      if (
        canProcess &&
        reservationActive &&
        order.status === 'confirmed' &&
        (order.paymentMethod === 'cod' || paymentSummary.bankPaymentApproved)
      )
        staffActions.push('pack')
      if (
        canProcess &&
        reservationActive &&
        order.status === 'packing' &&
        (order.paymentMethod === 'cod' || paymentSummary.bankPaymentApproved)
      )
        staffActions.push('dispatch')
      if (
        canFinance &&
        (order.paymentMethod === 'bank_transfer' ||
          (['delivered', 'completed'].includes(order.status) &&
            (order.collectionFailureCount < MAX_RECOVERY_ATTEMPTS ||
              actor.role === 'admin')))
      )
        staffActions.push('verify_payment_receipt')
      if (
        canFinance &&
        paymentReviewRequired &&
        (actor.role === 'admin' ||
          paymentReview.responsibleRole === 'accountant')
      ) {
        if (!paymentSummary.bankPaymentApproved)
          staffActions.push('reconcile_bank_statement')
        if (
          actor.role === 'admin' &&
          paymentSummary.latePaymentApprovalRequired
        )
          staffActions.push('accept_late_bank_payment')
      }
      if (
        canFinance &&
        order.paymentMethod === 'cod' &&
        ['delivered', 'completed'].includes(order.status)
      ) {
        if (
          shipmentCarrierId &&
          (order.collectionFailureCount < MAX_RECOVERY_ATTEMPTS ||
            actor.role === 'admin')
        )
          staffActions.push('verify_customer_paid_carrier')
        if (
          paymentSummary.carrierAmountDueVnd > 0 &&
          (order.carrierCollectionFailureCount < MAX_RECOVERY_ATTEMPTS ||
            actor.role === 'admin')
        )
          staffActions.push('verify_carrier_remittance')
        if (
          paymentSummary.balancesVerified &&
          paymentSummary.carrierAmountDueVnd > 0 &&
          order.carrierCollectionResolution === 'open' &&
          order.carrierCollectionFailureCount < MAX_RECOVERY_ATTEMPTS
        )
          staffActions.push('record_carrier_collection_failure')
        if (
          actor.role === 'admin' &&
          paymentSummary.carrierAmountDueVnd > 0 &&
          order.carrierCollectionFailureCount >= MAX_RECOVERY_ATTEMPTS &&
          (['open', 'debt'].includes(order.carrierCollectionResolution) ||
            paymentSummary.carrierDecision.unresolvedVnd > 0)
        ) {
          if (
            order.carrierCollectionResolution === 'open' ||
            (order.carrierCollectionResolution === 'debt' &&
              paymentSummary.carrierDecision.unresolvedVnd > 0)
          )
            staffActions.push('record_carrier_debt')
          staffActions.push('write_off_carrier_collection')
        }
      }
      if (
        canFinance &&
        ['delivered', 'completed'].includes(order.status) &&
        order.paymentMethod === 'cod' &&
        order.collectionResolution === 'open' &&
        paymentSummary.balancesVerified &&
        paymentSummary.purchaseAmountDueVnd > 0 &&
        order.collectionFailureCount < MAX_RECOVERY_ATTEMPTS
      )
        staffActions.push('record_collection_failure')
      if (
        actor.role === 'admin' &&
        order.paymentMethod === 'cod' &&
        ['delivered', 'completed'].includes(order.status) &&
        paymentSummary.balancesVerified &&
        paymentSummary.purchaseAmountDueVnd > 0 &&
        order.collectionFailureCount >= MAX_RECOVERY_ATTEMPTS &&
        (['open', 'debt'].includes(order.collectionResolution) ||
          paymentSummary.customerDecision.unresolvedVnd > 0)
      ) {
        if (
          order.collectionResolution === 'open' ||
          (order.collectionResolution === 'debt' &&
            paymentSummary.customerDecision.unresolvedVnd > 0)
        )
          staffActions.push('record_collection_debt')
        staffActions.push('write_off_collection')
      }
      const shipment = shipmentRecords[0] ?? null
      const undo = canWork
        ? orderUndoPolicy(
            actor,
            order,
            await readOrderUndoFacts(
              tx,
              order,
              shipment,
              events,
              paymentSummary,
            ),
            now,
          )
        : null
      if (undo?.allowed) staffActions.push('undo_step')
      if (actor.role === 'admin' && shipment)
        staffActions.push(
          shipment.carrierId
            ? 'correct_shipment_carrier'
            : 'identify_shipment_carrier',
        )
      if (actor.role === 'admin' && !paymentSummary.balancesVerified) {
        if (paymentSummary.unresolvedReceiptIds.length)
          staffActions.push('reconcile_merchant_receipt_identity')
        if (paymentSummary.unclassifiedLegacyCodReceipts.length)
          staffActions.push('classify_legacy_cod_payment')
        if (paymentSummary.unresolvedCollectionIds.length)
          staffActions.push('reconcile_duplicate_cod_collections')
      }
      if (actor.role === 'admin' && order.paymentMethod === 'cod') {
        staffActions.push('adjust_cod_collection')
        if (paymentSummary.carrierOverremittedVnd > 0)
          staffActions.push('reconcile_carrier_remittance_allocation')
      }
      if (
        actor.role === 'admin' &&
        paymentSummary.balancesVerified &&
        paymentSummary.balanceDiscrepancyVnd > 0
      )
        staffActions.push(
          'review_payment_balance',
          'record_balance_recovery',
          ...(paymentSummary.refundDiscrepancyVnd > 0
            ? ['review_refund_discrepancy', 'record_refund_recovery']
            : []),
        )
      if (!paymentSummary.balancesVerified) {
        for (const action of [
          'record_collection_failure',
          'record_collection_debt',
          'write_off_collection',
          'record_carrier_collection_failure',
          'record_carrier_debt',
          'write_off_carrier_collection',
          'reconcile_bank_statement',
          'accept_late_bank_payment',
        ]) {
          const index = staffActions.indexOf(action)
          if (index >= 0) staffActions.splice(index, 1)
        }
      }
      if (canProcess && order.status === 'shipped' && shipment) {
        staffActions.push('acknowledge_delivery')
        if (shipment.status === 'in_transit')
          staffActions.push('record_delivery_failure')
        if (shipment.status === 'delivery_failed') {
          staffActions.push('receive_undelivered_shipment')
          if (shipment.failedAttempts < MAX_RECOVERY_ATTEMPTS)
            staffActions.push('retry_delivery')
        }
      }
      const deletionBlockedReason =
        actor.role === 'admin' && !order.deletedAt
          ? orderDeletionBlockReason(
              order,
              paymentSummary,
              returnRecords,
              refundRecords,
              attempts,
            )
          : null
      if (actor.role === 'admin') {
        if (order.deletedAt) staffActions.push('restore')
        else if (!deletionBlockedReason) staffActions.push('delete')
      }
      return {
        id: order.id,
        code: order.code,
        serverTime: now.toISOString(),
        status: order.status,
        revision: order.revision,
        ...(canWork ? { undo } : {}),
        ...(actor.role === 'admin'
          ? {
              deletion: {
                deletedAt: order.deletedAt,
                deletedBy: order.deletedBy,
                reason: order.deletionReason,
                blockedReason: deletionBlockedReason,
              },
            }
          : {}),
        recipient: order.recipient,
        paymentMethod: order.paymentMethod,
        bankInstructions: order.bankInstructions,
        bankTransferReference:
          order.paymentMethod === 'bank_transfer' ? order.id : null,
        reservationExpiresAt: order.reservationExpiresAt,
        reservationExpired: !reservationActive,
        paymentReviewRequired,
        paymentReviewRequiredAt: order.paymentReviewRequiredAt,
        paymentDeadlineAt: order.paymentDeadlineAt,
        paymentReview,
        stockHeldForPaymentReview:
          paymentReviewRequired && order.stockState === 'reserved',
        deliveryMethod: 'standard',
        stockState: order.stockState,
        prices: {
          currency: order.currency,
          subtotalVnd: order.subtotalVnd,
          shippingFeeVnd: order.shippingFeeVnd,
          totalVnd: order.totalVnd,
          adjustedTotalVnd: paymentSummary.adjustedTotalVnd,
          returnedGoodsVnd: paymentSummary.returnedGoodsVnd,
          shippingCreditVnd: paymentSummary.shippingCreditVnd,
          discountVnd: 0,
          additionalTaxVnd: 0,
          pricesIncludeTax: true,
        },
        items: itemDetails,
        payment: {
          status: paymentStatus(paymentSummary, refundedVnd),
          paidVnd,
          balancesVerified: paymentSummary.balancesVerified,
          receiptReconciliationRequired:
            paymentSummary.unresolvedReceiptIds.length > 0,
          paymentReceived: paymentSummary.paymentReceived,
          paymentReceivedInFull: fullyPaid,
          fulfillmentPaymentSatisfied:
            paymentSummary.fulfillmentPaymentSatisfied,
          refundLossFulfillmentApproved:
            paymentSummary.refundLossFulfillmentApproved,
          merchantPaymentReceived: paymentSummary.merchantPaymentReceived,
          customerBalanceSettled: paymentSummary.customerBalanceSettled,
          unclassifiedLegacyCodVnd: paymentSummary.unclassifiedLegacyCodVnd,
          ...(staff
            ? {
                unclassifiedLegacyCodReceipts:
                  actor.role === 'admin'
                    ? paymentSummary.unclassifiedLegacyCodReceipts
                    : paymentSummary.unclassifiedLegacyCodReceipts.map(
                        (record) => ({
                          id: record.id,
                          allocationId: record.allocationId,
                          amountVnd: record.amountVnd,
                          source: record.source,
                          receivedAt: record.receivedAt,
                        }),
                      ),
                unresolvedCollectionIds: paymentSummary.unresolvedCollectionIds,
                unresolvedReceiptIds: paymentSummary.unresolvedReceiptIds,
                classifications,
              }
            : {}),
          customerPaidVnd: paymentSummary.customerPaidVnd,
          netCustomerPaidVnd: paymentSummary.netPaidVnd,
          merchantReceivedVnd: paymentSummary.merchantReceivedVnd,
          customerPaidToCarrierVnd: paymentSummary.customerPaidToCarrierVnd,
          customerDirectReceivedVnd:
            paymentSummary.paidVnd - paymentSummary.customerPaidToCarrierVnd,
          purchaseAmountDueVnd: verifiedMoney(
            paymentSummary.purchaseAmountDueVnd,
          ),
          carrierRemittedVnd: paymentSummary.carrierRemittedVnd,
          carrierAmountDueVnd: verifiedMoney(
            paymentSummary.carrierAmountDueVnd,
          ),
          ...(staff
            ? {
                carrierOverremittedVnd: verifiedMoney(
                  paymentSummary.carrierOverremittedVnd,
                ),
              }
            : {}),
          amountDueVnd: verifiedMoney(paymentSummary.amountDueVnd),
          overpaidVnd: verifiedMoney(overpaidVnd),
          refundedVnd,
          recoveredRefundVnd: paymentSummary.recoveredRefundVnd,
          netRefundedVnd: paymentSummary.netRefundedVnd,
          refundDiscrepancyVnd: verifiedMoney(
            paymentSummary.refundDiscrepancyVnd,
          ),
          refundRecoveryDebtVnd: verifiedMoney(
            paymentSummary.refundDiscrepancy.debtVnd,
          ),
          refundRecoveryWrittenOffVnd: verifiedMoney(
            paymentSummary.refundDiscrepancy.writtenOffVnd,
          ),
          refundRecoveryUnresolvedVnd: verifiedMoney(
            paymentSummary.refundDiscrepancy.unresolvedVnd,
          ),
          balanceReview: paymentSummary.balanceReview,
          postDeliveryShortfallVnd: verifiedMoney(
            paymentSummary.postDeliveryShortfallVnd,
          ),
          balanceDiscrepancyVnd: verifiedMoney(
            paymentSummary.balanceDiscrepancyVnd,
          ),
          paymentBalanceDebtVnd: verifiedMoney(
            paymentSummary.balanceDiscrepancy.debtVnd,
          ),
          paymentBalanceWrittenOffVnd: verifiedMoney(
            paymentSummary.balanceDiscrepancy.writtenOffVnd,
          ),
          paymentBalanceUnresolvedVnd: verifiedMoney(
            paymentSummary.balanceDiscrepancy.unresolvedVnd,
          ),
          refundDueVnd: verifiedMoney(paymentSummary.refundDueVnd),
          pendingRefundVnd: paymentSummary.pendingRefundVnd,
          remainingUnallocatedPaymentVnd: verifiedMoney(
            paymentSummary.unallocatedRefundVnd,
          ),
          paymentDeadlineKnown: paymentSummary.paymentDeadlineKnown,
          paidByDeadline: paymentSummary.paidByDeadline,
          latePaymentAccepted: paymentSummary.latePaymentAccepted,
          latePaymentApprovalRequired:
            paymentSummary.latePaymentApprovalRequired,
          latePaymentAcceptedAt: paymentSummary.latePaymentAccepted
            ? order.latePaymentAcceptedAt
            : null,
          bankPaymentApproved: paymentSummary.bankPaymentApproved,
          onTimeReceivedVnd:
            paymentSummary.paymentDeadlineKnown &&
            paymentSummary.balancesVerified
              ? paymentSummary.onTimePaidVnd
              : null,
          collection:
            order.paymentMethod === 'cod'
              ? {
                  status: collectionStatus(order, paymentSummary),
                  failureCount: order.collectionFailureCount,
                  resolution: order.collectionResolution,
                  receivableVnd: verifiedMoney(
                    paymentSummary.customerDecision.debtVnd,
                  ),
                  unresolvedVnd: verifiedMoney(
                    paymentSummary.customerDecision.unresolvedVnd,
                  ),
                  ...collectionDecisionBalances(
                    collectionRecords,
                    paymentSummary,
                    'customer',
                  ),
                  ...(staff
                    ? {
                        issueReason: order.collectionIssueReason,
                        decisions: collectionRecords.filter(
                          (decision) => decision.party === 'customer',
                        ),
                      }
                    : {}),
                }
              : null,
          carrierCollection:
            staff && order.paymentMethod === 'cod'
              ? {
                  status: collectionStatus(order, paymentSummary, 'carrier'),
                  failureCount: order.carrierCollectionFailureCount,
                  resolution: order.carrierCollectionResolution,
                  amountDueVnd: verifiedMoney(
                    paymentSummary.carrierAmountDueVnd,
                  ),
                  overremittedVnd: verifiedMoney(
                    paymentSummary.carrierOverremittedVnd,
                  ),
                  receivableVnd: verifiedMoney(
                    paymentSummary.carrierDecision.debtVnd,
                  ),
                  unresolvedVnd: verifiedMoney(
                    paymentSummary.carrierDecision.unresolvedVnd,
                  ),
                  ...collectionDecisionBalances(
                    collectionRecords,
                    paymentSummary,
                    'carrier',
                  ),
                  issueReason: order.carrierCollectionIssueReason,
                  currentDecision:
                    latestCollectionDecision(collectionRecords, 'carrier') ??
                    null,
                  decisions: collectionRecords
                    .filter((decision) => decision.party === 'carrier')
                    .map((decision) => ({
                      ...decision,
                      current:
                        decision.id ===
                        latestCollectionDecision(collectionRecords, 'carrier')
                          ?.id,
                    })),
                  collections: carrierCollections.map((collection) => {
                    const remittedVnd = collection.duplicateOfId
                      ? 0
                      : paymentRecords
                          .filter(
                            (receipt) =>
                              receipt.codCollectionId === collection.id &&
                              !receipt.duplicateOfId &&
                              !receipt.receiptReconciliationRequired,
                          )
                          .reduce((sum, receipt) => sum + receipt.amountVnd, 0)
                    return {
                      ...collection,
                      active:
                        !collection.duplicateOfId &&
                        !collection.reconciliationRequired,
                      status: collection.duplicateOfId
                        ? 'duplicate'
                        : collection.reconciliationRequired
                          ? 'needs_reconciliation'
                          : 'active',
                      remittedVnd,
                      balancesVerified: paymentSummary.balancesVerified,
                      remainingVnd: collection.duplicateOfId
                        ? 0
                        : verifiedMoney(
                            Math.max(0, collection.amountVnd - remittedVnd),
                          ),
                      overremittedVnd: collection.duplicateOfId
                        ? 0
                        : verifiedMoney(
                            Math.max(0, remittedVnd - collection.amountVnd),
                          ),
                    }
                  }),
                }
              : null,
          receipts: paymentRecords.map((record) => ({
            id: record.id,
            allocationId: record.allocationId,
            method: record.method,
            source: record.source,
            codCollectionId: record.codCollectionId,
            reference: record.reference,
            amountVnd: record.amountVnd,
            receivedAt: record.receivedAt,
            receivingChannel: record.receivingChannel,
            purpose: record.purpose,
            reviewId: record.reviewId,
            receiptReconciliationRequired: record.receiptReconciliationRequired,
            duplicate: record.duplicateOfId !== null,
            ...(canFinance
              ? {
                  allocationSummary: {
                    totalVnd: record.receiptAmountVnd,
                    orders: allocationsByReceipt.get(record.id) ?? [],
                  },
                }
              : {}),
            ...(staff
              ? {
                  receivingAccountId: record.receivingAccountId,
                  duplicateOfId: record.duplicateOfId,
                  revision: record.revision,
                  ...(actor.role === 'admin'
                    ? {
                        receiptAmountVnd: record.receiptAmountVnd,
                        recordedForOrderId: record.recordedForOrderId,
                        recordedPaymentMethod: record.recordedPaymentMethod,
                      }
                    : {}),
                }
              : {}),
          })),
        },
        shipment: shipment
          ? { ...shipment, carrier: shipmentCarrier ?? null }
          : null,
        returns: returnRecords.map((record) => ({
          ...record,
          ...(staff
            ? {
                decidedByName: record.decidedBy
                  ? (actorNames.get(record.decidedBy) ?? null)
                  : null,
              }
            : {}),
          lines: details.filter((line) => line.returnId === record.id),
          receipts: receipts.filter(
            (receipt) => receipt.returnId === record.id,
          ),
          permittedActions: [
            ...(owner && ['requested', 'approved'].includes(record.status)
              ? ['withdraw']
              : []),
            ...(canProcess && record.status === 'requested'
              ? ['approve', 'reject']
              : []),
            ...(canProcess && record.status === 'approved'
              ? ['reject', 'receive_items', 'close']
              : []),
            ...(canProcess && record.status === 'receiving'
              ? ['receive_items', 'close']
              : []),
            ...(canProcess && record.status === 'received' ? ['close'] : []),
          ],
        })),
        refunds: refundRecords.map((record) => ({
          ...record,
          ...(canFinance
            ? {
                startBlockedReason:
                  !checkerAvailable &&
                  refundActions(
                    record,
                    attempts.find(
                      (attempt) =>
                        attempt.refundId === record.id &&
                        attempt.number === record.attemptCount,
                    ),
                    canFinance,
                    actor,
                    paymentSummary.balancesVerified,
                  ).some(
                    (action) =>
                      action === 'start_attempt' ||
                      action === 'start_manual_attempt',
                  )
                    ? 'REFUND_CHECKER_UNAVAILABLE'
                    : null,
              }
            : {}),
          settledVnd:
            paymentSummary.refundBalances.get(record.id)?.settledVnd ?? 0,
          approvedSettledVnd:
            paymentSummary.refundBalances.get(record.id)?.approvedSettledVnd ??
            0,
          excessSettledVnd:
            paymentSummary.refundBalances.get(record.id)?.excessSettledVnd ?? 0,
          remainingVnd:
            paymentSummary.refundBalances.get(record.id)?.remainingVnd ?? 0,
          recoveredVnd:
            paymentSummary.refundBalances.get(record.id)?.recoveredVnd ?? 0,
          netSettledVnd:
            paymentSummary.refundBalances.get(record.id)?.netSettledVnd ?? 0,
          settlements: paymentSummary.settlements.filter(
            (settlement) => settlement.refundId === record.id,
          ),
          attempts: attempts
            .filter((attempt) => attempt.refundId === record.id)
            .map((attempt) => ({
              ...attempt,
              ...(staff
                ? {
                    recordedByName: actorNames.get(attempt.recordedBy) ?? null,
                    resolvedByName: attempt.resolvedBy
                      ? (actorNames.get(attempt.resolvedBy) ?? null)
                      : null,
                  }
                : {}),
              approvedSettledVnd: attempt.settledAmountVnd,
              actualSettledVnd: paymentSummary.settlements
                .filter((row) => row.attemptId === attempt.id)
                .reduce((sum, row) => sum + row.amountVnd, 0),
              excessSettledVnd: paymentSummary.settlements
                .filter((row) => row.attemptId === attempt.id)
                .reduce((sum, row) => sum + row.excessAmountVnd, 0),
              permittedActions:
                canFinance && canVerifyRefundAttempt(actor, attempt)
                  ? ['record_exception_settlement']
                  : [],
            })),
          permittedActions: refundActions(
            record,
            attempts.find(
              (attempt) =>
                attempt.refundId === record.id &&
                attempt.number === record.attemptCount,
            ),
            canFinance,
            actor,
            paymentSummary.balancesVerified,
            checkerAvailable,
          ),
        })),
        returnWindowEndsAt,
        permittedActions: { customer: customerActions, staff: staffActions },
        history: events
          .filter(
            (event) =>
              actor.role === 'admin' ||
              (!['order_deleted', 'order_restored'].includes(event.type) &&
                (staff ||
                  ![
                    'order_assigned',
                    'cod_collection_failures_corrected',
                  ].includes(event.type))),
          )
          .map((event) => ({
            id: event.id,
            type: event.type,
            details:
              !staff && event.type === 'order_step_undone'
                ? {
                    previousStatus: event.details.previousStatus,
                    nextStatus: event.details.nextStatus,
                  }
                : actor.role !== 'admin' &&
                    [
                      'merchant_receipt_reconciled',
                      'cod_collection_adjusted',
                      'payment_allocations_adjusted',
                      'cod_collections_reconciled',
                      'payment_balance_review_decided',
                      'refund_exception_settlement_recorded',
                      'shipment_carrier_identified',
                      'shipment_carrier_corrected',
                      'cod_carrier_corrected',
                      'carrier_responsibility_corrected',
                    ].includes(event.type)
                  ? { paymentRecordsReviewed: true }
                  : event.details,
            createdAt: event.createdAt,
            ...(staff
              ? {
                  actorUserId: event.actorUserId,
                  actorName: event.actorUserId
                    ? (actorNames.get(event.actorUserId) ?? null)
                    : null,
                }
              : {}),
          })),
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        deliveredAt: order.deliveredAt,
        completedAt: order.completedAt,
        cancelledAt: order.cancelledAt,
        cancellationReason: order.cancellationReason,
        ...(staff
          ? {
              userId: order.userId,
              assignedTo: order.assignedTo,
              assignedToName: order.assignedTo
                ? (actorNames.get(order.assignedTo) ?? null)
                : null,
              assignedAt: order.assignedAt,
              assignmentSource: order.assignmentSource,
              assignmentOverdue: assignmentIsOverdue(order, now),
              assignmentWaitingSince: order.assignmentWaitingSince,
              assignmentWaitingOverdue: order.assignmentWaitingOverdue,
              assignmentDeadlineSoon: order.assignmentDeadlineSoon,
              assignmentNeedsHandover: order.assignmentNeedsHandover,
              assignmentNeedsRebalance: order.assignmentNeedsRebalance,
              assignmentHandoverReview: order.assignmentHandoverReview,
            }
          : {}),
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

export async function listOrders(
  userId: string,
  input: OrderListInput,
  staff = false,
  adminOnly = false,
) {
  return db.transaction(
    async (tx) => {
      const actor = await resolveActor(
        tx,
        userId,
        adminOnly ? 'admin' : staff ? 'workforce' : 'signed_in',
      )
      if (input.deletion === 'deleted' && (!staff || actor.role !== 'admin'))
        fail(
          403,
          'ADMIN_ACCESS_REQUIRED',
          'Only administrators may view deleted orders',
        )
      const deletionFilter =
        staff && input.deletion !== 'all'
          ? input.deletion === 'deleted'
            ? isNotNull(orders.deletedAt)
            : isNull(orders.deletedAt)
          : undefined
      const visibility = staff
        ? actor.role !== 'staff'
          ? undefined
          : eq(orders.assignedTo, userId)
        : eq(orders.userId, userId)
      const now = await databaseNow(tx)
      const reviewRequired = sql`(${orders.paymentMethod} = 'bank_transfer' and ${orders.stockState} = 'reserved' and ${orders.reservationExpiresAt} is not null and ${orders.reservationExpiresAt} <= ${now})`
      const assignmentOverdue = overdueAssignmentFilter(now)
      const reviewOverdue = sql`(${reviewRequired} and ${orders.paymentReviewDueAt} is not null and ${orders.paymentReviewDueAt} <= ${now})`
      const query = input.q?.trim().replace(/^#\s*/, '').trim()
      const searchFilter = query
        ? /^TV[1-9][0-9]*$/i.test(query)
          ? eq(orders.code, query.toUpperCase())
          : sql`strpos(lower(concat_ws(' ', ${orders.code}, ${orders.id}::text, ${orders.recipient}->>'name', ${orders.recipient}->>'phone')), lower(${query})) > 0`
        : undefined
      const baseFilter = and(
        visibility,
        searchFilter,
        input.paymentMethod
          ? eq(orders.paymentMethod, input.paymentMethod)
          : undefined,
        input.placedOn
          ? sql`${orders.createdAt} >= (${input.placedOn}::date::timestamp at time zone 'Asia/Ho_Chi_Minh') and ${orders.createdAt} < ((${input.placedOn}::date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')`
          : undefined,
      )
      const filter = and(
        baseFilter,
        deletionFilter,
        input.status ? eq(orders.status, input.status) : undefined,
        input.assignment === 'mine'
          ? eq(orders.assignedTo, userId)
          : input.assignment === 'unassigned'
            ? assignmentQueueFilter(now)
            : undefined,
        input.assignmentOverdue === undefined
          ? undefined
          : sql`${assignmentOverdue} = ${input.assignmentOverdue}`,
        input.assignmentWaitingOverdue === undefined
          ? undefined
          : sql`coalesce(${overdueWaitingFilter(now)}, false) = ${input.assignmentWaitingOverdue}`,
        input.assignmentDeadlineSoon === undefined
          ? undefined
          : sql`coalesce(${assignmentDeadlineWarningFilter(now)}, false) = ${input.assignmentDeadlineSoon}`,
        input.assignmentHandoverReview === undefined
          ? undefined
          : sql`coalesce(${handoverReviewFilter(now)}, false) = ${input.assignmentHandoverReview}`,
        input.paymentReviewRequired === undefined
          ? undefined
          : sql`${reviewRequired} = ${input.paymentReviewRequired}`,
        input.paymentReviewOverdue === undefined
          ? undefined
          : sql`${reviewOverdue} = ${input.paymentReviewOverdue}`,
        input.codReconciliationRequired === undefined
          ? undefined
          : sql`(${orders.paymentMethod} = 'cod' and (exists
          (select 1 from ${paymentAllocations} inner join ${payments} on ${payments.id} = ${paymentAllocations.paymentId} where ${paymentAllocations.orderId} = ${orders.id} and ${payments.duplicateOfId} is null and ((${payments.source} = 'legacy' and ${payments.method} = 'cod') or ${payments.receiptReconciliationRequired}))
          or exists (select 1 from ${codCollections} where ${codCollections.orderId} = ${orders.id} and ${codCollections.reconciliationRequired}))) = ${input.codReconciliationRequired}`,
      )
      const records = await tx
        .select({ ...getTableColumns(orders), ...assignmentQueueColumns(now) })
        .from(orders)
        .where(filter)
        .orderBy(
          ...(input.assignment === 'unassigned' ||
          input.assignmentWaitingOverdue ||
          input.assignmentDeadlineSoon
            ? [assignmentWaitingSince(now), orders.id]
            : [desc(orders.createdAt), desc(orders.id)]),
        )
        .limit(input.limit)
        .offset(input.offset)
      const financials = await readOrderFinancials(tx, records)
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(orders)
        .where(filter)
      const [stats] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          unassigned: sql<number>`count(*) filter (where ${assignmentQueueFilter(now)})::int`,
          mine: sql<number>`count(*) filter (where ${orders.assignedTo} = ${userId})::int`,
          assignmentOverdue: sql<number>`count(*) filter (where ${assignmentOverdue})::int`,
          assignmentWaitingOverdue: sql<number>`count(*) filter (where ${overdueWaitingFilter(now)})::int`,
          assignmentDeadlineSoon: sql<number>`count(*) filter (where ${assignmentDeadlineWarningFilter(now)})::int`,
          assignmentHandoverReview: sql<number>`count(*) filter (where ${handoverReviewFilter(now)})::int`,
          placed: sql<number>`count(*) filter (where ${orders.status} = 'placed')::int`,
          packing: sql<number>`count(*) filter (where ${orders.status} = 'packing')::int`,
          shipped: sql<number>`count(*) filter (where ${orders.status} = 'shipped')::int`,
          paymentReviewRequired: sql<number>`count(*) filter (where ${reviewRequired})::int`,
          paymentReviewOverdue: sql<number>`count(*) filter (where ${reviewOverdue})::int`,
        })
        .from(orders)
        .where(
          and(
            baseFilter,
            staff && input.deletion !== 'all'
              ? isNull(orders.deletedAt)
              : undefined,
          ),
        )
      const [deletedCount] =
        staff && actor.role === 'admin'
          ? await tx
              .select({ total: sql<number>`count(*)::int` })
              .from(orders)
              .where(and(baseFilter, isNotNull(orders.deletedAt)))
          : []
      const assigneeIds = [
        ...new Set(
          records.flatMap((order) =>
            order.assignedTo ? [order.assignedTo] : [],
          ),
        ),
      ]
      const assignees =
        staff && assigneeIds.length
          ? await tx
              .select({ id: user.id, name: user.name })
              .from(user)
              .where(inArray(user.id, assigneeIds))
          : []
      const assigneeNames = new Map(
        assignees.map((person) => [person.id, person.name]),
      )
      return {
        total: count?.total ?? 0,
        stats: {
          ...stats,
          ...(staff && actor.role === 'admin'
            ? { deleted: deletedCount?.total ?? 0 }
            : {}),
        },
        items: records.map((order) => {
          const summary = financials.get(order.id)
          if (!summary)
            fail(
              503,
              'PAYMENT_LEDGER_UNAVAILABLE',
              'Order ledger is unavailable',
            )
          const verifiedMoney = (amount: number) =>
            summary.balancesVerified ? amount : null
          const paymentReview = bankReviewState(order, now)
          return {
            id: order.id,
            code: order.code,
            paymentStatus: paymentStatus(summary),
            status: order.status,
            revision: order.revision,
            recipient: order.recipient,
            currency: order.currency,
            totalVnd: order.totalVnd,
            adjustedTotalVnd: summary.adjustedTotalVnd,
            paymentMethod: order.paymentMethod,
            collectionFailureCount: order.collectionFailureCount,
            collectionNeedsReview:
              order.paymentMethod === 'cod' &&
              summary.balancesVerified &&
              ['delivered', 'completed'].includes(order.status) &&
              summary.customerDecision.unresolvedVnd > 0 &&
              order.collectionFailureCount >= MAX_RECOVERY_ATTEMPTS,
            collectionResolution: order.collectionResolution,
            reservationExpiresAt: order.reservationExpiresAt,
            paymentReviewRequiredAt: order.paymentReviewRequiredAt,
            paymentReviewRequired: paymentReview.required,
            paymentReviewOverdue: paymentReview.overdue,
            paymentReview,
            paymentDeadlineAt: order.paymentDeadlineAt,
            paymentDeadlineKnown: summary.paymentDeadlineKnown,
            paidByDeadline: summary.paidByDeadline,
            latePaymentAccepted: summary.latePaymentAccepted,
            latePaymentApprovalRequired: summary.latePaymentApprovalRequired,
            bankPaymentApproved: summary.bankPaymentApproved,
            onTimeReceivedVnd:
              summary.paymentDeadlineKnown && summary.balancesVerified
                ? summary.onTimePaidVnd
                : null,
            paymentReceived: summary.paymentReceived,
            paymentReceivedInFull: summary.fullyPaid,
            fulfillmentPaymentSatisfied: summary.fulfillmentPaymentSatisfied,
            refundLossFulfillmentApproved:
              summary.refundLossFulfillmentApproved,
            merchantPaymentReceived: summary.merchantPaymentReceived,
            customerBalanceSettled: summary.customerBalanceSettled,
            balancesVerified: summary.balancesVerified,
            codReconciliationRequired:
              order.paymentMethod === 'cod' && !summary.balancesVerified,
            receiptReconciliationRequired:
              summary.unresolvedReceiptIds.length > 0,
            unclassifiedLegacyCodVnd: summary.unclassifiedLegacyCodVnd,
            paidVnd: summary.paidVnd,
            merchantReceivedVnd: summary.merchantReceivedVnd,
            customerPaidToCarrierVnd: summary.customerPaidToCarrierVnd,
            carrierRemittedVnd: summary.carrierRemittedVnd,
            carrierAmountDueVnd: verifiedMoney(summary.carrierAmountDueVnd),
            ...(staff
              ? {
                  carrierOverremittedVnd: verifiedMoney(
                    summary.carrierOverremittedVnd,
                  ),
                }
              : {}),
            carrierCollectionResolution: order.carrierCollectionResolution,
            carrierCollectionFailureCount: order.carrierCollectionFailureCount,
            carrierCollectionNeedsReview:
              summary.balancesVerified &&
              summary.carrierDecision.unresolvedVnd > 0 &&
              order.carrierCollectionFailureCount >= MAX_RECOVERY_ATTEMPTS,
            amountDueVnd: verifiedMoney(summary.amountDueVnd),
            receivableVnd: verifiedMoney(summary.customerDecision.debtVnd),
            writtenOffVnd: verifiedMoney(
              summary.customerDecision.writtenOffVnd,
            ),
            carrierReceivableVnd: verifiedMoney(
              summary.carrierDecision.debtVnd,
            ),
            carrierWrittenOffVnd: verifiedMoney(
              summary.carrierDecision.writtenOffVnd,
            ),
            refundedVnd: summary.refundedVnd,
            recoveredRefundVnd: summary.recoveredRefundVnd,
            refundDiscrepancyVnd: verifiedMoney(summary.refundDiscrepancyVnd),
            postDeliveryShortfallVnd: verifiedMoney(
              summary.postDeliveryShortfallVnd,
            ),
            balanceDiscrepancyVnd: verifiedMoney(summary.balanceDiscrepancyVnd),
            paymentBalanceDebtVnd: verifiedMoney(
              summary.balanceDiscrepancy.debtVnd,
            ),
            paymentBalanceWrittenOffVnd: verifiedMoney(
              summary.balanceDiscrepancy.writtenOffVnd,
            ),
            paymentBalanceUnresolvedVnd: verifiedMoney(
              summary.balanceDiscrepancy.unresolvedVnd,
            ),
            refundRecoveryDebtVnd: verifiedMoney(
              summary.refundDiscrepancy.debtVnd,
            ),
            refundRecoveryWrittenOffVnd: verifiedMoney(
              summary.refundDiscrepancy.writtenOffVnd,
            ),
            refundRecoveryUnresolvedVnd: verifiedMoney(
              summary.refundDiscrepancy.unresolvedVnd,
            ),
            balanceReview: summary.balanceReview,
            refundDueVnd: verifiedMoney(summary.refundDueVnd),
            pendingRefundVnd: summary.pendingRefundVnd,
            createdAt: order.createdAt,
            ...(staff
              ? {
                  deletedAt: order.deletedAt,
                  assignedTo: order.assignedTo,
                  assignedAt: order.assignedAt,
                  assignmentSource: order.assignmentSource,
                  assignmentOverdue: assignmentIsOverdue(order, now),
                  assignmentWaitingSince: order.assignmentWaitingSince,
                  assignmentWaitingOverdue: order.assignmentWaitingOverdue,
                  assignmentDeadlineSoon: order.assignmentDeadlineSoon,
                  assignmentNeedsHandover: order.assignmentNeedsHandover,
                  assignmentNeedsRebalance: order.assignmentNeedsRebalance,
                  assignmentHandoverReview: order.assignmentHandoverReview,
                  assignedToName: order.assignedTo
                    ? (assigneeNames.get(order.assignedTo) ?? null)
                    : null,
                }
              : {}),
          }
        }),
        limit: input.limit,
        offset: input.offset,
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

export async function listAfterSaleWork(
  userId: string,
  input: Pagination,
  kind: 'returns' | 'refunds',
) {
  return db.transaction(
    async (tx) => {
      const actor = await resolveActor(
        tx,
        userId,
        kind === 'refunds' ? 'accountant' : 'staff',
      )
      const visibility =
        actor.role !== 'staff' ? undefined : eq(orders.assignedTo, userId)
      if (kind === 'returns')
        return {
          items: await tx
            .select({
              request: returns,
              orderCode: orders.code,
              assignedTo: orders.assignedTo,
            })
            .from(returns)
            .innerJoin(orders, eq(orders.id, returns.orderId))
            .where(
              and(
                visibility,
                inArray(returns.status, [
                  'requested',
                  'approved',
                  'receiving',
                  'received',
                ]),
              ),
            )
            .orderBy(returns.createdAt, returns.id)
            .limit(input.limit)
            .offset(input.offset),
          ...input,
        }
      const records = await tx
        .select({ refund: refunds, order: orders })
        .from(refunds)
        .innerJoin(orders, eq(orders.id, refunds.orderId))
        .where(
          and(
            visibility,
            or(
              inArray(refunds.status, [
                'awaiting_payment',
                'pending',
                'processing',
                'unknown',
                'needs_review',
                'partially_settled',
              ]),
              actor.role === 'admin'
                ? and(
                    eq(refunds.status, 'settled'),
                    sql`exists (select 1 from ${paymentBalanceReviews} where ${paymentBalanceReviews.orderId} = ${orders.id} and ${paymentBalanceReviews.status} in ('needs_review', 'debt'))`,
                  )
                : undefined,
            ),
          ),
        )
        .orderBy(refunds.createdAt, refunds.id)
        .limit(input.limit)
        .offset(input.offset)
      const financials = await readOrderFinancials(tx, [
        ...new Map(records.map((row) => [row.order.id, row.order])).values(),
      ])
      return {
        items: records.map(({ refund, order }) => ({
          orderCode: order.code,
          refund: {
            ...refund,
            blockedByPaymentReconciliation: !financials.get(order.id)
              ?.balancesVerified,
            blockedByCodReconciliation:
              order.paymentMethod === 'cod' &&
              !financials.get(order.id)?.balancesVerified,
            settledVnd:
              financials.get(order.id)?.refundBalances.get(refund.id)
                ?.settledVnd ?? 0,
            remainingVnd:
              financials.get(order.id)?.refundBalances.get(refund.id)
                ?.remainingVnd ?? 0,
            excessSettledVnd:
              financials.get(order.id)?.refundBalances.get(refund.id)
                ?.excessSettledVnd ?? 0,
          },
          assignedTo: order.assignedTo,
          paymentBalanceReview: financials.get(order.id)?.balanceReview ?? null,
          refundDiscrepancyVnd: financials.get(order.id)?.balancesVerified
            ? financials.get(order.id)?.refundDiscrepancyVnd
            : null,
        })),
        ...input,
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

export async function listStaffUsers(
  userId: string,
  input: Pagination & {
    q?: string | undefined
    assignable?: boolean | undefined
  },
) {
  return db.transaction(
    async (tx) => {
      await resolveActor(tx, userId, 'admin')
      const now = await databaseNow(tx)
      const filter = and(
        input.assignable ? staffUserFilter() : undefined,
        input.q
          ? sql`strpos(lower(concat_ws(' ', ${user.name}, ${user.email}, ${user.id})), lower(${input.q})) > 0`
          : undefined,
      )
      const records = await tx
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          settings: {
            enabled: staffOrderSettings.enabled,
            acceptingOrders: staffOrderSettings.acceptingOrders,
            maxActiveOrders: staffOrderSettings.maxActiveOrders,
            lastAssignedAt: staffOrderSettings.lastAssignedAt,
            revision: staffOrderSettings.revision,
            shiftEndsAt: staffOrderSettings.shiftEndsAt,
          },
          receivingNow: sql<boolean>`coalesce(${receivingStaffFilter(now)}, false)`,
          workload: {
            activeOrders: activeOrderCount(user.id, now),
            ...workloadBreakdown(user.id, now),
          },
        })
        .from(user)
        .leftJoin(staffOrderSettings, eq(staffOrderSettings.userId, user.id))
        .where(filter)
        .orderBy(user.name, user.id)
        .limit(input.limit)
        .offset(input.offset)
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(user)
        .where(filter)
      return {
        total: count?.total ?? 0,
        items: records.map(
          ({ settings, workload, receivingNow, ...record }) => ({
            ...record,
            role: env.ORDER_ADMIN_USER_IDS.includes(record.id)
              ? 'admin'
              : record.role,
            orderAssignment: {
              enabled: settings?.enabled ?? false,
              acceptingOrders: settings?.acceptingOrders ?? false,
              maxActiveOrders: settings?.maxActiveOrders ?? 20,
              lastAssignedAt: settings?.lastAssignedAt ?? null,
              revision: settings?.revision ?? 0,
              shiftEndsAt: settings?.shiftEndsAt ?? null,
              receivingNow,
              ...workload,
            },
          }),
        ),
        ...input,
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

export async function listRoleHistory(userId: string, input: Pagination) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'admin')
    return {
      items: await tx
        .select()
        .from(roleChanges)
        .orderBy(desc(roleChanges.createdAt), desc(roleChanges.id))
        .limit(input.limit)
        .offset(input.offset),
      ...input,
    }
  })
}
