import { eq, inArray } from 'drizzle-orm'
import {
  codCollections,
  collectionDecisions,
  orderItems,
  orders,
  paymentBalanceReviews,
  refundAttempts,
  refundSettlements,
  refunds,
  returnLines,
  returns,
} from '../../db/schema.js'
import { bankPaymentFingerprint } from './bank-payment-policy.js'
import { latestCollectionDecision } from './collection-decision.js'
import {
  appendOrderEvent,
  databaseNow,
  fail,
  type Order,
  type Transaction,
} from './commerce.persistence.js'
import {
  type AuditActor,
  MAX_RECOVERY_ATTEMPTS,
  MAX_VND,
} from './commerce.types.js'
import {
  type AllocatedPayment,
  allocatedPaymentsForOrders,
} from './payment-allocation.js'
import {
  refundDiscrepancyDisposition,
  syncPaymentBalanceReview,
} from './payment-balance-review.js'

function sumMoney(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (!Number.isSafeInteger(total))
    fail(409, 'PAYMENT_AMOUNT_LIMIT', 'Money total exceeds supported precision')
  return total
}

// Commands hold the order lock; read models use a repeatable-read snapshot.
// A carrier collection is customer cash, while its remittance is merchant cash.
export async function readOrderFinancials(tx: Transaction, records: Order[]) {
  const ids = records.map((record) => record.id)
  if (!ids.length) return new Map<string, OrderFinancials>()
  const [receipts, collections, obligations, credits, decisions, reviews] =
    await Promise.all([
      allocatedPaymentsForOrders(tx, ids),
      tx
        .select()
        .from(codCollections)
        .where(inArray(codCollections.orderId, ids)),
      tx.select().from(refunds).where(inArray(refunds.orderId, ids)),
      tx
        .select({
          orderId: returns.orderId,
          responsibility: returns.responsibility,
          quantity: returnLines.receivedQuantity,
          unitPriceVnd: orderItems.unitPriceVnd,
        })
        .from(returnLines)
        .innerJoin(returns, eq(returns.id, returnLines.returnId))
        .innerJoin(orderItems, eq(orderItems.id, returnLines.orderItemId))
        .where(inArray(returns.orderId, ids)),
      tx
        .select()
        .from(collectionDecisions)
        .where(inArray(collectionDecisions.orderId, ids)),
      tx
        .select()
        .from(paymentBalanceReviews)
        .where(inArray(paymentBalanceReviews.orderId, ids)),
    ])
  const settlements = obligations.length
    ? await tx
        .select()
        .from(refundSettlements)
        .where(
          inArray(
            refundSettlements.refundId,
            obligations.map((refund) => refund.id),
          ),
        )
    : []
  return new Map(
    records.map((order) => [
      order.id,
      summarizeOrderFinancials(
        order,
        receipts.filter((row) => row.orderId === order.id),
        collections.filter((row) => row.orderId === order.id),
        obligations.filter((row) => row.orderId === order.id),
        credits.filter((row) => row.orderId === order.id),
        settlements,
        decisions.filter((row) => row.orderId === order.id),
        reviews.find((row) => row.orderId === order.id),
      ),
    ]),
  )
}

