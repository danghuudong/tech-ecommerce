import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../../config/db.js'
import { logger } from '../../config/logger.js'
import { orders } from '../../db/schema.js'
import { databaseNow } from './commerce.persistence.js'
import { expireOrderReservation } from './reservation.service.js'

const POLL_INTERVAL_MS = 60_000
const BATCH_SIZE = 100

function expiredReservationFilter() {
  return and(
    eq(orders.stockState, 'reserved'),
    or(
      inArray(orders.status, ['placed', 'confirmed']),
      and(
        eq(orders.status, 'packing'),
        eq(orders.paymentMethod, 'bank_transfer'),
      ),
    ),
    lte(orders.reservationExpiresAt, sql`clock_timestamp()`),
    or(
      eq(orders.paymentMethod, 'cod'),
      isNull(orders.paymentReviewRequiredAt),
      and(
        isNull(orders.paymentReviewEscalatedAt),
        lte(orders.paymentReviewDueAt, sql`clock_timestamp()`),
      ),
    ),
  )
}

async function findExpiredReservations() {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '15s'`)
    return tx
      .select({ id: orders.id })
      .from(orders)
      .where(expiredReservationFilter())
      .orderBy(orders.reservationExpiresAt, orders.id)
      .limit(BATCH_SIZE)
  })
}

async function expireReservation(orderId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`)
    await tx.execute(sql`set local statement_timeout = '15s'`)
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), expiredReservationFilter()))
      .for('update', { skipLocked: true })
    if (!order) return false
    const updated = await expireOrderReservation(
      tx,
      order,
      await databaseNow(tx),
    )
    if (!order.paymentReviewEscalatedAt && updated.paymentReviewEscalatedAt)
      logger.warn(
        {
          orderId,
          dueAt: updated.paymentReviewDueAt,
          assignedTo: order.assignedTo,
        },
        'Bank reconciliation SLA exceeded; administrator review required and stock remains held',
      )
    return true
  })
}

export function startReservationExpiryWorker() {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let currentRun: Promise<void>

  async function tick() {
    let nextDelayMs = POLL_INTERVAL_MS
    try {
      const candidates = await findExpiredReservations()
      let processed = 0
      for (const candidate of candidates) {
        if (stopped) break
        try {
          if (await expireReservation(candidate.id)) processed += 1
        } catch (err) {
          logger.error(
            { err, orderId: candidate.id },
            'Reservation expiry will be retried',
          )
        }
      }
      if (processed === BATCH_SIZE) nextDelayMs = 1000
      if (processed > 0)
        logger.info({ processed }, 'Expired order reservations reconciled')
    } catch (err) {
      logger.error(
        { err },
        'Reservation expiry failed; durable deadlines will be retried',
      )
    } finally {
      if (!stopped)
        timer = setTimeout(() => {
          currentRun = tick()
        }, nextDelayMs).unref()
    }
  }

  currentRun = tick()
  return async () => {
    stopped = true
    if (timer) clearTimeout(timer)
    await currentRun
  }
}
