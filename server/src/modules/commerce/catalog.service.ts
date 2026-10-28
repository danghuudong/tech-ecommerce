import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { db } from '../../config/db.js'
import { products, stockMovements } from '../../db/schema.js'
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
} from './commerce.persistence.js'
import { changeStock, lockProducts } from './inventory.service.js'

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

function publicProduct(product: typeof products.$inferSelect) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    category: product.category,
    brand: product.brand,
    priceVnd: product.priceVnd,
    currency: 'VND',
    availableQuantity: product.stockOnHand - product.stockReserved,
    version: product.version,
  }
}

export async function listProducts(input: CatalogListInput) {
  const { limit, offset, q, category, brand, minPrice, maxPrice } = input
  return db.transaction(
    async (tx) => {
      const filter = and(
        eq(products.active, true),
        q
          ? sql`strpos(lower(concat_ws(' ', ${products.name}, ${products.sku}, ${products.description})), lower(${q})) > 0`
          : undefined,
        category === 'computing'
          ? inArray(products.category, ['desktop', 'monitor'])
          : category
            ? eq(products.category, category)
            : undefined,
        brand ? eq(products.brand, brand) : undefined,
        minPrice !== undefined ? gte(products.priceVnd, minPrice) : undefined,
        maxPrice !== undefined ? lte(products.priceVnd, maxPrice) : undefined,
      )
      const records = await tx
        .select()
        .from(products)
        .where(filter)
        .orderBy(products.id)
        .limit(limit)
        .offset(offset)
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(products)
        .where(filter)
      return {
        items: records.map(publicProduct),
        limit,
        offset,
        total: count?.total ?? 0,
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

export async function getProduct(productId: string) {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.active, true)))
  if (!product) fail(404, 'PRODUCT_NOT_FOUND', 'Product was not found')
  return publicProduct(product)
}

export async function staffProducts(
  userId: string,
  limit: number,
  offset: number,
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'staff')
    return {
      items: await tx
        .select()
        .from(products)
        .orderBy(products.id)
        .limit(limit)
        .offset(offset),
      limit,
      offset,
    }
  })
}

export function createProduct(command: Command, input: ProductCreateInput) {
  return executeCommand({ ...command, permission: 'admin' }, async (tx) => {
    assertProductCanBeActive(input)
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
