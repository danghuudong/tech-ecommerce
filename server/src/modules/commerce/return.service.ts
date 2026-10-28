import { and, eq, inArray } from 'drizzle-orm'
import {
  orders,
  returnLines,
  returnReceipts,
  returns,
} from '../../db/schema.js'
import {
  appendOrderEvent,
  assertOrderAccess,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  getOrderItems,
  lockOrder,
  type Transaction,
} from './commerce.persistence.js'
import { RETURN_WINDOW_MS, type ReceiptLine } from './commerce.types.js'
import { changeStock } from './inventory.service.js'
import { activeReturnStatuses } from './order-assignment-policy.js'
import {
  completeDelivery,
  paymentSummaryForOrder,
  reconcileRefundBalance,
} from './payment-ledger.js'

export async function returnAllocations(tx: Transaction, orderId: string) {
  const rows = await tx
    .select({ line: returnLines, status: returns.status })
    .from(returnLines)
    .innerJoin(returns, eq(returns.id, returnLines.returnId))
    .where(
      and(
        eq(returns.orderId, orderId),
        inArray(returns.status, [
          'requested',
          'approved',
          'receiving',
          'received',
          'closed',
        ]),
      ),
    )
  const allocations = new Map<string, number>()
  for (const { line, status } of rows)
    allocations.set(
      line.orderItemId,
      (allocations.get(line.orderItemId) ?? 0) +
        (status === 'closed' ? line.receivedQuantity : line.quantity),
    )
  return allocations
}

async function lockReturnOrder(tx: Transaction, returnId: string) {
  const [metadata] = await tx
    .select({ orderId: returns.orderId })
    .from(returns)
    .where(eq(returns.id, returnId))
  if (!metadata) fail(404, 'RETURN_NOT_FOUND', 'Return request was not found')
  const order = await lockOrder(tx, metadata.orderId)
  const [request] = await tx
    .select()
    .from(returns)
    .where(eq(returns.id, returnId))
    .for('update')
  if (!request) fail(404, 'RETURN_NOT_FOUND', 'Return request was not found')
  return { order, request }
}

export function requestReturn(
  command: Command,
  orderId: string,
  input: { reason: string; items: { orderItemId: string; quantity: number }[] },
) {
  return executeCommand(command, async (tx, actor) => {
    const order = await lockOrder(tx, orderId)
    if (order.userId !== actor.userId)
      fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
    const now = await databaseNow(tx)
    if (
      !['delivered', 'completed'].includes(order.status) ||
      !order.deliveredAt
    )
      fail(
        409,
        'RETURN_NOT_ELIGIBLE',
        'Return requires an acknowledged delivery',
      )
    if (now.getTime() > order.deliveredAt.getTime() + RETURN_WINDOW_MS)
      fail(
        409,
        'RETURN_WINDOW_CLOSED',
        'The seven-day return window has closed',
      )
    const items = await getOrderItems(tx, orderId)
    const allocated = await returnAllocations(tx, orderId)
    for (const line of input.items) {
      const item = items.find((record) => record.id === line.orderItemId)
      if (
        !item ||
        line.quantity > item.quantity - (allocated.get(item.id) ?? 0)
      )
        fail(
          422,
          'RETURN_QUANTITY_EXCEEDED',
          'Requested quantity exceeds the remaining returnable quantity',
        )
    }
    const [ongoingWork] = await tx
      .select({ id: returns.id })
      .from(returns)
      .where(
        and(
          eq(returns.orderId, orderId),
          inArray(returns.status, activeReturnStatuses),
        ),
      )
      .limit(1)
    const [request] = await tx
      .insert(returns)
      .values({ orderId, userId: actor.userId, reason: input.reason })
      .returning({ id: returns.id, createdAt: returns.createdAt })
    if (!request)
      fail(503, 'RETURN_UNAVAILABLE', 'Return request could not be recorded')
    await tx
      .insert(returnLines)
      .values(input.items.map((line) => ({ returnId: request.id, ...line })))
    if (!ongoingWork)
      await tx
        .update(orders)
        .set({
          staffWorkStartedAt: request.createdAt,
          revision: order.revision + 1,
          updatedAt: request.createdAt,
        })
        .where(eq(orders.id, orderId))
    await appendOrderEvent(tx, actor, orderId, 'return_requested', {
      returnId: request.id,
      reason: input.reason,
      items: input.items.map((line) => ({ ...line })),
    })
    return { orderId, returnId: request.id }
  })
}

