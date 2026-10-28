import type { Client } from 'pg'
import { z } from 'zod'
import { productCategoryCodes } from '../modules/commerce/catalog-taxonomy.js'
import {
  idSchema,
  productCreateSchema,
  productUpdateSchema,
} from '../modules/commerce/commerce.contracts.js'

export const classificationPlanSchema = z.strictObject({
  target: z.strictObject({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    database: z.string().min(1),
  }),
  products: z
    .array(
      z
        .strictObject({
          id: idSchema,
          sku: z.string().min(1).max(80),
          name: z.string().min(1).max(200),
          expectedVersion: productUpdateSchema.shape.expectedVersion,
          category: productUpdateSchema.shape.category,
          brand: productUpdateSchema.shape.brand,
        })
        .refine(
          (item) => item.category !== undefined || item.brand !== undefined,
          'Provide a category or brand to repair',
        ),
    )
    .min(1)
    .max(100)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      'Each product must occur only once',
    ),
})

type ClassificationPlan = z.infer<typeof classificationPlanSchema>
type Target = ClassificationPlan['target']
type Product = {
  id: string
  sku: string
  name: string
  active: boolean
  version: number
  category: string | null
  brand: string | null
}

function hasValidCategory(product: Pick<Product, 'active' | 'category'>) {
  return (
    productCreateSchema.shape.category.nullable().safeParse(product.category)
      .success &&
    (!product.active || product.category !== null)
  )
}

function hasValidBrand(brand: Product['brand']) {
  const result = productCreateSchema.shape.brand.safeParse(brand)
  // Parsing input normalizes case/spacing. Stored data must already match its
  // canonical value to satisfy migration 0013 and qualify as valid metadata.
  return result.success && result.data === brand
}

function hasValidClassification(
  product: Pick<Product, 'active' | 'category' | 'brand'>,
) {
  return hasValidCategory(product) && hasValidBrand(product.brand)
}

function brandValiditySql(column: string) {
  // Match 0013 exactly; callers supply only fixed column references or NULL.
  return `char_length(${column}) between 1 and 80 and ${column} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`
}

export async function classificationTarget(client: Client): Promise<Target> {
  const { rows } = await client.query<{ database: string }>(
    'select current_database() as database',
  )
  const database = rows[0]?.database
  if (!database) throw new Error('Could not identify the database')
  return { host: client.host, port: client.port, database }
}

async function taxonomyColumns(client: Client) {
  const { rows } = await client.query<{ attname: string }>(
    `select attname from pg_attribute
     where attrelid = to_regclass('public.products')
       and attname in ('category', 'brand') and not attisdropped`,
  )
  return new Set(rows.map((column) => column.attname))
}

export async function checkCatalogClassification(
  client: Client,
  target: Target,
) {
  let missing: (Product & { total: string })[] = []
  await client.query('begin isolation level repeatable read read only')
  try {
    await client.query("set local statement_timeout = '15s'")
    const { rows: tables } = await client.query<{ products: string | null }>(
      "select to_regclass('public.products')::text as products",
    )
    // A new database has no inventory. On older databases, absent taxonomy
    // columns mean unclassified products, without reading entire product JSON.
    const columns = await taxonomyColumns(client)
    const category = columns.has('category') ? 'p.category' : 'null::text'
    const brand = columns.has('brand') ? 'p.brand' : 'null::text'
    const { rows } = tables[0]?.products
      ? await client.query<Product & { total: string }>(
          `select p.id, p.sku, p.name, p.active, p.version,
             ${category} as category, ${brand} as brand,
             count(*) over () as total
           from public.products p
           where (p.active and ${category} is null)
             or (${category} is not null and not (${category} = any($1::text[])))
             or (${brand} is not null and not (${brandValiditySql(brand)}))
           order by p.id limit 100`,
          [productCategoryCodes],
        )
      : { rows: [] }
    missing = rows
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
  return {
    total: missing[0]?.total ?? '0',
    plan: {
      target,
      products: missing.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        expectedVersion: product.version,
        category: product.category,
        brand: product.brand,
      })),
    },
  }
}

