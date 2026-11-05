import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../../config/db.js'
import {
  productReviews,
  productStoreAvailability,
  products,
  stockMovements,
  stores,
} from '../../db/schema.js'
import type {
  CatalogListInput,
  ProductCreateInput,
  ProductUpdateInput,
} from './commerce.contracts.js'
import {
  type Command,
  executeCommand,
  fail,
  resolveActor,
  type Transaction,
} from './commerce.persistence.js'
import { changeStock, lockProducts } from './inventory.service.js'
import {
  listImagesForProducts,
  primaryImagesForProducts,
} from './product-media.service.js'

const RELATED_PRODUCT_LIMIT = 4
const variantSibling = alias(products, 'variant_sibling')

type ProductRecord = typeof products.$inferSelect

// Show the first variant that satisfies the current catalog filters.
function isVariantRepresentative(siblingFilter?: SQL) {
  return or(
    isNull(products.variantGroup),
    notExists(
      db
        .select({ id: variantSibling.id })
        .from(variantSibling)
        .where(
          and(
            eq(variantSibling.variantGroup, products.variantGroup),
            eq(variantSibling.active, true),
            siblingFilter,
            or(
              lt(variantSibling.variantRank, products.variantRank),
              and(
                eq(variantSibling.variantRank, products.variantRank),
                lt(variantSibling.id, products.id),
              ),
            ),
          ),
        ),
    ),
  )
}

const familyKey = sql<string>`coalesce(${products.variantGroup}, ${products.id}::text)`

async function cardDetails(
  records: ProductRecord[],
  executor: Pick<Transaction, 'select' | 'selectDistinctOn'> = db,
) {
  const keys = records.map((record) => record.variantGroup ?? record.id)
  const [ratings, images] = await Promise.all([
    keys.length
      ? executor
          .select({
            key: familyKey,
            average:
              sql<number>`round(avg(${productReviews.rating}), 1)`.mapWith(
                Number,
              ),
            total: count(),
          })
          .from(productReviews)
          .innerJoin(products, eq(products.id, productReviews.productId))
          .where(
            and(
              eq(productReviews.status, 'published'),
              inArray(familyKey, keys),
            ),
          )
          .groupBy(familyKey)
      : [],
    primaryImagesForProducts(
      records.map((record) => record.id),
      executor,
    ),
  ])
  const ratingByKey = new Map(ratings.map((row) => [row.key, row]))
  return (record: ProductRecord) => {
    const rating = ratingByKey.get(record.variantGroup ?? record.id)
    return {
      ...publicProduct(record),
      primaryImageId: images.get(record.id) ?? null,
      rating: rating ? { average: rating.average, count: rating.total } : null,
    }
  }
}

function assertProductCanBeActive({
  active,
  category,
}: Pick<typeof products.$inferSelect, 'active' | 'category'>) {
  if (active && category === null)
    fail(
      422,
      'PRODUCT_CATEGORY_REQUIRED',
      'Assign a category before putting a product on sale',
    )
}

function assertListPriceAbovePrice({
  priceVnd,
  listPriceVnd,
}: Pick<typeof products.$inferSelect, 'priceVnd' | 'listPriceVnd'>) {
  if (listPriceVnd !== null && listPriceVnd <= priceVnd)
    fail(
      422,
      'PRODUCT_LIST_PRICE_INVALID',
      'List price must be higher than the selling price',
    )
}

async function assertVariantIsValid(
  tx: Transaction,
  productId: string | null,
  {
    variantGroup,
    variantOptions,
  }: Pick<ProductRecord, 'variantGroup' | 'variantOptions'>,
) {
  if (!variantGroup) return
  if (variantOptions.length === 0)
    fail(
      422,
      'PRODUCT_VARIANT_OPTIONS_REQUIRED',
      'A product in a variant group needs at least one option',
    )
  const siblings = await tx
    .select({ id: products.id, variantOptions: products.variantOptions })
    .from(products)
    .where(
      and(
        eq(products.variantGroup, variantGroup),
        productId ? ne(products.id, productId) : undefined,
      ),
    )
  const signature = (options: ProductRecord['variantOptions']) =>
    JSON.stringify(
      options
        .map(({ name, value }) => [name.toLowerCase(), value.toLowerCase()])
        .sort(),
    )
  if (
    siblings.some(
      (sibling) =>
        signature(sibling.variantOptions) === signature(variantOptions),
    )
  )
    fail(
      409,
      'PRODUCT_VARIANT_DUPLICATE',
      'Another product in this group has the same options',
    )
}

