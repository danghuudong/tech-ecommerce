import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import config from '../../drizzle.config.js'
import {
  applyCatalogClassification,
  checkCatalogClassification,
  classificationPlanSchema,
  classificationTarget,
  finalizeCatalogClassification,
} from './catalog-classification.js'
import {
  catalogPrerequisitesAreReady,
  prepareCatalogPrerequisites,
  taxonomySchemaIsReady,
} from './catalog-migrations.js'

async function main() {
  const [command, planPath, ...extra] = process.argv.slice(2)
  if (
    !['check', 'classify', 'migrate'].includes(command ?? '') ||
    extra.length > 0 ||
    (command === 'classify' && !planPath) ||
    (command === 'migrate' && planPath !== undefined)
  )
    throw new Error(
      'Usage: db:catalog:check [plan.json] | db:catalog:classify <plan.json> | db:migrate',
    )
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')
  const migrationsFolder = resolve(config.out ?? './drizzle')
  const plan =
    command === 'classify' && planPath
      ? classificationPlanSchema.parse(
          JSON.parse(await readFile(planPath, 'utf8')),
        )
      : undefined
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5000,
  })
  try {
    await client.connect()
    const target = await classificationTarget(client)
    console.log(`Database: ${target.host}:${target.port}/${target.database}`)
    if (command !== 'check') {
      // Keep schema preparation and backfill from racing across CLI sessions.
      // The session lock is released when this dedicated connection closes.
      const { rows } = await client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock(7348022) as locked',
      )
      if (!rows[0]?.locked)
        throw new Error(
          'Another catalog migration or classification is running',
        )
    }
    if (plan) {
      if (!(await catalogPrerequisitesAreReady(client, migrationsFolder)))
        throw new Error(
          'Run db:migrate to prepare catalog prerequisites, then retry this ' +
            'classification plan. Migrations 0013/0014 wait for classification.',
        )
      const legacySchema = !(await taxonomySchemaIsReady(
        client,
        migrationsFolder,
      ))
      const count = await applyCatalogClassification(
        client,
        target,
        plan,
        legacySchema,
      )
      console.log(`Classified ${count} products. Run db:catalog:check again.`)
      return
    }
    if (command === 'migrate')
      await prepareCatalogPrerequisites(client, migrationsFolder)
    const report = await checkCatalogClassification(client, target)
    if (report.total !== '0') {
      const draft = `${JSON.stringify(report.plan, null, 2)}\n`
      if (planPath) await writeFile(planPath, draft, { flag: 'wx' })
      else console.error(draft)
      throw new Error(
        `${report.total} products need category/brand repair. ` +
          'The classification constraint migration is blocked. Earlier schema ' +
          'migrations may already be applied. Use db:catalog:check <plan.json> to export ' +
          'a plan, fill verified category/brand values, then run ' +
          'db:catalog:classify <plan.json> and db:migrate. ' +
          'Only the first 100 products are listed; repeat until clear.',
      )
    }
    console.log('Catalog classification check passed.')
    if (command === 'migrate') {
      // Use the same Drizzle migrator and journal as drizzle-kit, after the
      // read-only preflight succeeds. Pending SQL still validates atomically.
      // Hold the workforce gate before routing, for the entire pending chain:
      // assignment repairs must not race role, intake, or allocator commands.
      await client.query('select pg_advisory_lock_shared(7348021)')
      await client.query('select pg_advisory_lock(7348023)')
      await migrate(drizzle(client), { migrationsFolder })
      await finalizeCatalogClassification(client)
      console.log('Migrations applied successfully.')
    }
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Database command failed',
  )
  process.exitCode = 1
})
