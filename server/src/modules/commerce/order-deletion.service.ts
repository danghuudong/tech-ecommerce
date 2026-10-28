import { eq, inArray } from 'drizzle-orm'
import { orders, refundAttempts, refunds, returns } from '../../db/schema.js'
import {
  appendOrderEvent,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  lockOrder,
} from './commerce.persistence.js'
import { orderDeletionBlockReason } from './order-deletion-policy.js'
import { paymentSummaryForOrder } from './payment-ledger.js'

type DeletionInput = { expectedRevision: number; reason: string }

export function deleteOrder(
  command: Command,
  orderId: string,
  input: DeletionInput,
) {
  return executeCommand(
    { ...command, permission: 'admin' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      if (order.revision !== input.expectedRevision)
        fail(409, 'ORDER_CHANGED', 'Reload the order before deleting it')
      if (order.deletedAt)
        return { orderId, deletedAt: order.deletedAt.toISOString() }

      const payment = await paymentSummaryForOrder(tx, order)
      const returnRecords = await tx
        .select({ status: returns.status })
        .from(returns)
        .where(eq(returns.orderId, orderId))
      const refundRecords = await tx
        .select()
        .from(refunds)
        .where(eq(refunds.orderId, orderId))
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
        : []
      const blocked = orderDeletionBlockReason(
        order,
        payment,
        returnRecords,
        refundRecords,
        attempts,
      )
      if (blocked) fail(409, blocked, 'Resolve order work before deleting it')

      const now = await databaseNow(tx)
      await tx
        .update(orders)
        .set({
          deletedAt: now,
          deletedBy: actor.userId,
          deletionReason: input.reason,
          revision: order.revision + 1,
          updatedAt: now,
        })
        .where(eq(orders.id, orderId))
      await appendOrderEvent(tx, actor, orderId, 'order_deleted', {
        reason: input.reason,
      })
      return { orderId, deletedAt: now.toISOString() }
    },
  )
}

export function restoreOrder(
  command: Command,
  orderId: string,
  input: DeletionInput,
) {
  return executeCommand(
    { ...command, permission: 'admin' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      if (order.revision !== input.expectedRevision)
        fail(409, 'ORDER_CHANGED', 'Reload the order before restoring it')
      if (!order.deletedAt) return { orderId, deletedAt: null }
      const now = await databaseNow(tx)
      await tx
        .update(orders)
        .set({
          deletedAt: null,
          deletedBy: null,
          deletionReason: null,
          revision: order.revision + 1,
          updatedAt: now,
        })
        .where(eq(orders.id, orderId))
      await appendOrderEvent(tx, actor, orderId, 'order_restored', {
        reason: input.reason,
        deletedAt: order.deletedAt.toISOString(),
        deletedBy: order.deletedBy,
        deletionReason: order.deletionReason,
      })
      return { orderId, deletedAt: null }
    },
  )
}
