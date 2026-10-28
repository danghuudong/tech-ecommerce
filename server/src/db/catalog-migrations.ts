import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { Client } from 'pg'

const stagingPrefix = 'tech-ecommerce-taxonomy-'

async function removeMigrationStage(stageFolder: string, tempRoot: string) {
  if (
    dirname(resolve(stageFolder)) !== tempRoot ||
    !basename(stageFolder).startsWith(stagingPrefix)
  ) {
    console.warn('Unexpected migration staging directory; cleanup stopped')
    return
  }
  try {
    await rm(stageFolder, { recursive: true, force: true })
  } catch {
    console.warn(`Temporary migration files remain at ${stageFolder}`)
  }
}

async function taxonomyStage(
  migrationsFolder: string,
  includeTaxonomy: boolean,
) {
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as { entries: { tag: string; when: number }[] }
  const taxonomyIndex = journal.entries.findIndex(
    (entry) => entry.tag === '0013_product_taxonomy',
  )
  const index = taxonomyIndex - (includeTaxonomy ? 0 : 1)
  const boundary = readMigrationFiles({ migrationsFolder })[index]
  if (taxonomyIndex < 1 || !boundary)
    throw new Error(
      'The product taxonomy migration is missing from the journal',
    )
  return {
    journal: { ...journal, entries: journal.entries.slice(0, index + 1) },
    boundary,
  }
}

async function schemaStageIsReady(
  client: Client,
  migrationsFolder: string,
  includeTaxonomy: boolean,
) {
  const { boundary } = await taxonomyStage(migrationsFolder, includeTaxonomy)
  const { rows: tables } = await client.query<{ history: string | null }>(
    "select to_regclass('drizzle.__drizzle_migrations')::text as history",
  )
  if (!tables[0]?.history) return false
  const { rows } = await client.query<{ hash: string }>(
    'select hash from drizzle.__drizzle_migrations where created_at = $1',
    [boundary.folderMillis],
  )
  if (rows.length === 0) return false
  if (rows.some((row) => row.hash !== boundary.hash))
    throw new Error('Applied catalog migration differs from the repository')
  return true
}

export function taxonomySchemaIsReady(
  client: Client,
  migrationsFolder: string,
) {
  return schemaStageIsReady(client, migrationsFolder, true)
}

export function catalogPrerequisitesAreReady(
  client: Client,
  migrationsFolder: string,
) {
  return schemaStageIsReady(client, migrationsFolder, false)
}

export async function prepareCatalogPrerequisites(
  client: Client,
  migrationsFolder: string,
) {
  if (await catalogPrerequisitesAreReady(client, migrationsFolder)) return
  const { journal } = await taxonomyStage(migrationsFolder, false)
  const tempRoot = resolve(tmpdir())
  const stageFolder = await mkdtemp(join(tempRoot, stagingPrefix))
  try {
    // A prefix journal lets the existing migrator apply the original SQL and
    // hashes before 0013. Both 0013 and 0014 depend on repairing legacy data.
    await mkdir(join(stageFolder, 'meta'))
    await writeFile(
      join(stageFolder, 'meta/_journal.json'),
      JSON.stringify(journal),
    )
    for (const entry of journal.entries)
      await copyFile(
        join(migrationsFolder, `${entry.tag}.sql`),
        join(stageFolder, `${entry.tag}.sql`),
      )
    await migrate(drizzle(client), { migrationsFolder: stageFolder })
    if (!(await catalogPrerequisitesAreReady(client, migrationsFolder)))
      throw new Error(
        'Catalog prerequisite history is incomplete; inspect migrations',
      )
    console.log(
      'Catalog prerequisites prepared. Migration 0013 is still pending.',
    )
  } finally {
    await removeMigrationStage(stageFolder, tempRoot)
  }
}
