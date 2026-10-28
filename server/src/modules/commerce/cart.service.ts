import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../config/db.js'
import { cartItems, carts, products } from '../../db/schema.js'
import {
  type Command,
  executeCommand,
  fail,
  resolveActor,
  type Transaction,
} from './commerce.persistence.js'
import { MAX_LINES } from './commerce.types.js'
import { lockProducts } from './inventory.service.js'
import { calculateOrderPricing } from './order-pricing.js'

export async function lockCart(tx: Transaction, userId: string) {
  await tx.insert(carts).values({ userId }).onConflictDoNothing()
  const [cart] = await tx
    .select()
    .from(carts)
    .where(eq(carts.userId, userId))
    .for('update')
  if (!cart) fail(503, 'CART_UNAVAILABLE', 'Cart is unavailable')
  return cart
}

export async function readCartItems(tx: Transaction, cartId: string) {
  return tx
    .select({ productId: cartItems.productId, quantity: cartItems.quantity })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId))
    .orderBy(cartItems.productId)
}

export async function getCart(userId: string) {
  return db.transaction(
    async (tx) => {
      await resolveActor(tx, userId)
      const [cart] = await tx
        .select()
        .from(carts)
        .where(eq(carts.userId, userId))
      if (!cart)
        return {
          id: null,
          version: 0,
          items: [],
          subtotalVnd: 0,
          currency: 'VND',
          checkoutEligible: false,
        }
      const lines = await tx
        .select({ item: cartItems, product: products })
        .from(cartItems)
        .innerJoin(products, eq(products.id, cartItems.productId))
        .where(eq(cartItems.cartId, cart.id))
        .orderBy(cartItems.productId)
      const items = lines.map(({ item, product }) => ({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        quantity: item.quantity,
        unitPriceVnd: product.priceVnd,
        lineTotalVnd: product.priceVnd * item.quantity,
        availableQuantity: product.stockOnHand - product.stockReserved,
        eligible:
          product.active &&
          product.stockOnHand - product.stockReserved >= item.quantity,
      }))
      const subtotalVnd = items.reduce(
        (total, item) => total + item.lineTotalVnd,
        0,
      )
      return {
        id: cart.id,
        version: cart.version,
        items,
        subtotalVnd,
        currency: 'VND',
        checkoutEligible:
          items.length > 0 &&
          items.every((item) => item.eligible) &&
          calculateOrderPricing(subtotalVnd).withinAmountLimit,
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

export function setCartItem(
  command: Command,
  productId: string,
  input: { quantity: number; expectedVersion: number },
) {
  return executeCommand(command, async (tx, actor) => {
    const cart = await lockCart(tx, actor.userId)
    if (cart.version !== input.expectedVersion)
      fail(409, 'CART_CHANGED', 'Reload the cart before changing it')
    const predicate = and(
      eq(cartItems.cartId, cart.id),
      eq(cartItems.productId, productId),
    )
    if (input.quantity === 0) {
      await tx.delete(cartItems).where(predicate)
    } else {
      const [product] = await lockProducts(tx, [productId])
      if (!product?.active)
        fail(409, 'PRODUCT_UNAVAILABLE', 'Product is unavailable')
      if (product.stockOnHand - product.stockReserved < input.quantity)
        fail(
          409,
          'INSUFFICIENT_STOCK',
          'Requested quantity exceeds available stock',
        )
      const lines = await readCartItems(tx, cart.id)
      if (
        lines.length >= MAX_LINES &&
        !lines.some((line) => line.productId === productId)
      )
        fail(422, 'CART_LIMIT_EXCEEDED', 'Cart has reached the product limit')
      await tx
        .insert(cartItems)
        .values({ cartId: cart.id, productId, quantity: input.quantity })
        .onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.productId],
          set: { quantity: input.quantity },
        })
    }
    await tx
      .update(carts)
      .set({ version: sql`${carts.version} + 1`, updatedAt: new Date() })
      .where(eq(carts.id, cart.id))
    return { cartId: cart.id, version: cart.version + 1 }
  })
}

export function clearCart(command: Command, expectedVersion: number) {
  return executeCommand(command, async (tx, actor) => {
    const cart = await lockCart(tx, actor.userId)
    if (cart.version !== expectedVersion)
      fail(409, 'CART_CHANGED', 'Reload the cart before clearing it')
    await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id))
    await tx
      .update(carts)
      .set({ version: cart.version + 1, updatedAt: new Date() })
      .where(eq(carts.id, cart.id))
    return { cartId: cart.id, version: cart.version + 1 }
  })
}
