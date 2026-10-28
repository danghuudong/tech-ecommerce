import { readFile } from 'node:fs/promises'
import pg from 'pg'
import '../../drizzle.config.js'

type HistoryReport = {
  database: string
  receipts: number
  receiptsWithoutSnapshots: number
  activeBankOrders: number
  activeBankOrdersWithoutWorkMarker: number
  activeOrdersWithHistoryGaps: number
  sampleOrderIdsWithHistoryGaps: string[]
}

async function main() {
  if (process.argv.length > 2)
    throw new Error('Usage: pnpm --filter server run db:assignment:check')
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')
  const target = new URL(connectionString)
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5000,
  })
  try {
    await client.connect()
    await client.query('begin isolation level repeatable read read only')
    await client.query("set local statement_timeout = '30s'")
    const source = await readFile(
      new URL('./order-assignment-history.sql', import.meta.url),
      'utf8',
    )
    const { rows } = await client.query<HistoryReport>(source)
    const report = rows[0]
    if (!report) throw new Error('Assignment history report is unavailable')
    await client.query('commit')
    console.log(
      JSON.stringify(
        { host: target.hostname, port: target.port || '5432', ...report },
        null,
        2,
      ),
    )
    if (report.receiptsWithoutSnapshots || report.activeOrdersWithHistoryGaps) {
      console.error(
        'Receipt history is incomplete. Verify deployment backups, receipt ' +
          'reconciliations and statement evidence before claiming full assignment ' +
          'recovery. Missing work markers can be valid for uninterrupted initial work.',
      )
      process.exitCode = 2
    } else if (!report.receipts) {
      console.log(
        'This database has no receipts. Run this check against the deployment database containing historical payments.',
      )
    } else {
      console.log('Receipt snapshot coverage check passed for this database.')
    }
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Assignment history check failed',
  )
  process.exitCode = 1
})