function summarizeOrderFinancials(
  order: Order,
  receipts: AllocatedPayment[],
  collections: (typeof codCollections.$inferSelect)[],
  obligations: (typeof refunds.$inferSelect)[],
  credits: { quantity: number; unitPriceVnd: number; responsibility: string }[],
  allSettlements: (typeof refundSettlements.$inferSelect)[],
  decisions: (typeof collectionDecisions.$inferSelect)[],
  review: typeof paymentBalanceReviews.$inferSelect | undefined,
) {
  const returnedGoodsVnd = sumMoney(
    credits.map((line) => line.quantity * line.unitPriceVnd),
  )
  if (returnedGoodsVnd > order.subtotalVnd)
    fail(409, 'RETURN_CREDIT_LIMIT', 'Accepted returns exceed ordered goods')
  const shippingCreditVnd =
    returnedGoodsVnd === order.subtotalVnd &&
    credits
      .filter((line) => line.quantity > 0)
      .every((line) => line.responsibility !== 'customer')
      ? order.shippingFeeVnd
      : 0
  const adjustedTotalVnd =
    order.status === 'cancelled'
      ? 0
      : order.totalVnd - returnedGoodsVnd - shippingCreditVnd
  const activeReceipts = receipts.filter((receipt) => !receipt.duplicateOfId)
  const unresolvedReceiptIds = activeReceipts
    .filter((receipt) => receipt.receiptReconciliationRequired)
    .map((receipt) => receipt.id)
  const verifiedReceipts = activeReceipts.filter(
    (receipt) => !receipt.receiptReconciliationRequired,
  )
  const merchantReceivedVnd = sumMoney(
    verifiedReceipts.map((receipt) => receipt.amountVnd),
  )
  const unclassifiedLegacyCodReceipts = activeReceipts.filter(
    (receipt) =>
      receipt.recordedPaymentMethod === 'cod' && receipt.source === 'legacy',
  )
  const unresolvedCollections = collections.filter(
    (collection) => collection.reconciliationRequired,
  )
  const balancesVerified =
    unresolvedReceiptIds.length === 0 &&
    unclassifiedLegacyCodReceipts.length === 0 &&
    unresolvedCollections.length === 0
  const verifiedCollections = collections.filter(
    (collection) =>
      !collection.reconciliationRequired && !collection.duplicateOfId,
  )
  const customerPaidToCarrierVnd = sumMoney(
    verifiedCollections.map((receipt) => receipt.amountVnd),
  )
  const carrierRemittedVnd = sumMoney(
    verifiedReceipts
      .filter((receipt) => receipt.source === 'carrier')
      .map((receipt) => receipt.amountVnd),
  )
  const carrierBalances = verifiedCollections.map((collection) => {
    const remitted = sumMoney(
      verifiedReceipts
        .filter(
          (receipt) =>
            receipt.source === 'carrier' &&
            receipt.codCollectionId === collection.id,
        )
        .map((receipt) => receipt.amountVnd),
    )
    return {
      due: Math.max(0, collection.amountVnd - remitted),
      excess: Math.max(0, remitted - collection.amountVnd),
    }
  })
  const paidVnd = sumMoney([
    ...verifiedReceipts
      .filter(
        (receipt) =>
          receipt.purpose === 'payment' &&
          (receipt.source === 'customer' ||
            (receipt.source === 'legacy' &&
              receipt.recordedPaymentMethod === 'bank_transfer')),
      )
      .map((receipt) => receipt.amountVnd),
    customerPaidToCarrierVnd,
  ])
  const refundIds = new Set(obligations.map((refund) => refund.id))
  const settlements = allSettlements.filter((row) =>
    refundIds.has(row.refundId),
  )
  const refundedVnd = sumMoney(
    settlements.map((settlement) => settlement.amountVnd),
  )
  const recoveredRefundVnd = sumMoney(
    verifiedReceipts
      .filter((receipt) => receipt.purpose === 'refund_recovery')
      .map((receipt) => receipt.amountVnd),
  )
  let recoveryToAllocateVnd = recoveredRefundVnd
  const refundBalances = new Map(
    [...obligations]
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .map((refund) => {
        const settledVnd = sumMoney(
          settlements
            .filter((row) => row.refundId === refund.id)
            .map((row) => row.amountVnd),
        )
        const recoveredVnd = Math.min(settledVnd, recoveryToAllocateVnd)
        const excessSettledVnd = sumMoney(
          settlements
            .filter((row) => row.refundId === refund.id)
            .map((row) => row.excessAmountVnd),
        )
        recoveryToAllocateVnd -= recoveredVnd
        return [
          refund.id,
          {
            settledVnd,
            approvedSettledVnd: settledVnd - excessSettledVnd,
            excessSettledVnd,
            recoveredVnd,
            netSettledVnd: settledVnd - recoveredVnd,
            remainingVnd:
              refund.status === 'voided'
                ? 0
                : Math.max(0, refund.amountVnd - settledVnd),
          },
        ]
      }),
  )
  const netRefundedVnd = refundedVnd - recoveredRefundVnd
  const netPaidVnd = paidVnd - netRefundedVnd
  const amountDueVnd = Math.max(0, adjustedTotalVnd - netPaidVnd)
  const refundDueVnd = Math.max(0, netPaidVnd - adjustedTotalVnd)
  const grossRefundEntitlementVnd = Math.max(0, paidVnd - adjustedTotalVnd)
  const refundDiscrepancyVnd = Math.max(
    0,
    netRefundedVnd - grossRefundEntitlementVnd,
  )
  const purchaseAmountDueVnd = Math.max(0, amountDueVnd - refundDiscrepancyVnd)
  const postDeliveryShortfallVnd =
    order.paymentMethod === 'bank_transfer' &&
    order.deliveredAt !== null &&
    ['delivered', 'completed'].includes(order.status)
      ? purchaseAmountDueVnd
      : 0
  const balanceDiscrepancyVnd = sumMoney([
    refundDiscrepancyVnd,
    postDeliveryShortfallVnd,
  ])
  const balanceDiscrepancy = refundDiscrepancyDisposition(
    review,
    balanceDiscrepancyVnd,
    recoveredRefundVnd,
    paidVnd,
  )
  const refundCoveredVnd = Math.min(
    refundDiscrepancyVnd,
    balanceDiscrepancy.debtVnd + balanceDiscrepancy.writtenOffVnd,
  )
  const refundDiscrepancy = {
    debtVnd: Math.min(refundDiscrepancyVnd, balanceDiscrepancy.debtVnd),
    writtenOffVnd: Math.min(
      refundDiscrepancyVnd,
      balanceDiscrepancy.writtenOffVnd,
    ),
    unresolvedVnd: refundDiscrepancyVnd - refundCoveredVnd,
  }
  const postDeliveryPaymentDecision = {
    debtVnd: Math.max(
      0,
      balanceDiscrepancy.debtVnd - refundDiscrepancy.debtVnd,
    ),
    writtenOffVnd: Math.max(
      0,
      balanceDiscrepancy.writtenOffVnd - refundDiscrepancy.writtenOffVnd,
    ),
    unresolvedVnd:
      postDeliveryShortfallVnd -
      Math.max(
        0,
        balanceDiscrepancy.debtVnd +
          balanceDiscrepancy.writtenOffVnd -
          refundCoveredVnd,
      ),
  }
  const carrierAmountDueVnd = sumMoney(
    carrierBalances.map((balance) => balance.due),
  )
  // A correction may expose real merchant cash not allocated to a customer collection.
  // It is carrier money to reconcile, never an additional customer payment/refund.
  const carrierOverremittedVnd = sumMoney(
    carrierBalances.map((balance) => balance.excess),
  )
  const decisionBalance = (
    party: 'customer' | 'carrier',
    due: number,
    cash: number,
    resolution: string,
  ) => {
    const latest = latestCollectionDecision(decisions, party)
    const remainingApproved =
      latest && latest.disposition === resolution
        ? Math.max(
            0,
            latest.amountVnd -
              Math.max(0, cash - latest.cashReceivedVndAtDecision),
          )
        : 0
    const covered = Math.min(due, remainingApproved)
    return {
      debtVnd: resolution === 'debt' ? covered : 0,
      writtenOffVnd: resolution === 'written_off' ? covered : 0,
      unresolvedVnd: due - covered,
    }
  }
  const customerDecision =
    postDeliveryShortfallVnd > 0
      ? postDeliveryPaymentDecision
      : decisionBalance(
          'customer',
          Math.max(0, amountDueVnd - refundDiscrepancyVnd),
          Math.max(0, netPaidVnd),
          order.collectionResolution,
        )
  const carrierDecision = decisionBalance(
    'carrier',
    carrierAmountDueVnd,
    carrierRemittedVnd,
    order.carrierCollectionResolution,
  )
  const committedRefundVnd = sumMoney(
    obligations
      .filter((refund) => refund.status !== 'voided')
      .map((refund) => refundBalances.get(refund.id)?.remainingVnd ?? 0),
  )
  const onTimePaidVnd = sumMoney(
    verifiedReceipts
      .filter(
        (receipt) =>
          receipt.method === 'bank_transfer' &&
          receipt.purpose === 'payment' &&
          receipt.source !== 'carrier' &&
          order.paymentDeadlineAt !== null &&
          receipt.receivedAt <= order.paymentDeadlineAt,
      )
      .map((receipt) => receipt.amountVnd),
  )
  const fullyPaid =
    balancesVerified && paidVnd > 0 && netPaidVnd >= order.totalVnd
  // A store loss can fund fulfillment only by an explicit admin decision. It
  // never becomes customer cash or changes the actual fully-paid balance.
  const refundLossFulfillmentEligible =
    balancesVerified &&
    order.paymentMethod === 'bank_transfer' &&
    order.stockState === 'reserved' &&
    ['placed', 'confirmed', 'packing'].includes(order.status) &&
    paidVnd >= order.totalVnd &&
    purchaseAmountDueVnd === 0 &&
    refundDiscrepancyVnd > 0
  const refundLossFulfillmentApproved =
    balancesVerified &&
    order.paymentMethod === 'bank_transfer' &&
    review?.allowFulfillment === true &&
    review.status === 'written_off' &&
    paidVnd >= order.totalVnd &&
    purchaseAmountDueVnd === 0 &&
    refundDiscrepancyVnd > 0 &&
    refundDiscrepancy.writtenOffVnd === refundDiscrepancyVnd
  const fulfillmentPaymentSatisfied = fullyPaid || refundLossFulfillmentApproved
  const bankReceiptReceivedByDeadline =
    balancesVerified &&
    order.paymentDeadlineAt !== null &&
    onTimePaidVnd >= order.totalVnd
  const paidByDeadline =
    bankReceiptReceivedByDeadline && netPaidVnd >= order.totalVnd
  const fingerprint = bankPaymentFingerprint(order, verifiedReceipts)
  const latePaymentAccepted =
    order.paymentMethod === 'bank_transfer' &&
    balancesVerified &&
    order.latePaymentAcceptedAt !== null &&
    order.latePaymentAcceptedBy !== null &&
    order.latePaymentAcceptedFingerprint === fingerprint
  return {
    paidVnd,
    customerPaidVnd: paidVnd,
    merchantReceivedVnd,
    balancesVerified,
    unresolvedReceiptIds,
    unclassifiedLegacyCodReceipts,
    unclassifiedLegacyCodVnd: sumMoney(
      unclassifiedLegacyCodReceipts.map((receipt) => receipt.amountVnd),
    ),
    unresolvedCollectionIds: unresolvedCollections.map(
      (collection) => collection.id,
    ),
    paymentReceived: paidVnd > 0,
    merchantPaymentReceived: merchantReceivedVnd > 0,
    customerBalanceSettled: balancesVerified && amountDueVnd === 0,
    customerPaidToCarrierVnd,
    carrierRemittedVnd,
    carrierAmountDueVnd,
    carrierOverremittedVnd,
    customerDecision,
    carrierDecision,
    returnedGoodsVnd,
    shippingCreditVnd,
    adjustedTotalVnd,
    refundedVnd,
    recoveredRefundVnd,
    netRefundedVnd,
    refundDiscrepancyVnd,
    refundDiscrepancy,
    postDeliveryShortfallVnd,
    balanceDiscrepancyVnd,
    balanceDiscrepancy,
    balanceReview: review
      ? {
          ...review,
          discrepancyVnd: balancesVerified ? balanceDiscrepancyVnd : null,
          purchaseShortfallVnd: balancesVerified
            ? postDeliveryShortfallVnd
            : null,
        }
      : null,
    netPaidVnd,
    amountDueVnd,
    purchaseAmountDueVnd,
    purchaseCashVnd: Math.max(0, netPaidVnd),
    refundDueVnd,
    overpaidVnd: refundDueVnd,
    fullyPaid,
    refundLossFulfillmentEligible,
    refundLossFulfillmentApproved,
    fulfillmentPaymentSatisfied,
    grossRefundEntitlementVnd,
    pendingRefundVnd: committedRefundVnd,
    unallocatedRefundVnd: Math.max(0, refundDueVnd - committedRefundVnd),
    onTimePaidVnd,
    paymentDeadlineKnown: order.paymentDeadlineAt !== null,
    paidByDeadline,
    bankPaymentFingerprint: fingerprint,
    latePaymentAccepted,
    latePaymentApprovalRequired:
      order.paymentMethod === 'bank_transfer' &&
      order.stockState === 'reserved' &&
      fulfillmentPaymentSatisfied &&
      !bankReceiptReceivedByDeadline &&
      !latePaymentAccepted,
    bankPaymentApproved:
      fulfillmentPaymentSatisfied &&
      (bankReceiptReceivedByDeadline || latePaymentAccepted),
    refundBalances,
    settlements,
  }
}

