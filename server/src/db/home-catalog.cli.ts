import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { z } from 'zod'
import { productCreateSchema } from '../modules/commerce/commerce.contracts.js'

const fixtureSchema = z.strictObject({
  capturedAt: z.iso.datetime(),
  sourceUrl: z.url(),
  products: z
    .array(
      productCreateSchema.extend({
        image: z.strictObject({
          path: z
            .string()
            .regex(/^\/images\/home-v2-catalog\/product-\d+\.(jpg|png|webp)$/),
          mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
          sourceUrl: z.url(),
        }),
        sourceUrl: z.url(),
      }),
    )
    .min(1)
    .max(500),
})

async function main() {
  const environment = new URL('../../.env', import.meta.url)
  if (existsSync(environment)) process.loadEnvFile(environment)
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const args = process.argv.slice(2)
  if (
    args.length > 1 ||
    (args[0] !== undefined &&
      !['--replace', '--refresh-details'].includes(args[0]))
  )
    throw new Error(
      'Usage: pnpm --filter server db:catalog:import [--replace | --refresh-details]',
    )
  const replaceCatalog = args[0] === '--replace'
  const refreshDetails = args[0] === '--refresh-details'
  const fixture = fixtureSchema.parse(
    JSON.parse(
      await readFile(
        new URL('./fixtures/home-catalog.json', import.meta.url),
        'utf8',
      ),
    ),
  )
  if (
    new Set(fixture.products.map((product) => product.sku)).size !==
    fixture.products.length
  )
    throw new Error('Duplicate SKU in catalog fixture')
  const prepared = await Promise.all(
    fixture.products.map(async (product) => {
      if (
        product.listPriceVnd !== null &&
        product.listPriceVnd <= product.priceVnd
      )
        throw new Error(`Invalid list price for ${product.sku}`)
      const content = await readFile(
        new URL(`../../../client/public${product.image.path}`, import.meta.url),
      )
      if (content.length < 16 || content.length > 524_288)
        throw new Error(`Invalid image size for ${product.sku}`)
      return {
        product,
        content,
        hash: createHash('sha256').update(content).digest('hex'),
      }
    }),
  )
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  })
  let inserted = 0
  try {
    await client.connect()
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '15s'")
    await client.query('SELECT pg_advisory_xact_lock(7348022)')
    const administratorIds = (process.env.ORDER_ADMIN_USER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
    const { rows: administrators } = await client.query<{ id: string }>(
      `SELECT id FROM "user" WHERE role = 'admin' OR id = ANY($1::text[]) ORDER BY id LIMIT 1 FOR SHARE`,
      [administratorIds],
    )
    const administrator = administrators[0]
    if (!administrator)
      throw new Error(
        'Configure an administrator before importing product images',
      )
    for (const { product, content, hash } of prepared) {
      // Existing prices, images and inventory belong to the shop.
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO products (sku, name, category, brand, price_vnd, list_price_vnd, description, specifications,
           variant_group, variant_options, variant_rank)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11)
         ON CONFLICT (sku) DO NOTHING RETURNING id`,
        [
          product.sku,
          product.name,
          product.category,
          product.brand,
          product.priceVnd,
          product.listPriceVnd,
          product.description,
          JSON.stringify(product.specifications),
          product.variantGroup,
          JSON.stringify(product.variantOptions),
          product.variantRank,
        ],
      )
      const created = rows[0]
      if (!created) {
        if (product.variantGroup)
          await client.query(
            `UPDATE products SET variant_group = $2, variant_options = $3::jsonb,
               variant_rank = CASE WHEN variant_group IS NULL THEN $4 ELSE variant_rank END,
               version = version + 1, updated_at = clock_timestamp()
             WHERE sku = $1 AND category = $5 AND brand IS NOT DISTINCT FROM $6
               AND (variant_group IS NULL OR (
                 variant_group = $2 AND variant_options <@ $3::jsonb
                 AND variant_options IS DISTINCT FROM $3::jsonb
               ))`,
            [
              product.sku,
              product.variantGroup,
              JSON.stringify(product.variantOptions),
              product.variantRank,
              product.category,
              product.brand,
            ],
          )
        if (refreshDetails && product.specifications.length > 0) {
          const colour = product.variantOptions.find(
            (option) => option.name === 'Màu sắc',
          )
          const suffix = colour ? ` - ${colour.value}` : null
          const legacyName =
            suffix && product.name.endsWith(suffix)
              ? product.name.slice(0, -suffix.length)
              : null
          await client.query(
            `UPDATE products SET specifications = $2::jsonb,
               name = CASE WHEN name = $5 THEN $6 ELSE name END,
               version = version + 1, updated_at = clock_timestamp()
             WHERE sku = $1 AND category = $3 AND brand IS NOT DISTINCT FROM $4
               AND ($5::text IS NULL OR variant_options = $7::jsonb)
               AND (specifications IS DISTINCT FROM $2::jsonb OR (name = $5 AND name IS DISTINCT FROM $6))`,
            [
              product.sku,
              JSON.stringify(product.specifications),
              product.category,
              product.brand,
              legacyName,
              product.name,
              JSON.stringify(product.variantOptions),
            ],
          )
        }
        if (replaceCatalog)
          await client.query(
            `UPDATE products SET description = $2, specifications = $3::jsonb,
             version = version + 1, updated_at = clock_timestamp()
           WHERE sku = $1 AND (description IS DISTINCT FROM $2 OR specifications IS DISTINCT FROM $3::jsonb)`,
            [
              product.sku,
              product.description,
              JSON.stringify(product.specifications),
            ],
          )
        continue
      }
      await client.query(
        `INSERT INTO product_images (product_id, position, alt_text, media_type, content, sha256, uploaded_by)
         VALUES ($1, 0, $2, $3, $4, $5, $6)`,
        [
          created.id,
          product.name,
          product.image.mediaType,
          content,
          hash,
          administrator.id,
        ],
      )
      inserted += 1
    }
    const archived = replaceCatalog
      ? await client.query(
          `UPDATE products SET active = false, version = version + 1,
             updated_at = clock_timestamp()
           WHERE active AND NOT (sku = ANY($1::text[]))`,
          [fixture.products.map((product) => product.sku)],
        )
      : null
    await client.query('COMMIT')
    console.log(
      `Imported ${inserted} products with images. Existing SKUs: ${prepared.length - inserted}. New stock: 0.`,
    )
    if (archived)
      console.log(
        `Removed ${archived.rowCount} previous products from the active catalog; order history preserved.`,
      )
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Catalog import failed',
  )
  process.exitCode = 1
})
