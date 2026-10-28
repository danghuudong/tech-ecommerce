import { createHash } from 'node:crypto'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { db } from '../../config/db.js'
import { env } from '../../config/env.js'
import {
  commands,
  orderEvents,
  orderItems,
  orders,
  user,
} from '../../db/schema.js'
import { AppError } from '../../middlewares/error.middleware.js'
import type {
  Actor,
  AuditActor,
  CommandResult,
  Role,
} from './commerce.types.js'

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type Order = typeof orders.$inferSelect
export type OrderItem = typeof orderItems.$inferSelect
export type Permission =
  | 'signed_in'
  | 'workforce'
  | 'staff'
  | 'accountant'
  | 'admin'
export type Command = {
  userId: string
  key: string
  scope: string
  payload: unknown
  permission?: Permission
  roleLock?: 'shared' | 'exclusive'
}

export function fail(status: number, code: string, message: string): never {
  throw new AppError(status, code, message)
}

export function staffUserFilter() {
  return or(
    inArray(user.role, ['staff', 'admin']),
    env.ORDER_ADMIN_USER_IDS.length
      ? inArray(user.id, env.ORDER_ADMIN_USER_IDS)
      : undefined,
  )
}

export function administratorFilter() {
  return or(
    eq(user.role, 'admin'),
    env.ORDER_ADMIN_USER_IDS.length
      ? inArray(user.id, env.ORDER_ADMIN_USER_IDS)
      : undefined,
  )
}

export async function resolveActor(
  tx: Transaction,
  userId: string,
  permission: Permission = 'signed_in',
  lock = false,
): Promise<Actor> {
  const query = tx
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(eq(user.id, userId))
  const [record] = await (lock ? query.for('share') : query)
  if (!record) fail(401, 'UNAUTHORIZED', 'Authentication required')
  const role: Role = env.ORDER_ADMIN_USER_IDS.includes(record.id)
    ? 'admin'
    : record.role
  if (permission === 'admin' && role !== 'admin') {
    const [administrator] = await tx
      .select({ id: user.id })
      .from(user)
      .where(administratorFilter())
      .limit(1)
    if (!administrator)
      fail(
        503,
        'ADMIN_NOT_CONFIGURED',
        'Register an account and configure its ID in ORDER_ADMIN_USER_IDS to bootstrap administration',
      )
    fail(403, 'ADMIN_ACCESS_REQUIRED', 'Administrator access is required')
  }
  if (permission === 'workforce' && role === 'customer')
    fail(403, 'WORKFORCE_ACCESS_REQUIRED', 'Workforce access is required')
  if (permission === 'staff' && role !== 'staff' && role !== 'admin')
    fail(403, 'STAFF_ACCESS_REQUIRED', 'Staff access is required')
  if (permission === 'accountant' && role !== 'accountant' && role !== 'admin')
    fail(403, 'ACCOUNTANT_ACCESS_REQUIRED', 'Accountant access is required')
  return { userId: record.id, role }
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    )
  }
  return value
}

export async function executeCommand<T extends CommandResult>(
  command: Command,
  run: (tx: Transaction, actor: Actor) => Promise<T>,
): Promise<CommandResult> {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(canonical(command.payload)))
    .digest('hex')
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`)
    await tx.execute(sql`set local statement_timeout = '15s'`)
    if (command.roleLock === 'exclusive' || command.scope.startsWith('roles:'))
      await tx.execute(sql`select pg_advisory_xact_lock(7348021)`)
    else if (command.roleLock === 'shared')
      await tx.execute(sql`select pg_advisory_xact_lock_shared(7348021)`)
    const actor = await resolveActor(
      tx,
      command.userId,
      command.permission,
      true,
    )
    await tx
      .insert(commands)
      .values({
        userId: actor.userId,
        scope: command.scope,
        key: command.key,
        fingerprint,
      })
      .onConflictDoNothing()
    const [record] = await tx
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.userId, actor.userId),
          eq(commands.scope, command.scope),
          eq(commands.key, command.key),
        ),
      )
      .for('update')
    if (!record)
      fail(503, 'COMMAND_UNAVAILABLE', 'Retry with the same Idempotency-Key')
    if (record.fingerprint !== fingerprint)
      fail(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This Idempotency-Key was used with different input',
      )
    if (record.result) return record.result
    const result = await run(tx, actor)
    await tx.update(commands).set({ result }).where(eq(commands.id, record.id))
    return result
  })
}

export async function databaseNow(tx: Transaction): Promise<Date> {
  const result = await tx.execute<{ now: string | Date }>(
    sql`select clock_timestamp() as now`,
  )
  const row = result.rows[0]
  if (!row) fail(503, 'CLOCK_UNAVAILABLE', 'Database clock is unavailable')
  return new Date(row.now)
}

export async function lockOrder(
  tx: Transaction,
  orderId: string,
): Promise<Order> {
  const [order] = await tx
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .for('update')
  if (!order) fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
  return order
}

export function assertOrderAccess(
  actor: Actor,
  order: Order,
  processing = false,
): void {
  if (!processing && actor.role === 'customer' && order.userId === actor.userId)
    return
  if (actor.role === 'customer') {
    if (order.userId !== actor.userId || processing)
      fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
    return
  }
  assertOrderWorkAccess(actor, order, processing)
}

export function assertOrderWorkAccess(
  actor: Actor,
  order: Order,
  requireAssignment = true,
): void {
  if (
    actor.role === 'customer' ||
    (requireAssignment && actor.role === 'accountant')
  )
    fail(403, 'STAFF_ACCESS_REQUIRED', 'Staff access is required')
  if (actor.role === 'staff' && order.assignedTo !== actor.userId)
    fail(
      403,
      'ORDER_ASSIGNED_ELSEWHERE',
      'Order is assigned to another staff member',
    )
  if (requireAssignment && order.assignedTo === null)
    fail(409, 'ASSIGNMENT_REQUIRED', 'Assign the order before processing it')
}

export function assertOwnerOrProcessor(actor: Actor, order: Order): void {
  if (order.userId === actor.userId) return
  assertOrderAccess(actor, order, true)
}

export async function getOrderItems(
  tx: Transaction,
  orderId: string,
): Promise<OrderItem[]> {
  return tx
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.productId)
}

export async function appendOrderEvent(
  tx: Transaction,
  actor: AuditActor,
  orderId: string,
  type: string,
  details: CommandResult = {},
): Promise<void> {
  await tx.insert(orderEvents).values({
    orderId,
    actorUserId: actor.userId,
    actorType: actor.role === 'system' ? 'system' : 'user',
    type,
    details: { ...details, actorRole: actor.role },
  })
}

export function assertOccurredAt(value: Date, earliest: Date, now: Date): void {
  if (value < earliest || value > now)
    fail(
      422,
      'INVALID_OCCURRENCE_TIME',
      'Occurrence time must be between the relevant operation and the database clock',
    )
}