export function decideReturn(
  command: Command,
  returnId: string,
  decision: 'approve' | 'reject' | 'close',
  reason: string,
  responsibility?: 'customer' | 'store' | 'carrier',
) {
  return executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      const { order, request } = await lockReturnOrder(tx, returnId)
      assertOrderAccess(actor, order, true)
      if (decision === 'approve' && !responsibility)
        fail(
          422,
          'RETURN_RESPONSIBILITY_REQUIRED',
          'Classify responsibility before approving a return',
        )
      const lines = await tx
        .select()
        .from(returnLines)
        .where(eq(returnLines.returnId, returnId))
      if (decision === 'approve' && request.status !== 'requested')
        fail(
          409,
          'INVALID_RETURN_STATE',
          'Only a requested return can be approved',
        )
      if (
        decision === 'reject' &&
        (!['requested', 'approved'].includes(request.status) ||
          lines.some((line) => line.receivedQuantity > 0))
      )
        fail(
          409,
          'INVALID_RETURN_STATE',
          'Received goods cannot be rejected or erased',
        )
      if (
        decision === 'close' &&
        !['approved', 'receiving', 'received'].includes(request.status)
      )
        fail(
          409,
          'INVALID_RETURN_STATE',
          'Only an approved or received return can be closed',
        )
      const status =
        decision === 'approve'
          ? 'approved'
          : decision === 'reject'
            ? 'rejected'
            : 'closed'
      await tx
        .update(returns)
        .set({
          status,
          decisionReason: reason,
          responsibility:
            decision === 'approve' ? responsibility : request.responsibility,
          decidedBy: actor.userId,
          updatedAt: await databaseNow(tx),
        })
        .where(eq(returns.id, returnId))
      await appendOrderEvent(tx, actor, order.id, `return_${status}`, {
        returnId,
        reason,
        responsibility:
          decision === 'approve'
            ? (responsibility ?? null)
            : request.responsibility,
      })
      return { orderId: order.id, returnId }
    },
  )
}

export function withdrawReturn(
  command: Command,
  returnId: string,
  reason: string,
) {
  return executeCommand(command, async (tx, actor) => {
    const { order, request } = await lockReturnOrder(tx, returnId)
    if (request.userId !== actor.userId)
      fail(404, 'RETURN_NOT_FOUND', 'Return request was not found')
    if (!['requested', 'approved'].includes(request.status))
      fail(
        409,
        'INVALID_RETURN_STATE',
        'Return cannot be withdrawn after receipt begins',
      )
    await tx
      .update(returns)
      .set({
        status: 'withdrawn',
        decisionReason: reason,
        decidedBy: actor.userId,
        updatedAt: await databaseNow(tx),
      })
      .where(eq(returns.id, returnId))
    await appendOrderEvent(tx, actor, order.id, 'return_withdrawn', {
      returnId,
      reason,
    })
    return { orderId: order.id, returnId }
  })
}