export type OrderFinancials = ReturnType<typeof summarizeOrderFinancials>

export function assertFinancialsVerified(payment: OrderFinancials) {
  if (!payment.balancesVerified)
    fail(
      409,
      'PAYMENT_RECONCILIATION_REQUIRED',
      'Administrator must verify receipt identities, classify legacy COD payments and reconcile ambiguous collections first',
    )
}

export async function paymentSummaryForOrder(tx: Transaction, order: Order) {
  const result = (await readOrderFinancials(tx, [order])).get(order.id)
  if (!result)
    fail(503, 'PAYMENT_LEDGER_UNAVAILABLE', 'Order ledger is unavailable')
  return result
}

export function paymentStatus(
  payment: OrderFinancials,
  refundedVnd = payment.refundedVnd,
) {
  if (!payment.balancesVerified) return 'needs_reconciliation'
  if (payment.balanceDiscrepancy.unresolvedVnd > 0) return 'needs_review'
  if (
    payment.postDeliveryShortfallVnd > 0 &&
    payment.balanceDiscrepancy.debtVnd > 0
  )
    return 'payment_debt'
  if (
    payment.postDeliveryShortfallVnd > 0 &&
    payment.balanceDiscrepancy.writtenOffVnd > 0
  )
    return 'payment_written_off'
  if (payment.refundDiscrepancy.debtVnd > 0) return 'refund_debt'
  if (payment.refundDiscrepancy.writtenOffVnd > 0) return 'refund_written_off'
  if (payment.latePaymentApprovalRequired)
    return 'awaiting_late_payment_approval'
  if (payment.paidVnd === 0)
    return payment.adjustedTotalVnd === 0 ? 'not_due' : 'unpaid'
  if (refundedVnd - payment.recoveredRefundVnd === payment.paidVnd)
    return 'refunded'
  if (refundedVnd - payment.recoveredRefundVnd > 0) return 'partially_refunded'
  if (payment.overpaidVnd > 0) return 'overpaid'
  if (payment.customerBalanceSettled && payment.returnedGoodsVnd > 0)
    return 'settled_after_return'
  return payment.fullyPaid ? 'paid' : 'partially_paid'
}

