import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '../../config/db.js'
import { env } from '../../config/env.js'
import {
  cartItems,
  carts,
  checkoutQuotes,
  orderItems,
  orders,
} from '../../db/schema.js'
import { lockCart, readCartItems } from './cart.service.js'
import type { CheckoutInput } from './commerce.contracts.js'
import {
  appendOrderEvent,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  resolveActor,
} from './commerce.persistence.js'
import {
  type BankInstructions,
  QUOTE_LIFETIME_MS,
  type QuoteLine,
} from './commerce.types.js'
import { changeStock, lockProducts } from './inventory.service.js'
import { calculateOrderPricing } from './order-pricing.js'
import { reservationDeadline } from './reservation.service.js'

function bankInstructions(): BankInstructions | null {
  if (
    !env.ORDER_BANK_NAME ||
    !env.ORDER_BANK_ACCOUNT_NUMBER ||
    !env.ORDER_BANK_ACCOUNT_HOLDER
  )
    return null
  return {
    bankName: env.ORDER_BANK_NAME,
    accountNumber: env.ORDER_BANK_ACCOUNT_NUMBER,
    accountHolder: env.ORDER_BANK_ACCOUNT_HOLDER,
  }
}

export function checkoutPolicy() {
  return {
    currency: 'VND',
    pricesIncludeTax: true,
    deliveryMethods: [
      {
        id: 'standard',
        shippingFeeVnd: env.ORDER_SHIPPING_FEE_VND,
        freeShippingThresholdVnd: env.ORDER_FREE_SHIPPING_THRESHOLD_VND,
      },
    ],
    paymentMethods: bankInstructions() ? ['cod', 'bank_transfer'] : ['cod'],
    bankTransferConfigured: bankInstructions() !== null,
    returnWindowDays: 7,
    quoteLifetimeSeconds: QUOTE_LIFETIME_MS / 1000,
    bankReservationMinutes: env.ORDER_BANK_RESERVATION_MINUTES,
    bankPaymentDeadlineBasis: 'received_at',
    bankReservationExpiryAction: 'await_statement_reconciliation',
    bankReconciliationSlaHours: env.ORDER_BANK_RECONCILIATION_SLA_HOURS,
    shippingRefundPolicy: 'full_return_store_or_carrier_fault',
    customerCancellationUntil: 'before_packing',
    codConfirmationHours: env.ORDER_COD_CONFIRMATION_HOURS,
    maxPendingOrdersPerCustomer: env.ORDER_MAX_PENDING_PER_CUSTOMER,
  }
}

export function createQuote(command: Command, input: CheckoutInput) {
  return executeCommand(command, async (tx, actor) => {
    const bank = bankInstructions()
    if (input.paymentMethod === 'bank_transfer' && !bank)
      fail(
        503,
        'BANK_TRANSFER_NOT_CONFIGURED',
        'Bank transfer instructions have not been configured',
      )
    let cartId: string | null = null
    let cartVersion: number | null = null
    let items: { productId: string; quantity: number }[]
    if (input.source === 'cart') {
      const cart = await lockCart(tx, actor.userId)
      if (cart.version !== input.cartVersion)
        fail(409, 'CART_CHANGED', 'Reload the cart before checkout')
      cartId = cart.id
      cartVersion = cart.version
      items = await readCartItems(tx, cart.id)
    } else items = input.items
    const catalog = await lockProducts(
      tx,
      items.map((item) => item.productId),
    )
    const lines: QuoteLine[] = items.map((item) => {
      const product = catalog.find((record) => record.id === item.productId)
      if (!product?.active)
        fail(409, 'PRODUCT_UNAVAILABLE', 'Product is unavailable')
      if (product.stockOnHand - product.stockReserved < item.quantity)
        fail(
          409,
          'INSUFFICIENT_STOCK',
          'Requested quantity exceeds available stock',
        )
      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        quantity: item.quantity,
        unitPriceVnd: product.priceVnd,
        lineTotalVnd: product.priceVnd * item.quantity,
      }
    })
    const subtotalVnd = lines.reduce((sum, line) => sum + line.lineTotalVnd, 0)
    const pricing = calculateOrderPricing(subtotalVnd)
    if (!pricing.withinAmountLimit)
      fail(
        422,
        'ORDER_AMOUNT_LIMIT',
        'Order amount exceeds the supported limit',
      )
    const { shippingFeeVnd, totalVnd } = pricing
    const now = await databaseNow(tx)
    const [quote] = await tx
      .insert(checkoutQuotes)
      .values({
        userId: actor.userId,
        cartId,
        cartVersion,
        lines,
        recipient: input.recipient,
        paymentMethod: input.paymentMethod,
        bankInstructions: input.paymentMethod === 'bank_transfer' ? bank : null,
        subtotalVnd,
        shippingFeeVnd,
        totalVnd,
        expiresAt: new Date(now.getTime() + QUOTE_LIFETIME_MS),
      })
      .returning({ id: checkoutQuotes.id })
    if (!quote)
      fail(503, 'QUOTE_UNAVAILABLE', 'Checkout quote could not be created')
    return { quoteId: quote.id }
  })
}

