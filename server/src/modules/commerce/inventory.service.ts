import { eq, inArray } from 'drizzle-orm'
import { products, stockMovements } from '../../db/schema.js'
import { fail, type Transaction } from './commerce.persistence.js'
import type { AuditActor } from './commerce.types.js'

export async function lockProducts(tx: Transaction, ids: string[]) {
  if (ids.length === 0)
    fail(422, 'EMPTY_PURCHASE', 'At least one product is required')
  const rows = await tx
    .select()
    .from(products)
    .where(inArray(products.id, ids))
    .orderBy(products.id)
    .for('update')
  if (rows.length !== new Set(ids).size)
    fail(404, 'PRODUCT_NOT_FOUND', 'One or more products were not found')
  return rows
}

export async function changeStock(
  tx: Transaction,
  actor: AuditActor,
  input: {
    productId: string
    orderId?: string
    kind: typeof stockMovements.$inferInsert.kind
    onHandDelta: number
    reservedDelta: number
    reason: string
    reference: string
  },
): Promise<void> {
  const [product] = await lockProducts(tx, [input.productId])
  if (!product) fail(404, 'PRODUCT_NOT_FOUND', 'Product was not found')
  const onHand = product.stockOnHand + input.onHandDelta
  const reserved = product.stockReserved + input.reservedDelta
  if (onHand < 0 || reserved < 0 || reserved > onHand || onHand > 2_147_483_647)
    fail(
      409,
      'INSUFFICIENT_STOCK',
      'Stock adjustment would violate available inventory',
    )
  await tx
    .update(products)
    .set({
      stockOnHand: onHand,
      stockReserved: reserved,
      version: product.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(products.id, product.id))
  await tx.insert(stockMovements).values({
    ...input,
    actorUserId: actor.userId,
    actorType: actor.role === 'system' ? 'system' : 'user',
  })
}
