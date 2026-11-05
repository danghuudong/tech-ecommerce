import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../config/db.js'
import {
  orderItems,
  orders,
  productQuestions,
  productReviews,
  products,
  user,
} from '../../db/schema.js'
import type {
  ProductFeedbackListInput,
  ProductQuestionDecisionInput,
  ProductQuestionInput,
  ProductReviewDecisionInput,
  ProductReviewInput,
  ProductReviewListInput,
} from './commerce.contracts.js'
import {
  type Command,
  executeCommand,
  fail,
  resolveActor,
  type Transaction,
} from './commerce.persistence.js'

const MAX_PENDING_QUESTIONS = 5

type PublicPage = { limit: number; offset: number }

function maskName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const last = parts.at(-1)
  if (!last) return 'Khách hàng'
  if (parts.length === 1) return `${[...last][0]}***`
  const initials = parts.slice(0, -1).map((part) => `${[...part][0]}.`)
  return `${initials.join('')} ${last}`
}

async function findActiveProduct(productId: string) {
  const [product] = await db
    .select({ id: products.id, variantGroup: products.variantGroup })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.active, true)))
  if (!product) fail(404, 'PRODUCT_NOT_FOUND', 'Product was not found')
  return product
}

// Reviews and questions belong to the model, so every variant shows them.
function familyIds(product: { id: string; variantGroup: string | null }) {
  return db
    .select({ id: products.id })
    .from(products)
    .where(
      product.variantGroup
        ? eq(products.variantGroup, product.variantGroup)
        : eq(products.id, product.id),
    )
}

export async function listProductReviews(
  productId: string,
  page: ProductReviewListInput,
) {
  const product = await findActiveProduct(productId)
  const filter = and(
    eq(productReviews.status, 'published'),
    inArray(productReviews.productId, familyIds(product)),
  )
  const [items, distribution] = await Promise.all([
    db
      .select({
        id: productReviews.id,
        rating: productReviews.rating,
        comment: productReviews.comment,
        createdAt: productReviews.createdAt,
        updatedAt: productReviews.updatedAt,
        productName: products.name,
        authorName: user.name,
      })
      .from(productReviews)
      .innerJoin(products, eq(products.id, productReviews.productId))
      .innerJoin(user, eq(user.id, productReviews.userId))
      .where(
        page.rating
          ? and(filter, eq(productReviews.rating, page.rating))
          : filter,
      )
      .orderBy(desc(productReviews.createdAt), desc(productReviews.id))
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({ rating: productReviews.rating, total: count() })
      .from(productReviews)
      .where(filter)
      .groupBy(productReviews.rating),
  ])
  const reviewCount = distribution.reduce((sum, row) => sum + row.total, 0)
  const points = distribution.reduce(
    (sum, row) => sum + row.rating * row.total,
    0,
  )
  return {
    items: items.map(({ authorName, ...review }) => ({
      ...review,
      author: maskName(authorName),
    })),
    limit: page.limit,
    offset: page.offset,
    total: page.rating
      ? (distribution.find((row) => row.rating === page.rating)?.total ?? 0)
      : reviewCount,
    summary: {
      average: reviewCount
        ? Math.round((points / reviewCount) * 10) / 10
        : null,
      count: reviewCount,
      distribution: [5, 4, 3, 2, 1].map((rating) => ({
        rating,
        total: distribution.find((row) => row.rating === rating)?.total ?? 0,
      })),
    },
  }
}

export async function listProductQuestions(
  productId: string,
  page: PublicPage,
) {
  const product = await findActiveProduct(productId)
  const filter = and(
    eq(productQuestions.status, 'answered'),
    inArray(productQuestions.productId, familyIds(product)),
  )
  const [items, [totals]] = await Promise.all([
    db
      .select({
        id: productQuestions.id,
        question: productQuestions.question,
        answer: productQuestions.answer,
        answeredAt: productQuestions.answeredAt,
        createdAt: productQuestions.createdAt,
        authorName: user.name,
      })
      .from(productQuestions)
      .innerJoin(user, eq(user.id, productQuestions.userId))
      .where(filter)
      .orderBy(desc(productQuestions.answeredAt), desc(productQuestions.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(productQuestions).where(filter),
  ])
  return {
    items: items.map(({ authorName, ...question }) => ({
      ...question,
      author: maskName(authorName),
    })),
    limit: page.limit,
    offset: page.offset,
    total: totals?.total ?? 0,
  }
}

async function deliveredOrderId(
  tx: Transaction,
  userId: string,
  productId: string,
) {
  const [order] = await tx
    .select({ id: orders.id })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orderItems.productId, productId),
        eq(orders.userId, userId),
        inArray(orders.status, ['delivered', 'completed']),
        isNull(orders.deletedAt),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(1)
  return order?.id ?? null
}

export async function getMyProductReview(userId: string, productId: string) {
  return db.transaction(async (tx) => {
    const actor = await resolveActor(tx, userId)
    const [review] = await tx
      .select({
        rating: productReviews.rating,
        comment: productReviews.comment,
        status: productReviews.status,
      })
      .from(productReviews)
      .where(
        and(
          eq(productReviews.productId, productId),
          eq(productReviews.userId, actor.userId),
        ),
      )
    return {
      eligible: Boolean(await deliveredOrderId(tx, actor.userId, productId)),
      review: review ?? null,
    }
  })
}

export function saveProductReview(
  command: Command,
  productId: string,
  input: ProductReviewInput,
) {
  return executeCommand(command, async (tx, actor) => {
    const orderId = await deliveredOrderId(tx, actor.userId, productId)
    if (!orderId)
      fail(
        403,
        'PRODUCT_REVIEW_NOT_ELIGIBLE',
        'Only customers who received this product can review it',
      )
    // A hidden review stays hidden when its author edits it.
    const [review] = await tx
      .insert(productReviews)
      .values({ productId, userId: actor.userId, orderId, ...input })
      .onConflictDoUpdate({
        target: [productReviews.productId, productReviews.userId],
        set: { ...input, updatedAt: sql`clock_timestamp()` },
      })
      .returning({ id: productReviews.id })
    if (!review)
      fail(503, 'PRODUCT_REVIEW_UNAVAILABLE', 'Review could not be saved')
    return { reviewId: review.id }
  })
}

export function askProductQuestion(
  command: Command,
  productId: string,
  input: ProductQuestionInput,
) {
  return executeCommand(command, async (tx, actor) => {
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.active, true)))
    if (!product) fail(404, 'PRODUCT_NOT_FOUND', 'Product was not found')
    const [pending] = await tx
      .select({ total: count() })
      .from(productQuestions)
      .where(
        and(
          eq(productQuestions.userId, actor.userId),
          eq(productQuestions.status, 'pending'),
        ),
      )
    if ((pending?.total ?? 0) >= MAX_PENDING_QUESTIONS)
      fail(
        409,
        'PRODUCT_QUESTION_LIMIT_REACHED',
        'Wait for your open questions to be answered',
      )
    const [question] = await tx
      .insert(productQuestions)
      .values({ productId, userId: actor.userId, question: input.question })
      .returning({ id: productQuestions.id })
    if (!question)
      fail(503, 'PRODUCT_QUESTION_UNAVAILABLE', 'Question could not be saved')
    return { questionId: question.id }
  })
}

