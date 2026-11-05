import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../config/db.js'
import { productImages } from '../../db/schema.js'
import type {
  ProductImageOrderInput,
  ProductImageUploadInput,
} from './commerce.contracts.js'
import {
  type Command,
  executeCommand,
  fail,
  resolveActor,
  type Transaction,
} from './commerce.persistence.js'
import { lockProducts } from './inventory.service.js'

const MAX_PRODUCT_IMAGES = 8
const MAX_IMAGE_BYTES = 512 * 1024

const imageColumns = {
  id: productImages.id,
  productId: productImages.productId,
  altText: productImages.altText,
  position: productImages.position,
}

function decodeImage(input: ProductImageUploadInput) {
  const content = Buffer.from(input.contentBase64, 'base64')
  if (
    content.length < 16 ||
    content.length > MAX_IMAGE_BYTES ||
    content.toString('base64') !== input.contentBase64
  )
    fail(422, 'PRODUCT_IMAGE_INVALID', 'Provide an image up to 512 KiB')
  // The declared media type is not trusted: the bytes are served back publicly.
  const matchesFormat =
    input.mediaType === 'image/png'
      ? content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : input.mediaType === 'image/jpeg'
        ? content.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
        : content.subarray(0, 4).toString('ascii') === 'RIFF' &&
          content.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!matchesFormat)
    fail(422, 'PRODUCT_IMAGE_INVALID', 'Provide a JPEG, PNG or WebP image')
  return content
}

export function addProductImage(
  command: Command,
  productId: string,
  input: ProductImageUploadInput,
) {
  const content = decodeImage(input)
  return executeCommand(
    { ...command, permission: 'admin' },
    async (tx, actor) => {
      await lockProducts(tx, [productId])
      const existing = await tx
        .select({
          sha256: productImages.sha256,
          position: productImages.position,
        })
        .from(productImages)
        .where(eq(productImages.productId, productId))
      if (existing.length >= MAX_PRODUCT_IMAGES)
        fail(
          409,
          'PRODUCT_IMAGE_LIMIT_REACHED',
          'A product can have at most 8 images',
        )
      const sha256 = createHash('sha256').update(content).digest('hex')
      if (existing.some((image) => image.sha256 === sha256))
        fail(409, 'PRODUCT_IMAGE_DUPLICATE', 'This image was already uploaded')
      const [image] = await tx
        .insert(productImages)
        .values({
          productId,
          position: Math.max(-1, ...existing.map((item) => item.position)) + 1,
          altText: input.altText,
          mediaType: input.mediaType,
          content,
          sha256,
          uploadedBy: actor.userId,
        })
        .returning({ id: productImages.id })
      if (!image)
        fail(503, 'PRODUCT_IMAGE_UNAVAILABLE', 'Image could not be saved')
      return { imageId: image.id }
    },
  )
}

export function removeProductImage(
  command: Command,
  productId: string,
  imageId: string,
) {
  return executeCommand({ ...command, permission: 'admin' }, async (tx) => {
    await lockProducts(tx, [productId])
    const [image] = await tx
      .delete(productImages)
      .where(
        and(
          eq(productImages.id, imageId),
          eq(productImages.productId, productId),
        ),
      )
      .returning({ id: productImages.id })
    if (!image) fail(404, 'PRODUCT_IMAGE_NOT_FOUND', 'Image was not found')
    return { imageId }
  })
}

export function reorderProductImages(
  command: Command,
  productId: string,
  input: ProductImageOrderInput,
) {
  return executeCommand({ ...command, permission: 'admin' }, async (tx) => {
    await lockProducts(tx, [productId])
    const images = await tx
      .select({ id: productImages.id })
      .from(productImages)
      .where(eq(productImages.productId, productId))
    const known = new Set(images.map((image) => image.id))
    if (
      images.length !== input.imageIds.length ||
      input.imageIds.some((imageId) => !known.has(imageId))
    )
      fail(409, 'PRODUCT_IMAGES_CHANGED', 'Reload the images before reordering')
    await Promise.all(
      input.imageIds.map((imageId, position) =>
        tx
          .update(productImages)
          .set({ position })
          .where(eq(productImages.id, imageId)),
      ),
    )
    return { productId }
  })
}

export async function staffProductImages(userId: string, productId: string) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'staff')
    return {
      items: await tx
        .select(imageColumns)
        .from(productImages)
        .where(eq(productImages.productId, productId))
        .orderBy(asc(productImages.position), asc(productImages.id)),
    }
  })
}

export async function getProductImage(imageId: string) {
  const [image] = await db
    .select({
      content: productImages.content,
      mediaType: productImages.mediaType,
    })
    .from(productImages)
    .where(eq(productImages.id, imageId))
  if (!image) fail(404, 'PRODUCT_IMAGE_NOT_FOUND', 'Image was not found')
  return image
}

export async function listImagesForProducts(productIds: string[]) {
  if (productIds.length === 0) return []
  return db
    .select(imageColumns)
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(asc(productImages.position), asc(productImages.id))
}

export async function primaryImagesForProducts(
  productIds: string[],
  executor: Pick<Transaction, 'selectDistinctOn'> = db,
) {
  if (productIds.length === 0) return new Map<string, string>()
  const rows = await executor
    .selectDistinctOn([productImages.productId], {
      productId: productImages.productId,
      id: productImages.id,
    })
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(
      productImages.productId,
      sql`${productImages.position} asc`,
      productImages.id,
    )
  return new Map(rows.map((row) => [row.productId, row.id]))
}