function publicProduct(product: typeof products.$inferSelect) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    category: product.category,
    brand: product.brand,
    priceVnd: product.priceVnd,
    listPriceVnd: product.listPriceVnd,
    variantGroup: product.variantGroup,
    currency: 'VND',
    availableQuantity: product.stockOnHand - product.stockReserved,
    version: product.version,
  }
}

function catalogQueryMatch(
  q: string | undefined,
  row: typeof products | typeof variantSibling = products,
) {
  return q
    ? sql`strpos(lower(concat_ws(' ', ${row.name}, ${row.sku}, ${row.description})), lower(${q})) > 0`
    : undefined
}

function catalogFilters(
  row: typeof products | typeof variantSibling,
  { q, category, brand, minPrice, maxPrice, discounted }: CatalogListInput,
) {
  return and(
    catalogQueryMatch(q, row),
    category === 'computing'
      ? inArray(row.category, ['desktop', 'monitor'])
      : category
        ? eq(row.category, category)
        : undefined,
    brand ? eq(row.brand, brand) : undefined,
    minPrice !== undefined ? gte(row.priceVnd, minPrice) : undefined,
    maxPrice !== undefined ? lte(row.priceVnd, maxPrice) : undefined,
    discounted ? lt(row.priceVnd, row.listPriceVnd) : undefined,
  )
}

// Names beginning with the query come first, then names containing it, so a
// search for "iPhone" lists phones ahead of accessories that mention them.
function catalogQueryRank(q: string) {
  const position = sql`strpos(lower(${products.name}), lower(${q}))`
  return sql`case when ${position} = 1 then 0 when ${position} > 0 then 1 else 2 end`
}

export async function listProducts(input: CatalogListInput) {
  const { limit, offset, q } = input
  return db.transaction(
    async (tx) => {
      const filter = and(
        eq(products.active, true),
        catalogFilters(products, input),
        isVariantRepresentative(catalogFilters(variantSibling, input)),
      )
      const records = await tx
        .select()
        .from(products)
        .where(filter)
        .orderBy(...(q ? [catalogQueryRank(q)] : []), products.id)
        .limit(limit)
        .offset(offset)
      const [totals] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(products)
        .where(filter)
      return {
        // Keep enrichment on this transaction's connection. Borrowing another
        // pool client here deadlocks concurrent catalog requests at pool capacity.
        items: records.map(await cardDetails(records, tx)),
        limit,
        offset,
        total: totals?.total ?? 0,
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

export async function catalogFacets(q?: string) {
  const items = await db
    .select({
      category: products.category,
      brand: products.brand,
      minPriceVnd: sql<number>`min(${products.priceVnd})`.mapWith(Number),
      maxPriceVnd: sql<number>`max(${products.priceVnd})`.mapWith(Number),
    })
    .from(products)
    .where(and(eq(products.active, true), catalogQueryMatch(q)))
    .groupBy(products.category, products.brand)
    .orderBy(products.category, products.brand)
  return { items }
}

export async function getProduct(productId: string) {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.active, true)))
  if (!product) fail(404, 'PRODUCT_NOT_FOUND', 'Product was not found')
  const family = product.variantGroup
    ? await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.variantGroup, product.variantGroup),
            eq(products.active, true),
          ),
        )
        .orderBy(asc(products.variantRank), asc(products.id))
    : [product]
  const related = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.active, true),
        ne(products.id, productId),
        isVariantRepresentative(),
        product.variantGroup
          ? sql`${products.variantGroup} is distinct from ${product.variantGroup}`
          : undefined,
      ),
    )
    .orderBy(
      sql`(${products.category} = ${product.category}) desc`,
      products.id,
    )
    .limit(RELATED_PRODUCT_LIMIT)
  const [images, storeAvailability, details] = await Promise.all([
    listImagesForProducts(family.map((item) => item.id)),
    db
      .select({
        storeId: stores.id,
        name: stores.name,
        address: stores.address,
        province: stores.province,
        phone: stores.phone,
        openingHours: stores.openingHours,
        status: productStoreAvailability.status,
        updatedAt: productStoreAvailability.updatedAt,
      })
      .from(productStoreAvailability)
      .innerJoin(stores, eq(stores.id, productStoreAvailability.storeId))
      .where(
        and(
          eq(productStoreAvailability.productId, productId),
          eq(stores.active, true),
        ),
      )
      .orderBy(asc(stores.province), asc(stores.name)),
    cardDetails([product, ...related]),
  ])
  const ownImages = images.filter((image) => image.productId === productId)
  const fallbackOwner = images[0]?.productId
  return {
    ...details(product),
    overview: product.overview,
    highlights: product.highlights,
    specifications: product.specifications,
    packageContents: product.packageContents,
    warrantyMonths: product.warrantyMonths,
    variantOptions: product.variantOptions,
    variants:
      family.length > 1
        ? family.map((item) => ({
            id: item.id,
            name: item.name,
            options: item.variantOptions,
            priceVnd: item.priceVnd,
            availableQuantity: item.stockOnHand - item.stockReserved,
            primaryImageId:
              images.find((image) => image.productId === item.id)?.id ?? null,
          }))
        : [],
    images: (ownImages.length
      ? ownImages
      : images.filter((image) => image.productId === fallbackOwner)
    ).map(({ id, altText }) => ({ id, altText })),
    storeAvailability,
    related: related.map(details),
  }
}

