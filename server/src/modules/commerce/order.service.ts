import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { env } from '../../config/env.js'
import { orders, returns, roleChanges, user } from '../../db/schema.js'
import { revokeAdminSessions } from '../auth/session-revocation.js'
import { assertBankPaymentApproved } from './bank-payment-policy.js'
import {
  administratorFilter,
  appendOrderEvent,
  assertOrderAccess,
  assertOwnerOrProcessor,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  lockOrder,
  staffUserFilter,
} from './commerce.persistence.js'
import {
  RETURN_WINDOW_MS,
  type Recipient,
  type Role,
} from './commerce.types.js'
import {
  disableStaffOrderSettings,
  lockOrderRouting,
  setOrderAssignee,
} from './order-assignment.service.js'
import { paymentSummaryForOrder } from './payment-ledger.js'
import { assertPendingRefundsKeepChecker } from './refund-policy.js'
import {
  assertReservationActive,
  cancelReservedOrder,
} from './reservation.service.js'

export function assignOrder(
  command: Command,
  orderId: string,
  input: { userId: string; expectedRevision: number; reason: string },
) {
  return executeCommand(
    { ...command, permission: 'admin', roleLock: 'shared' },
    async (tx, actor) => {
      await lockOrderRouting(tx)
      const order = await lockOrder(tx, orderId)
      if (order.deletedAt)
        fail(409, 'ORDER_DELETED', 'Restore the order before assigning it')
      if (order.revision !== input.expectedRevision)
        fail(409, 'ORDER_CHANGED', 'Reload the order before assigning it')
      const [target] = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, input.userId), staffUserFilter()))
        .for('share')
      if (!target)
        fail(
          422,
          'INVALID_ASSIGNEE',
          'Assignee must be an existing staff member or administrator',
        )
      await setOrderAssignee(
        tx,
        actor,
        order,
        input.userId,
        'manual',
        input.reason,
      )
      return { orderId }
    },
  )
}

export function advanceOrder(
  command: Command,
  orderId: string,
  transition: 'confirm' | 'pack',
  expectedRevision: number,
) {
  return executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      assertOrderAccess(actor, order, true)
      if (order.revision !== expectedRevision)
        fail(409, 'ORDER_CHANGED', 'Reload the order before advancing it')
      const expected = transition === 'confirm' ? 'placed' : 'confirmed'
      if (order.status === 'packing') return { orderId }
      if (order.status !== expected)
        fail(409, 'INVALID_ORDER_STATE', `Order must be ${expected}`)
      await assertReservationActive(tx, order)
      if (order.paymentMethod === 'bank_transfer')
        assertBankPaymentApproved(await paymentSummaryForOrder(tx, order))
      const now = await databaseNow(tx)
      await tx
        .update(orders)
        .set({
          status: 'packing',
          reservationExpiresAt:
            transition === 'confirm' && order.paymentMethod === 'cod'
              ? null
              : order.reservationExpiresAt,
          revision: order.revision + 1,
          updatedAt: now,
        })
        .where(eq(orders.id, orderId))
      // Confirmation starts packing in the same transaction. Keep both audit
      // milestones so progress and confirmation undo retain their evidence.
      if (transition === 'confirm')
        await appendOrderEvent(tx, actor, orderId, 'order_confirmed')
      await appendOrderEvent(tx, actor, orderId, 'order_packing')
      return { orderId }
    },
  )
}

export function updateAddress(
  command: Command,
  orderId: string,
  input: { recipient: Recipient; expectedRevision: number },
  staff = false,
) {
  return executeCommand(
    { ...command, permission: staff ? 'staff' : 'signed_in' },
    async (tx, identity) => {
      const actor = staff
        ? identity
        : { ...identity, role: 'customer' as const }
      const order = await lockOrder(tx, orderId)
      assertOwnerOrProcessor(actor, order)
      if (!['placed', 'confirmed'].includes(order.status))
        fail(
          409,
          'ADDRESS_CHANGE_CLOSED',
          'Recipient can only change before packing',
        )
      await assertReservationActive(tx, order)
      if (order.revision !== input.expectedRevision)
        fail(
          409,
          'ORDER_CHANGED',
          'Reload the order before changing its recipient',
        )
      const now = await databaseNow(tx)
      await tx
        .update(orders)
        .set({
          recipient: input.recipient,
          revision: order.revision + 1,
          updatedAt: now,
        })
        .where(eq(orders.id, orderId))
      await appendOrderEvent(tx, actor, orderId, 'recipient_changed', {
        previousRecipient: { ...order.recipient },
        recipient: { ...input.recipient },
      })
      return { orderId }
    },
  )
}

