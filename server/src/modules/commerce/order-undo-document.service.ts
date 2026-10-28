import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../config/db.js'
import { orders, orderUndoDocuments } from '../../db/schema.js'
import type { orderUndoSchema } from './commerce.contracts.js'
import {
  assertOrderAccess,
  fail,
  type Order,
  resolveActor,
  type Transaction,
} from './commerce.persistence.js'
import type { Actor } from './commerce.types.js'

type DocumentInput = Extract<
  z.infer<typeof orderUndoSchema>,
  { action: 'handover' | 'delivery' }
>

function decodeDocument(input: DocumentInput['evidenceDocument']) {
  const content = Buffer.from(input.contentBase64, 'base64')
  if (
    content.length < 16 ||
    content.length > 512 * 1024 ||
    content.toString('base64') !== input.contentBase64
  )
    fail(422, 'ORDER_UNDO_DOCUMENT_INVALID', 'Provide a file up to 512 KiB')
  // The supplied MIME type and extension are not trusted. Documents are always
  // downloaded as attachments, never rendered as active content by this server.
  const matchesFormat =
    input.mediaType === 'application/pdf'
      ? /^%PDF-(1\.[0-7]|2\.0)/.test(
          content.subarray(0, 8).toString('ascii'),
        ) &&
        /%%EOF\s*$/.test(content.subarray(-1024).toString('ascii')) &&
        /\.pdf$/i.test(input.fileName)
      : input.mediaType === 'image/png'
        ? content
            .subarray(0, 8)
            .equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
          content
            .subarray(-12)
            .equals(Buffer.from('0000000049454e44ae426082', 'hex')) &&
          /\.png$/i.test(input.fileName)
        : content.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) &&
          content.subarray(-2).equals(Buffer.from('ffd9', 'hex')) &&
          /\.jpe?g$/i.test(input.fileName)
  if (!matchesFormat)
    fail(422, 'ORDER_UNDO_DOCUMENT_INVALID', 'Provide a PDF, PNG or JPEG file')
  return content
}

export async function saveOrderUndoDocument(
  tx: Transaction,
  actor: Actor,
  order: Order,
  input: DocumentInput,
) {
  if (actor.role !== 'admin')
    fail(
      403,
      'ORDER_UNDO_ADMIN_REQUIRED',
      'Only administrators can verify a correction',
    )
  const content = decodeDocument(input.evidenceDocument)
  const [document] = await tx
    .insert(orderUndoDocuments)
    .values({
      orderId: order.id,
      orderRevision: order.revision,
      action: input.action,
      fileName: input.evidenceDocument.fileName,
      mediaType: input.evidenceDocument.mediaType,
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
      uploadedBy: actor.userId,
    })
    .returning({
      id: orderUndoDocuments.id,
      fileName: orderUndoDocuments.fileName,
      mediaType: orderUndoDocuments.mediaType,
      sha256: orderUndoDocuments.sha256,
      createdAt: orderUndoDocuments.createdAt,
    })
  if (!document)
    fail(500, 'ORDER_UNDO_DOCUMENT_SAVE_FAILED', 'Could not save the document')
  return {
    id: document.id,
    fileName: document.fileName,
    mediaType: document.mediaType,
    sha256: document.sha256,
    sizeBytes: content.length,
    uploadedBy: actor.userId,
    uploadedAt: document.createdAt.toISOString(),
    orderRevision: order.revision,
    action: input.action,
  }
}

export function getOrderUndoDocument(
  userId: string,
  orderId: string,
  documentId: string,
) {
  return db.transaction(async (tx) => {
    const actor = await resolveActor(tx, userId, 'workforce')
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId))
    if (!order || (order.deletedAt && actor.role !== 'admin'))
      fail(404, 'ORDER_NOT_FOUND', 'Order was not found')
    assertOrderAccess(actor, order)
    const [document] = await tx
      .select()
      .from(orderUndoDocuments)
      .where(
        and(
          eq(orderUndoDocuments.id, documentId),
          eq(orderUndoDocuments.orderId, orderId),
        ),
      )
    if (!document)
      fail(
        404,
        'ORDER_UNDO_DOCUMENT_NOT_FOUND',
        'Correction document was not found',
      )
    return document
  })
}
