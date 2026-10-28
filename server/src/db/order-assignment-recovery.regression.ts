import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { pool } from '../config/db.js'
import { env } from '../config/env.js'
import {
  handoverWorkFilter,
  rebalanceWorkFilter,
} from '../modules/commerce/order-assignment-policy.js'
import { orders } from './schema.js'

// Database-only regression checks. Shadow every referenced table with a temporary
// copy, replay the real migration SQL, query the real routing predicates, then
// roll back even on success. No application or worker is started.
async function main() {
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  })
  let assertions = 0
  const check = (label: string, actual: unknown, expected: unknown) => {
    assert.deepEqual(actual, expected, label)
    assertions += 1
  }
  try {
    await client.connect()
    await client.query('begin')
    await client.query("set local statement_timeout = '30s'")
    await client.query("set local lock_timeout = '3s'")
    await client.query('set local search_path = pg_temp, public')
    const tables = [
      'user',
      'orders',
      'staff_order_settings',
      'staff_order_setting_changes',
      'commerce_order_events',
      'commerce_role_changes',
      'commerce_payments',
      'commerce_payment_allocations',
      'commerce_payment_allocation_adjustments',
      'commerce_refunds',
      'commerce_refund_settlements',
      'commerce_payment_balance_reviews',
      'commerce_payment_balance_review_decisions',
      'commerce_returns',
      'commerce_shipments',
    ]
    for (const table of tables)
      await client.query(
        `create temporary table "${table}" (like public."${table}" including defaults) on commit drop`,
      )
    // Rewind only the columns introduced by 0019/0020 in the temporary copies.
    await client.query(`
      alter table staff_order_settings drop column shift_ends_at,
        drop column unavailable_since, drop column capacity_changed_at;
      alter table staff_order_setting_changes drop column actor_type;
      alter table orders drop column staff_work_started_at;
    `)
    const { rows: clock } = await client.query<{ now: Date }>(
      'select clock_timestamp() as now',
    )
    const now = clock[0]?.now
    assert(now)
    const base = now.getTime() - 6 * 60 * 60_000
    const at = (minute: number) =>
      new Date(base + minute * 60_000).toISOString()
    const database = drizzle(client)
    const migrate = async (name: string) => {
      const source = await readFile(
        new URL(`../../drizzle/${name}.sql`, import.meta.url),
        'utf8',
      )
      await client.query(source)
    }
    const event = async (
      orderId: string,
      type: string,
      minute: number,
      details: Record<string, unknown> = {},
    ) => {
      await client.query(
        `insert into commerce_order_events
          (order_id, actor_user_id, type, details, created_at)
         values ($1, 'regression-admin', $2, $3, $4)`,
        [orderId, type, details, at(minute)],
      )
    }
    const settingsChange = async (
      staff: string,
      minute: number,
      previous: Record<string, unknown>,
      next: Record<string, unknown>,
    ) => {
      await client.query(
        `insert into staff_order_setting_changes
          (target_user_id, actor_user_id, previous_value, new_value, reason, created_at)
         values ($1, 'regression-admin', $2, $3, 'Regression fixture', $4)`,
        [staff, previous, next, at(minute)],
      )
    }
    const createStaff = async (staff: string, enrollment = 30) => {
      await client.query(
        `insert into "user" (id, name, email, role) values ($1, $1, $1 || '@regression.invalid', 'staff');`,
        [staff],
      )
      await client.query(
        `insert into staff_order_settings
          (user_id, enabled, max_active_orders, updated_by, updated_at)
         values ($1, true, 1, 'regression-admin', $2)`,
        [staff, at(40)],
      )
      await settingsChange(
        staff,
        enrollment,
        { enabled: false, acceptingOrders: false },
        { enabled: true, acceptingOrders: false },
      )
      await settingsChange(
        staff,
        40,
        { enabled: true, acceptingOrders: false, maxActiveOrders: 20 },
        { enabled: true, acceptingOrders: false, maxActiveOrders: 1 },
      )
    }
    const roleCycle = async (staff: string, exit = 10, returned = 20) => {
      await client.query(
        `insert into commerce_role_changes
          (actor_user_id, target_user_id, previous_role, new_role, reason, created_at)
         values ('regression-admin', $1, 'staff', 'admin', 'Regression exit', $2),
           ('regression-admin', $1, 'admin', 'staff', 'Regression return', $3)`,
        [staff, at(exit), at(returned)],
      )
    }
    const createOrder = async (
      staff: string,
      method: 'cod' | 'bank_transfer' = 'cod',
      assigned = 35,
    ) => {
      const id = randomUUID()
      await client.query(
        `insert into orders (id, user_id, quote_id, payment_method, subtotal_vnd,
          shipping_fee_vnd, total_vnd, recipient, bank_instructions,
          assigned_to, assigned_at, assignment_source, payment_deadline_at, created_at)
         values ($1, 'regression-customer', $2, $3, 100, 0, 100, '{}', '{}',
           $4, $5, 'manual', $6, $7)`,
        [id, randomUUID(), method, staff, at(assigned), at(30), at(0)],
      )
      return id
    }
    const routing = async (id: string) => {
      const [row] = await database
        .select({
          needsHandover: sql<boolean>`coalesce(${handoverWorkFilter(now)}, false)`,
          needsRebalance: sql<boolean>`coalesce(${rebalanceWorkFilter(now)}, false)`,
        })
        .from(orders)
        .where(eq(orders.id, id))
      assert(row)
      return row
    }
    const marker = async (id: string) => {
      const { rows } = await client.query<{
        started: Date | null
        revision: number
      }>(
        'select staff_work_started_at as started, revision from orders where id = $1',
        [id],
      )
      const row = rows[0]
      assert(row)
      return {
        started: row.started?.toISOString() ?? null,
        revision: row.revision,
      }
    }
    const stopped = async (staff: string) => {
      const { rows } = await client.query<{ stopped: Date | null }>(
        'select unavailable_since as stopped from staff_order_settings where user_id = $1',
        [staff],
      )
      return rows[0]?.stopped?.toISOString() ?? null
    }

    const staffCases = [
      'old-role',
      'real-role',
      'real-shift',
      'moved-auto',
      'current-auto',
      'never-started',
      'unknown-enrollment',
    ]
    for (const staff of staffCases) {
      await createStaff(staff)
      if (staff !== 'never-started') await roleCycle(staff)
    }
    const manual = await createOrder('old-role')
    const realRoleBefore = await createOrder('real-role')
    const realRoleAfter = await createOrder('real-role', 'cod', 70)
    await roleCycle('real-role', 50, 60)
    const realShift = await createOrder('real-shift')
    const movedAuto = await createOrder('moved-auto')
    await event(movedAuto, 'order_assigned', 32, {
      assignedTo: 'moved-auto',
      source: 'automatic',
    })
    const currentAuto = await createOrder('current-auto')
    await client.query(
      "update orders set assignment_source = 'automatic' where id = $1",
      [currentAuto],
    )
    await client.query(
      "delete from staff_order_setting_changes where target_user_id = 'unknown-enrollment'",
    )

    await migrate('0019_assignment_workload_and_shifts')
    await migrate('0020_assignment_recovery_and_rebalance')
    await client.query(
      `update staff_order_settings set unavailable_since = $1 where user_id = 'real-role'`,
      [at(50)],
    )
    await settingsChange(
      'real-shift',
      25,
      { enabled: true, acceptingOrders: false },
      { enabled: true, acceptingOrders: true },
    )
    await settingsChange(
      'real-shift',
      40,
      { enabled: true, acceptingOrders: true },
      { enabled: true, acceptingOrders: false },
    )

    type ReceiptCase = {
      name: string
      gap?: 'missing' | 'filled-later' | 'baseline-only' | 'history-only'
      live?: boolean
      gapAfterMarker?: boolean
    }
    const receiptCases: ReceiptCase[] = [
      { name: 'missing', gap: 'missing' },
      { name: 'filled-later', gap: 'filled-later' },
      { name: 'baseline-only', gap: 'baseline-only' },
      { name: 'history-only', gap: 'history-only' },
      { name: 'live-later', gap: 'missing', live: true },
      { name: 'valid' },
      { name: 'gap-after-marker', gapAfterMarker: true },
    ]
    const snapshot = async (
      receipt: string,
      orderId: string,
      minute: number,
    ) => {
      await client.query(
        `insert into commerce_payment_allocation_adjustments
          (payment_id, evidence_reference, reason, "before", "after", decided_by, created_at)
         values ($1::uuid, $1::text, 'Regression snapshot', '{"allocations":[]}', $2, 'regression-admin', $3)`,
        [
          receipt,
          {
            receiptRevision: 1,
            source: 'customer',
            duplicateOfId: null,
            receiptReconciliationRequired: false,
            receivedAt: at(10),
            allocations: [{ orderId, amountVnd: 100, purpose: 'payment' }],
          },
          at(minute),
        ],
      )
    }
    const receipt = async (orderId: string, minute: number) => {
      const id = randomUUID()
      await client.query(
        `insert into commerce_payments
          (id, order_id, method, source, reference, amount_vnd, received_at, recorded_by, created_at)
         values ($1::uuid, $2, 'bank_transfer', 'customer', $1::text, 100, $3, 'regression-admin', $4)`,
        [id, orderId, at(10), at(minute)],
      )
      return id
    }
    const receiptOrders = new Map<string, string>()
    for (const scenario of receiptCases) {
      const staff = `payment-${scenario.name}`
      await createStaff(staff)
      await client.query(
        `update staff_order_settings set accepting_orders = true,
          shift_ends_at = $1, unavailable_since = null where user_id = $2`,
        [new Date(now.getTime() + 60 * 60_000), staff],
      )
      await settingsChange(
        staff,
        45,
        { enabled: true, acceptingOrders: false },
        { enabled: true, acceptingOrders: true },
      )
      await createOrder(staff, 'cod', 1)
      const orderId = await createOrder(staff, 'bank_transfer', 5)
      receiptOrders.set(scenario.name, orderId)
      if (scenario.gap) {
        const old = await receipt(orderId, 10)
        await event(orderId, 'payment_received', 11)
        if (scenario.gap !== 'baseline-only')
          await client.query(
            `insert into commerce_payment_allocations (payment_id, order_id, amount_vnd)
             values ($1, $2, 100)`,
            [old, orderId],
          )
        if (scenario.gap === 'filled-later') await snapshot(old, orderId, 45)
        if (scenario.gap === 'history-only') {
          await snapshot(old, orderId, 90)
          await client.query(
            'update commerce_payments set order_id = $1 where id = $2',
            [randomUUID(), old],
          )
          await client.query(
            'delete from commerce_payment_allocations where payment_id = $1',
            [old],
          )
        }
      }
      const verified = await receipt(orderId, 60)
      await snapshot(verified, orderId, 60)
      await event(orderId, 'merchant_receipt_reconciled', 61)
      if (scenario.gapAfterMarker) {
        await receipt(orderId, 90)
        await event(orderId, 'payment_received', 91)
      }
    }
    await migrate('0021_assignment_history_recovery')
    await migrate('0022_historical_assignment_timestamps')
    await migrate('0023_assignment_approval_and_enrollment_recovery')

    check(
      'old role exit reproduces false handover after 0023',
      (await routing(manual)).needsHandover,
      true,
    )
    const preserved = new Map<string, Awaited<ReturnType<typeof marker>>>()
    for (const scenario of receiptCases) {
      const id = receiptOrders.get(scenario.name)
      assert(id)
      check(
        `${scenario.name}: 0022 wrote a recovered marker`,
        (await marker(id)).started,
        at(61),
      )
      check(
        `${scenario.name}: recovered work exceeds capacity`,
        (await routing(id)).needsRebalance,
        true,
      )
      if (scenario.live) {
        await client.query(
          'update orders set staff_work_started_at = $1 where id = $2',
          [at(120), id],
        )
        await event(id, 'payment_deadline_satisfied', 120)
      }
      if (!scenario.gap || scenario.live) preserved.set(id, await marker(id))
    }

    await migrate('0024_assignment_marker_provenance')
    check(
      'unrelated old role exit no longer protects synthetic stop',
      await stopped('old-role'),
      null,
    )
    check(
      'manual work is not handed over after recovery',
      (await routing(manual)).needsHandover,
      false,
    )
    check('real role stop is preserved', await stopped('real-role'), at(50))
    check(
      'work assigned before real role stop is handed over',
      (await routing(realRoleBefore)).needsHandover,
      true,
    )
    check(
      'manual override after real role stop stays assigned',
      (await routing(realRoleAfter)).needsHandover,
      false,
    )
    check('real shift stop is preserved', await stopped('real-shift'), at(40))
    check(
      'real shift still hands over work',
      (await routing(realShift)).needsHandover,
      true,
    )
    check(
      'historical automatic participation is preserved',
      await stopped('moved-auto'),
      at(40),
    )
    check(
      'current automatic participation is preserved',
      await stopped('current-auto'),
      at(40),
    )
    check(
      'never-started staff stays without a stop marker',
      await stopped('never-started'),
      null,
    )
    check(
      'missing enrollment evidence is preserved conservatively',
      await stopped('unknown-enrollment'),
      at(40),
    )
    for (const scenario of receiptCases) {
      const id = receiptOrders.get(scenario.name)
      assert(id)
      if (scenario.gap && !scenario.live) {
        check(
          `${scenario.name}: unproven historical marker removed`,
          (await marker(id)).started,
          null,
        )
        check(
          `${scenario.name}: continuous work is not rebalanced`,
          (await routing(id)).needsRebalance,
          false,
        )
      } else {
        check(
          `${scenario.name}: valid or later live marker is untouched`,
          await marker(id),
          preserved.get(id),
        )
        check(
          `${scenario.name}: real reopened work still rebalances`,
          (await routing(id)).needsRebalance,
          true,
        )
      }
    }
    const audit = async () => {
      const { rows } = await client.query(`select
        (select count(*)::int from commerce_order_events
          where type = 'staff_work_started_at_recovery_invalidated') as work,
        (select count(*)::int from staff_order_setting_changes
          where new_value -> 'unavailableSince' = 'null'::jsonb) as settings`)
      return rows[0]
    }
    const once = await audit()
    check('each invalid work marker has an audit event', once?.work, 4)
    await migrate('0024_assignment_marker_provenance')
    check(
      'repair is idempotent and does not duplicate audits',
      await audit(),
      once,
    )
  } finally {
    try {
      await client.query('rollback')
    } finally {
      await client.end()
      await pool.end()
    }
  }
  console.log(
    `${assertions} assignment recovery database assertions passed; transaction rolled back.`,
  )
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.stack
      : 'Assignment recovery regression failed',
  )
  process.exitCode = 1
})