export function refundAttemptClosed(
  attempt: typeof refundAttempts.$inferSelect | undefined,
) {
  return (
    !attempt ||
    attempt.status === 'failed' ||
    attempt.status === 'settled' ||
    (attempt.status === 'partially_settled' && attempt.remainderNotSentVerified)
  )
}

// Allocate only verified customer cash above the charge after accepted returns.
// Legacy nominal return refunds can be reduced only when no transfer is unresolved.
export async function reconcileRefundBalance(
  tx: Transaction,
  actor: AuditActor,
  order: Order,
  reason: typeof refunds.$inferInsert.reason = 'overpayment',
  returnId?: string,
) {
  const summary = await paymentSummaryForOrder(tx, order)
  await syncPaymentBalanceReview(tx, actor, order, summary)
  if (!summary.balancesVerified) return
  const obligations = await tx
    .select()
    .from(refunds)
    .where(eq(refunds.orderId, order.id))
    .orderBy(refunds.createdAt, refunds.id)
  const attempts = obligations.length
    ? await tx
        .select()
        .from(refundAttempts)
        .where(
          inArray(
            refundAttempts.refundId,
            obligations.map((refund) => refund.id),
          ),
        )
    : []
  const latestFor = (id: string) =>
    attempts
      .filter((attempt) => attempt.refundId === id)
      .sort((a, b) => b.number - a.number)[0]
  const protectedRefunds = obligations.filter(
    (refund) =>
      refund.status === 'settled' ||
      (refund.status !== 'voided' &&
        !refundAttemptClosed(latestFor(refund.id))),
  )
  let allocatedVnd = sumMoney([
    // Voiding an obligation does not undo cash that actually left the shop.
    // Its net settlements still consume entitlement, but its nominal amount
    // must not reserve an additional transfer.
    ...obligations
      .filter((refund) => refund.status === 'voided')
      .map(
        (refund) => summary.refundBalances.get(refund.id)?.netSettledVnd ?? 0,
      ),
    ...protectedRefunds.map(
      (refund) =>
        Math.max(
          refund.amountVnd,
          summary.refundBalances.get(refund.id)?.settledVnd ?? 0,
        ) - (summary.refundBalances.get(refund.id)?.recoveredVnd ?? 0),
    ),
  ])
  const protectedIds = new Set(protectedRefunds.map((refund) => refund.id))
  for (const refund of obligations) {
    if (refund.status === 'voided' || protectedIds.has(refund.id)) continue
    const settledVnd = summary.refundBalances.get(refund.id)?.settledVnd ?? 0
    const recoveredVnd =
      summary.refundBalances.get(refund.id)?.recoveredVnd ?? 0
    const amountVnd = Math.max(
      Math.min(refund.amountVnd, settledVnd),
      Math.min(
        refund.amountVnd,
        Math.max(0, summary.grossRefundEntitlementVnd - allocatedVnd) +
          recoveredVnd,
      ),
    )
    allocatedVnd += Math.max(amountVnd, settledVnd) - recoveredVnd
    const status =
      amountVnd === 0
        ? 'voided'
        : amountVnd <= settledVnd
          ? 'settled'
          : refund.attemptCount >= MAX_RECOVERY_ATTEMPTS
            ? 'needs_review'
            : settledVnd > 0
              ? 'partially_settled'
              : 'pending'
    if (
      (amountVnd === refund.amountVnd || amountVnd === 0) &&
      status === refund.status
    )
      continue
    const finalReceipt =
      status === 'settled'
        ? summary.settlements
            .filter((receipt) => receipt.refundId === refund.id)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
        : undefined
    await tx
      .update(refunds)
      .set({
        amountVnd: amountVnd || refund.amountVnd,
        originalAmountVnd:
          amountVnd !== refund.amountVnd
            ? (refund.originalAmountVnd ?? refund.amountVnd)
            : refund.originalAmountVnd,
        status,
        settlementMethod: finalReceipt?.method ?? null,
        settlementReference: finalReceipt?.reference ?? null,
        settledAt: finalReceipt?.settledAt ?? null,
        settledBy: finalReceipt?.recordedBy ?? null,
        updatedAt: await databaseNow(tx),
      })
      .where(eq(refunds.id, refund.id))
    await appendOrderEvent(tx, actor, order.id, 'refund_balance_reconciled', {
      refundId: refund.id,
      previousAmountVnd: refund.amountVnd,
      amountVnd,
      settledVnd,
      status,
    })
  }
  let unallocatedVnd = Math.max(
    0,
    summary.grossRefundEntitlementVnd - allocatedVnd,
  )
  while (unallocatedVnd > 0) {
    const amountVnd = Math.min(MAX_VND, unallocatedVnd)
    const [refund] = await tx
      .insert(refunds)
      .values({
        orderId: order.id,
        returnId: returnId ?? null,
        amountVnd,
        reason,
        status: 'pending',
      })
      .returning({ id: refunds.id })
    if (!refund)
      fail(503, 'REFUND_UNAVAILABLE', 'Refund obligation could not be recorded')
    await appendOrderEvent(tx, actor, order.id, 'refund_required', {
      refundId: refund.id,
      amountVnd,
      reason,
      fundingStatus: 'customer_payment_verified',
    })
    unallocatedVnd -= amountVnd
  }
}