export async function staffProductReviews(
  userId: string,
  input: ProductFeedbackListInput,
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'staff')
    const filter =
      input.status === 'published' || input.status === 'hidden'
        ? eq(productReviews.status, input.status)
        : undefined
    const [items, [totals]] = await Promise.all([
      tx
        .select({
          id: productReviews.id,
          rating: productReviews.rating,
          comment: productReviews.comment,
          status: productReviews.status,
          createdAt: productReviews.createdAt,
          productId: productReviews.productId,
          productName: products.name,
          authorName: user.name,
          authorEmail: user.email,
        })
        .from(productReviews)
        .innerJoin(products, eq(products.id, productReviews.productId))
        .innerJoin(user, eq(user.id, productReviews.userId))
        .where(filter)
        .orderBy(desc(productReviews.createdAt), desc(productReviews.id))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ total: count() }).from(productReviews).where(filter),
    ])
    return {
      items,
      limit: input.limit,
      offset: input.offset,
      total: totals?.total ?? 0,
    }
  })
}

export function decideProductReview(
  command: Command,
  reviewId: string,
  input: ProductReviewDecisionInput,
) {
  return executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      const [review] = await tx
        .update(productReviews)
        .set({
          status: input.status,
          moderatedBy: actor.userId,
          moderatedAt: sql`clock_timestamp()`,
        })
        .where(eq(productReviews.id, reviewId))
        .returning({ id: productReviews.id })
      if (!review) fail(404, 'PRODUCT_REVIEW_NOT_FOUND', 'Review was not found')
      return { reviewId }
    },
  )
}

export async function staffProductQuestions(
  userId: string,
  input: ProductFeedbackListInput,
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'staff')
    const filter =
      input.status === 'pending' ||
      input.status === 'answered' ||
      input.status === 'hidden'
        ? eq(productQuestions.status, input.status)
        : undefined
    const [items, [totals]] = await Promise.all([
      tx
        .select({
          id: productQuestions.id,
          question: productQuestions.question,
          answer: productQuestions.answer,
          status: productQuestions.status,
          createdAt: productQuestions.createdAt,
          answeredAt: productQuestions.answeredAt,
          productId: productQuestions.productId,
          productName: products.name,
          authorName: user.name,
          authorEmail: user.email,
        })
        .from(productQuestions)
        .innerJoin(products, eq(products.id, productQuestions.productId))
        .innerJoin(user, eq(user.id, productQuestions.userId))
        .where(filter)
        .orderBy(desc(productQuestions.createdAt), desc(productQuestions.id))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ total: count() }).from(productQuestions).where(filter),
    ])
    return {
      items,
      limit: input.limit,
      offset: input.offset,
      total: totals?.total ?? 0,
    }
  })
}

export function decideProductQuestion(
  command: Command,
  questionId: string,
  input: ProductQuestionDecisionInput,
) {
  return executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      const [existing] = await tx
        .select({
          answer: productQuestions.answer,
          answeredBy: productQuestions.answeredBy,
        })
        .from(productQuestions)
        .where(eq(productQuestions.id, questionId))
        .for('update')
      if (!existing)
        fail(404, 'PRODUCT_QUESTION_NOT_FOUND', 'Question was not found')
      if (input.action === 'restore' && !existing.answer)
        fail(
          409,
          'PRODUCT_QUESTION_UNANSWERED',
          'Answer the question before showing it',
        )
      await tx
        .update(productQuestions)
        .set(
          input.action === 'answer'
            ? {
                status: 'answered',
                answer: input.answer,
                answeredBy: actor.userId,
                answeredAt: sql`clock_timestamp()`,
              }
            : { status: input.action === 'hide' ? 'hidden' : 'answered' },
        )
        .where(eq(productQuestions.id, questionId))
      return { questionId }
    },
  )
}