export async function getQuote(userId: string, quoteId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`)
    await resolveActor(tx, userId)
    const [quote] = await tx
      .select()
      .from(checkoutQuotes)
      .where(
        and(eq(checkoutQuotes.id, quoteId), eq(checkoutQuotes.userId, userId)),
      )
      .for('share')
    if (!quote) fail(404, 'QUOTE_NOT_FOUND', 'Checkout quote was not found')
    const now = await databaseNow(tx)
    return {
      ...quote,
      bankInstructions: null,
      paymentInstructionsAvailableAfterOrder:
        quote.paymentMethod === 'bank_transfer',
      currency: 'VND',
      taxIncluded: true,
      discountVnd: 0,
      additionalTaxVnd: 0,
      deliveryMethod: 'standard',
      expired: quote.expiresAt <= now,
      status: quote.acceptedOrderId
        ? 'accepted'
        : quote.expiresAt <= now
          ? 'expired'
          : 'open',
      stockReserved: false,
    }
  })
}

export async function placeOrder(command: Command, quoteId: string) {
  const result = await executeCommand(command, async (tx, actor) => {
    // Serialize the customer quota across concurrent quotes and buy-now orders.
    await tx.execute(
      sql`select pg_advisory_xact_lock(7348022, hashtext(${actor.userId}))`,
    )
    const [metadata] = await tx
      .select({ cartId: checkoutQuotes.cartId })
      .from(checkoutQuotes)
      .where(
        and(
          eq(checkoutQuotes.id, quoteId),
          eq(checkoutQuotes.userId, actor.userId),
        ),
      )
    if (!metadata) fail(404, 'QUOTE_NOT_FOUND', 'Checkout quote was not found')
    // Keep the cart -> quote -> ordered product lock order shared with checkout.
    const cart = metadata.cartId ? await lockCart(tx, actor.userId) : null
    const [quote] = await tx
      .select()
      .from(checkoutQuotes)
      .where(
        and(
          eq(checkoutQuotes.id, quoteId),
          eq(checkoutQuotes.userId, actor.userId),
        ),
      )
      .for('update')
    if (!quote) fail(404, 'QUOTE_NOT_FOUND', 'Checkout quote was not found')
    if (quote.acceptedOrderId) return { orderId: quote.acceptedOrderId }
    const now = await databaseNow(tx)
    if (quote.expiresAt <= now)
      fail(409, 'QUOTE_EXPIRED', 'Create a new checkout quote')
    if (
      cart &&
      (cart.id !== quote.cartId || cart.version !== quote.cartVersion)
    )
      fail(
        409,
        'CART_CHANGED',
        'Cart changed after checkout; create a new quote',
      )
    const currentBank = bankInstructions()
    if (
      quote.shippingFeeVnd !==
        calculateOrderPricing(quote.subtotalVnd).shippingFeeVnd ||
      (quote.paymentMethod === 'bank_transfer' &&
        (!currentBank ||
          quote.bankInstructions?.bankName !== currentBank.bankName ||
          quote.bankInstructions.accountNumber !== currentBank.accountNumber ||
          quote.bankInstructions.accountHolder !== currentBank.accountHolder))
    )
      fail(
        409,
        'CHECKOUT_CHANGED',
        'Checkout policy changed; create a new quote',
      )
    const pendingOrders = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.userId, actor.userId),
          eq(orders.stockState, 'reserved'),
          isNotNull(orders.reservationExpiresAt),
        ),
      )
      .limit(env.ORDER_MAX_PENDING_PER_CUSTOMER)
    if (pendingOrders.length >= env.ORDER_MAX_PENDING_PER_CUSTOMER)
      fail(
        409,
        'PENDING_ORDER_LIMIT',
        'Resolve pending orders before placing another order',
      )
    const catalog = await lockProducts(
      tx,
      quote.lines.map((line) => line.productId),
    )
    for (const line of quote.lines) {
      const product = catalog.find((item) => item.id === line.productId)
      if (!product?.active)
        fail(409, 'PRODUCT_UNAVAILABLE', 'Product is unavailable')
      if (
        product.priceVnd !== line.unitPriceVnd ||
        product.sku !== line.sku ||
        product.name !== line.name
      )
        fail(
          409,
          'PRICE_CHANGED',
          'Product details changed; create a new quote',
        )
      if (product.stockOnHand - product.stockReserved < line.quantity)
        fail(
          409,
          'INSUFFICIENT_STOCK',
          'Requested quantity exceeds available stock',
        )
    }
    const placedAt = await databaseNow(tx)
    if (quote.expiresAt <= placedAt)
      fail(409, 'QUOTE_EXPIRED', 'Create a new checkout quote')
    const deadline = reservationDeadline(quote.paymentMethod, placedAt)
    const paymentDeadlineAt =
      quote.paymentMethod === 'bank_transfer' ? deadline : null
    const paymentReviewDueAt = paymentDeadlineAt
      ? new Date(
          paymentDeadlineAt.getTime() +
            env.ORDER_BANK_RECONCILIATION_SLA_HOURS * 3_600_000,
        )
      : null
    const [order] = await tx
      .insert(orders)
      .values({
        userId: actor.userId,
        quoteId,
        recipient: quote.recipient,
        paymentMethod: quote.paymentMethod,
        bankInstructions: quote.bankInstructions,
        subtotalVnd: quote.subtotalVnd,
        shippingFeeVnd: quote.shippingFeeVnd,
        totalVnd: quote.totalVnd,
        reservationExpiresAt: deadline,
        paymentDeadlineAt,
        paymentReviewDueAt,
        createdAt: placedAt,
        updatedAt: placedAt,
      })
      .returning({ id: orders.id })
    if (!order) fail(503, 'ORDER_UNAVAILABLE', 'Order could not be created')
    await tx.insert(orderItems).values(
      quote.lines.map((line) => ({
        orderId: order.id,
        productId: line.productId,
        skuSnapshot: line.sku,
        nameSnapshot: line.name,
        unitPriceVnd: line.unitPriceVnd,
        quantity: line.quantity,
        lineTotalVnd: line.lineTotalVnd,
      })),
    )
    for (const line of [...quote.lines].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    )) {
      await changeStock(tx, actor, {
        productId: line.productId,
        orderId: order.id,
        kind: 'reserve',
        onHandDelta: 0,
        reservedDelta: line.quantity,
        reason: 'Order placed',
        reference: order.id,
      })
    }
    if (cart) {
      await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id))
      await tx
        .update(carts)
        .set({ version: cart.version + 1, updatedAt: now })
        .where(eq(carts.id, cart.id))
    }
    await tx
      .update(checkoutQuotes)
      .set({ acceptedOrderId: order.id })
      .where(eq(checkoutQuotes.id, quoteId))
    await appendOrderEvent(tx, actor, order.id, 'order_placed', {
      totalVnd: quote.totalVnd,
      paymentMethod: quote.paymentMethod,
      reservationExpiresAt: deadline.toISOString(),
      paymentDeadlineAt: paymentDeadlineAt?.toISOString() ?? null,
      paymentReviewDueAt: paymentReviewDueAt?.toISOString() ?? null,
    })
    return { orderId: order.id }
  })
  // Enrich both new results and persisted responses from older commands.
  // The stored order owns the payment method used for checkout navigation.
  if (typeof result.orderId !== 'string')
    fail(503, 'ORDER_UNAVAILABLE', 'Placed order could not be resolved')
  const [placedOrder] = await db
    .select({ orderId: orders.id, paymentMethod: orders.paymentMethod })
    .from(orders)
    .where(
      and(
        eq(orders.id, result.orderId),
        eq(orders.quoteId, quoteId),
        eq(orders.userId, command.userId),
      ),
    )
  if (!placedOrder)
    fail(503, 'ORDER_UNAVAILABLE', 'Placed order could not be resolved')
  return placedOrder
}