export async function refundUnallocatedPayment(
  tx: Transaction,
  actor: AuditActor,
  order: Order,
  reason: 'cancellation' | 'return_to_sender',
) {
  return reconcileRefundBalance(
    tx,
    actor,
    { ...order, status: 'cancelled' },
    reason,
  )
}

export async function refundOverpayment(
  tx: Transaction,
  actor: AuditActor,
  order: Order,
) {
  const summary = await paymentSummaryForOrder(tx, order)
  return reconcileRefundBalance(
    tx,
    actor,
    order,
    summary.returnedGoodsVnd > 0 ? 'return' : 'overpayment',
  )
}

export async function completeDelivery(
  tx: Transaction,
  actor: AuditActor,
  order: Order,
): Promise<void> {
  if (!['delivered', 'completed'].includes(order.status)) return
  const payment = await paymentSummaryForOrder(tx, order)
  await syncPaymentBalanceReview(tx, actor, order, payment)
  if (order.status === 'completed' || !payment.balancesVerified) return
  if (
    payment.customerDecision.unresolvedVnd > 0 ||
    payment.refundDiscrepancy.unresolvedVnd > 0 ||
    payment.carrierDecision.unresolvedVnd > 0 ||
    payment.carrierOverremittedVnd > 0
  )
    return
  const now = await databaseNow(tx)
  await tx
    .update(orders)
    .set({
      status: 'completed',
      completedAt: now,
      updatedAt: now,
      revision: order.revision + 1,
    })
    .where(eq(orders.id, order.id))
  await appendOrderEvent(tx, actor, order.id, 'order_completed', {
    paymentReceivedInFull: payment.fullyPaid,
    collectionResolution: order.collectionResolution,
    carrierAmountDueVnd: payment.carrierAmountDueVnd,
    carrierCollectionResolution: order.carrierCollectionResolution,
  })
}

export async function refreshCodOrderFinancials(
  tx: Transaction,
  actor: AuditActor,
  order: Order,
) {
  const summary = await paymentSummaryForOrder(tx, order)
  const [updated] = await tx
    .update(orders)
    .set({
      collectionResolution: summary.balancesVerified
        ? summary.fullyPaid
          ? 'collected'
          : order.collectionResolution === 'collected'
            ? 'open'
            : order.collectionResolution
        : order.collectionResolution,
      carrierCollectionResolution: summary.balancesVerified
        ? summary.customerPaidToCarrierVnd > 0 &&
          summary.carrierAmountDueVnd === 0
          ? 'collected'
          : order.carrierCollectionResolution === 'collected'
            ? 'open'
            : order.carrierCollectionResolution
        : order.carrierCollectionResolution,
      revision: order.revision + 1,
      updatedAt: await databaseNow(tx),
    })
    .where(eq(orders.id, order.id))
    .returning()
  if (!updated) fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
  await reconcileRefundBalance(
    tx,
    actor,
    updated,
    updated.status === 'cancelled'
      ? 'cancellation'
      : summary.returnedGoodsVnd > 0
        ? 'return'
        : 'overpayment',
  )
  await completeDelivery(tx, actor, updated)
  return summary
}