export async function staffProducts(
  userId: string,
  {
    limit,
    offset,
    q,
  }: { limit: number; offset: number; q?: string | undefined },
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'staff')
    const filter = q
      ? sql`strpos(lower(concat_ws(' ', ${products.name}, ${products.sku})), lower(${q})) > 0`
      : undefined
    const [items, [totals]] = await Promise.all([
      tx
        .select()
        .from(products)
        .where(filter)
        .orderBy(asc(products.name), asc(products.id))
        .limit(limit)
        .offset(offset),
      tx.select({ total: count() }).from(products).where(filter),
    ])
    return { items, limit, offset, total: totals?.total ?? 0 }
  })
}

export function createProduct(command: Command, input: ProductCreateInput) {
  return executeCommand({ ...command, permission: 'admin' }, async (tx) => {
    assertProductCanBeActive(input)
    assertListPriceAbovePrice(input)
    await assertVariantIsValid(tx, null, input)
    const [product] = await tx
      .insert(products)
      .values(input)
      .returning({ id: products.id })
    if (!product)
      fail(503, 'PRODUCT_UNAVAILABLE', 'Product could not be created')
    return { productId: product.id }
  })
}

export function updateProduct(
  command: Command,
  productId: string,
  input: ProductUpdateInput,
) {
  return executeCommand({ ...command, permission: 'admin' }, async (tx) => {
    const [product] = await lockProducts(tx, [productId])
    if (!product) fail(404, 'PRODUCT_NOT_FOUND', 'Product was not found')
    if (product.version !== input.expectedVersion)
      fail(409, 'PRODUCT_CHANGED', 'Reload the product before updating it')
    assertProductCanBeActive({
      active: input.active ?? product.active,
      category:
        input.category === undefined ? product.category : input.category,
    })
    assertListPriceAbovePrice({
      priceVnd: input.priceVnd ?? product.priceVnd,
      listPriceVnd:
        input.listPriceVnd === undefined
          ? product.listPriceVnd
          : input.listPriceVnd,
    })
    await assertVariantIsValid(tx, productId, {
      variantGroup:
        input.variantGroup === undefined
          ? product.variantGroup
          : input.variantGroup,
      variantOptions: input.variantOptions ?? product.variantOptions,
    })
    const { expectedVersion: _expectedVersion, ...changes } = input
    await tx
      .update(products)
      .set({ ...changes, version: product.version + 1, updatedAt: new Date() })
      .where(eq(products.id, productId))
    return { productId }
  })
}

export function adjustStock(
  command: Command,
  productId: string,
  input: { delta: number; reason: string; reference: string },
) {
  return executeCommand(
    { ...command, permission: 'admin' },
    async (tx, actor) => {
      await changeStock(tx, actor, {
        productId,
        kind: 'adjustment',
        onHandDelta: input.delta,
        reservedDelta: 0,
        reason: input.reason,
        reference: input.reference,
      })
      return { productId }
    },
  )
}

export async function stockHistory(
  userId: string,
  productId: string,
  limit: number,
  offset: number,
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'staff')
    return {
      items: await tx
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.productId, productId))
        .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
        .limit(limit)
        .offset(offset),
      limit,
      offset,
    }
  })
}