export function cancelOrder(
  command: Command,
  orderId: string,
  reason: string,
  staff = false,
) {
  return executeCommand(
    { ...command, permission: staff ? 'staff' : 'signed_in' },
    async (tx, identity) => {
      const actor = staff
        ? identity
        : { ...identity, role: 'customer' as const }
      const order = await lockOrder(tx, orderId)
      assertOwnerOrProcessor(actor, order)
      if (order.status === 'cancelled') return { orderId }
      if (order.status === 'packing') {
        if (actor.role === 'customer')
          fail(
            409,
            'CUSTOMER_CANCELLATION_CLOSED',
            'Contact staff to cancel an order that is being packed',
          )
        assertOrderAccess(actor, order, true)
      }
      const now = await databaseNow(tx)
      await cancelReservedOrder(tx, actor, order, reason, now)
      return { orderId }
    },
  )
}

export function changeRole(
  command: Command,
  targetUserId: string,
  role: Role,
  reason: string,
) {
  return executeCommand(
    { ...command, permission: 'admin', roleLock: 'exclusive' },
    async (tx, actor) => {
      if (env.ORDER_ADMIN_USER_IDS.includes(targetUserId) && role !== 'admin')
        fail(
          409,
          'BOOTSTRAP_ADMIN_PROTECTED',
          'Remove the protected administrator from server configuration first',
        )
      // Auth holds a shared lock on this row until the session insert commits.
      // This exclusive lock keeps demotion and session revocation indivisible
      // with respect to concurrent sign-ins.
      const [target] = await tx
        .select({ role: user.role })
        .from(user)
        .where(eq(user.id, targetUserId))
        .for('update')
      if (!target) fail(404, 'USER_NOT_FOUND', 'Registered user was not found')
      if (role === 'customer' || role === 'accountant') {
        const now = await databaseNow(tx)
        const [assignment] = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(
            and(
              eq(orders.assignedTo, targetUserId),
              or(
                inArray(orders.status, [
                  'placed',
                  'confirmed',
                  'packing',
                  'shipped',
                  'delivered',
                ]),
                and(
                  eq(orders.status, 'completed'),
                  sql`${orders.deliveredAt} >= ${new Date(now.getTime() - RETURN_WINDOW_MS)}`,
                ),
                sql`exists (select 1 from ${returns} where ${returns.orderId} = ${orders.id} and ${returns.status} in ('requested', 'approved', 'receiving', 'received'))`,
              ),
            ),
          )
          .limit(1)
        if (assignment)
          fail(
            409,
            'ACTIVE_ASSIGNMENTS',
            'Resolve or reassign active work before removing staff access',
          )
      }
      if (target.role === 'admin' && role !== 'admin') {
        const [otherAdministrator] = await tx
          .select({ id: user.id })
          .from(user)
          .where(and(ne(user.id, targetUserId), administratorFilter()))
          .limit(1)
        if (!otherAdministrator)
          fail(409, 'LAST_ADMIN', 'The last administrator cannot be demoted')
        await assertPendingRefundsKeepChecker(tx, targetUserId)
      }
      await tx
        .update(user)
        .set({ role, updatedAt: new Date() })
        .where(eq(user.id, targetUserId))
      if (target.role !== role) {
        await disableStaffOrderSettings(tx, actor, targetUserId, reason)
        await revokeAdminSessions(tx, targetUserId)
      }
      await tx.insert(roleChanges).values({
        actorUserId: actor.userId,
        targetUserId,
        previousRole: target.role,
        newRole: role,
        reason,
      })
      return { userId: targetUserId, role, reason }
    },
  )
}