export async function applyCatalogClassification(
  client: Client,
  target: Target,
  plan: ClassificationPlan,
  legacySchema: boolean,
) {
  if (
    plan.target.host !== target.host ||
    plan.target.port !== target.port ||
    plan.target.database !== target.database
  )
    throw new Error(
      'The classification plan belongs to another database target',
    )

  await client.query('begin')
  try {
    await client.query("set local lock_timeout = '5s'")
    await client.query("set local statement_timeout = '15s'")
    if (legacySchema)
      await client.query('lock table public.products in access exclusive mode')
    const columns = await taxonomyColumns(client)
    const category = columns.has('category') ? 'p.category' : 'null::text'
    const brand = columns.has('brand') ? 'p.brand' : 'null::text'
    const { rows } = await client.query<Product>(
      `select p.id, p.sku, p.name, p.active, p.version,
         ${category} as category, ${brand} as brand
       from public.products p
       where p.id = any($1::uuid[]) order by p.id for update`,
      [plan.products.map((product) => product.id)],
    )
    const repairs: Pick<Product, 'id' | 'category' | 'brand'>[] = []
    for (const item of plan.products) {
      const product = rows.find((row) => row.id === item.id)
      if (
        !product ||
        product.sku !== item.sku ||
        product.name !== item.name ||
        product.version !== item.expectedVersion
      )
        throw new Error(`Product ${item.sku} changed; regenerate its plan`)
      if (hasValidClassification(product))
        throw new Error(`Product ${item.sku} does not need classification`)
      const nextCategory =
        item.category === undefined ? product.category : item.category
      const nextBrand = item.brand === undefined ? product.brand : item.brand
      if (hasValidCategory(product) && nextCategory !== product.category)
        throw new Error(`Product ${item.sku} already has a valid category`)
      if (
        product.brand !== null &&
        hasValidBrand(product.brand) &&
        nextBrand !== product.brand
      )
        throw new Error(`Product ${item.sku} already has another brand`)
      if (
        !hasValidClassification({
          active: product.active,
          category: nextCategory,
          brand: nextBrand,
        })
      )
        throw new Error(
          `Product ${item.sku} still has invalid metadata; provide verified category/brand values`,
        )
      repairs.push({ id: product.id, category: nextCategory, brand: nextBrand })
    }

    if (legacySchema) {
      // These additive columns are adopted by 0013's IF NOT EXISTS statements.
      // NOT VALID permits remaining legacy rows while enforcing canonical
      // metadata on updates. The brand guard uses a temporary name because
      // 0013 adds its final brand check without dropping an existing one.
      // Migration 0013 performs full validation once all repair batches finish.
      if (!columns.has('category'))
        await client.query(
          'alter table public.products add column category text',
        )
      if (!columns.has('brand'))
        await client.query('alter table public.products add column brand text')
      await client.query(
        'alter table public.products drop constraint if exists products_category_check',
      )
      const allowedCategories = productCategoryCodes
        .map((code) => `'${code}'`)
        .join(', ')
      await client.query(
        `alter table public.products add constraint products_category_check
         check (category in (${allowedCategories})) not valid`,
      )
      await client.query(
        'alter table public.products drop constraint if exists products_brand_check',
      )
      await client.query(
        'alter table public.products drop constraint if exists products_brand_repair_check',
      )
      await client.query(
        `alter table public.products add constraint products_brand_repair_check
         check (${brandValiditySql('brand')}) not valid`,
      )
    }

    for (const item of repairs)
      await client.query(
        `update public.products
         set category = $1, brand = $2,
           version = version + 1, updated_at = current_timestamp
         where id = $3`,
        [item.category, item.brand, item.id],
      )
    await client.query('commit')
    return plan.products.length
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

export async function finalizeCatalogClassification(client: Client) {
  const { rows } = await client.query<{ exists: boolean }>(
    `select exists (
       select 1 from pg_constraint
       where conrelid = to_regclass('public.products')
         and conname = 'products_brand_repair_check'
     ) as exists`,
  )
  if (!rows[0]?.exists) return

  await client.query('begin')
  try {
    await client.query("set local lock_timeout = '5s'")
    await client.query("set local statement_timeout = '15s'")
    await client.query('lock table public.products in access exclusive mode')
    const { rows: constraints } = await client.query<{ convalidated: boolean }>(
      `select convalidated from pg_constraint
       where conrelid = 'public.products'::regclass
         and conname = 'products_brand_check' and contype = 'c'`,
    )
    if (!constraints[0]?.convalidated)
      throw new Error(
        'The final brand constraint must be validated before cleanup',
      )
    await client.query(
      'alter table public.products drop constraint if exists products_brand_repair_check',
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}