export async function receiveReturn(
  command: Command,
  returnId: string,
  input: { proofReference: string; items: ReceiptLine[] },
) {
  const result = await executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      const { order, request } = await lockReturnOrder(tx, returnId)
      assertOrderAccess(actor, order, true)
      const [existing] = await tx
        .select()
        .from(returnReceipts)
        .where(eq(returnReceipts.proofReference, input.proofReference))
      if (existing) {
        const matches =
          existing.returnId === returnId &&
          existing.items.length === input.items.length &&
          existing.items.every((item) =>
            input.items.some(
              (line) =>
                line.orderItemId === item.orderItemId &&
                line.quantity === item.quantity &&
                line.resellableQuantity === item.resellableQuantity,
            ),
          )
        if (!matches)
          fail(
            409,
            'RECEIPT_REFERENCE_CONFLICT',
            'Receipt reference was used for different goods',
          )
        const balance = await paymentSummaryForOrder(tx, order)
        return {
          orderId: order.id,
          returnId,
          receiptId: existing.id,
          balancesVerified: balance.balancesVerified,
          amountDueVnd: balance.balancesVerified ? balance.amountDueVnd : null,
          refundDueVnd: balance.balancesVerified ? balance.refundDueVnd : null,
        }
      }
      if (!['approved', 'receiving'].includes(request.status))
        fail(
          409,
          'INVALID_RETURN_STATE',
          'Return must be approved before receiving goods',
        )
      const lines = await tx
        .select()
        .from(returnLines)
        .where(eq(returnLines.returnId, returnId))
      const items = await getOrderItems(tx, order.id)
      let goodsCreditVnd = 0
      for (const received of input.items) {
        const line = lines.find(
          (record) => record.orderItemId === received.orderItemId,
        )
        const item = items.find((record) => record.id === received.orderItemId)
        if (
          !line ||
          !item ||
          received.quantity > line.quantity - line.receivedQuantity
        )
          fail(
            422,
            'RETURN_RECEIPT_EXCEEDED',
            'Received quantity exceeds the approved outstanding quantity',
          )
        goodsCreditVnd += item.unitPriceVnd * received.quantity
      }
      const [receipt] = await tx
        .insert(returnReceipts)
        .values({
          returnId,
          proofReference: input.proofReference,
          items: input.items,
          recordedBy: actor.userId,
        })
        .returning({ id: returnReceipts.id })
      if (!receipt)
        fail(503, 'RECEIPT_UNAVAILABLE', 'Return receipt could not be recorded')
      for (const item of items) {
        const received = input.items.find(
          (record) => record.orderItemId === item.id,
        )
        if (!received) continue
        const line = lines.find((record) => record.orderItemId === item.id)
        if (!line)
          fail(
            422,
            'RETURN_ITEM_MISMATCH',
            'Received item is not part of the return',
          )
        await tx
          .update(returnLines)
          .set({
            receivedQuantity: line.receivedQuantity + received.quantity,
            restockedQuantity:
              line.restockedQuantity + received.resellableQuantity,
          })
          .where(eq(returnLines.id, line.id))
        if (received.resellableQuantity > 0)
          await changeStock(tx, actor, {
            productId: item.productId,
            orderId: order.id,
            kind: 'return',
            onHandDelta: received.resellableQuantity,
            reservedDelta: 0,
            reason: 'Actual returned goods received',
            reference: `${receipt.id}:${item.id}`,
          })
      }
      const allReceived = lines.every(
        (line) =>
          line.receivedQuantity +
            (input.items.find((item) => item.orderItemId === line.orderItemId)
              ?.quantity ?? 0) ===
          line.quantity,
      )
      await tx
        .update(returns)
        .set({
          status: allReceived ? 'received' : 'receiving',
          updatedAt: await databaseNow(tx),
        })
        .where(eq(returns.id, returnId))
      await reconcileRefundBalance(tx, actor, order, 'return', returnId)
      await appendOrderEvent(tx, actor, order.id, 'return_goods_received', {
        returnId,
        receiptId: receipt.id,
        goodsCreditVnd,
        responsibility: request.responsibility,
        items: input.items.map((line) => ({ ...line })),
      })
      const balance = await paymentSummaryForOrder(tx, order)
      const [updated] = await tx
        .update(orders)
        .set({
          revision: order.revision + 1,
          updatedAt: await databaseNow(tx),
        })
        .where(eq(orders.id, order.id))
        .returning()
      if (!updated) fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
      await completeDelivery(tx, actor, updated)
      return {
        orderId: order.id,
        returnId,
        receiptId: receipt.id,
        goodsCreditVnd,
        shippingCreditVnd: balance.shippingCreditVnd,
        balancesVerified: balance.balancesVerified,
        amountDueVnd: balance.balancesVerified ? balance.amountDueVnd : null,
        refundDueVnd: balance.balancesVerified ? balance.refundDueVnd : null,
      }
    },
  )
  // Historic idempotency results lack a verification flag. Their cached balances
  // cannot be asserted after a financial reconciliation migration.
  return {
    ...result,
    balancesVerified: result.balancesVerified === true,
    amountDueVnd:
      result.balancesVerified === true ? (result.amountDueVnd ?? null) : null,
    refundDueVnd:
      result.balancesVerified === true ? (result.refundDueVnd ?? null) : null,
  }
}
