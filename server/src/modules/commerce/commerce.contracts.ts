import { z } from 'zod'
import {
  catalogCategoryCodes,
  productCategoryCodes,
} from './catalog-taxonomy.js'
import {
  MAX_ACTIVE_ORDERS,
  MAX_LINES,
  MAX_QUANTITY,
  MAX_VND,
} from './commerce.types.js'

export const idSchema = z.uuid().transform((value) => value.toLowerCase())
const note = z.string().trim().min(3).max(1000)
const reference = z.string().trim().min(3).max(200)
const remittanceNote = z
  .string()
  .trim()
  .max(1000)
  .transform((value) => value || undefined)
  .optional()
const money = z.number().int().min(1).max(MAX_VND)
const quantity = z.number().int().min(1).max(MAX_QUANTITY)
const productCategorySchema = z.enum(productCategoryCodes)
const productBrandSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
export const emptySchema = z.strictObject({})
export const recipientSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{8,15}$/),
  addressLine: z.string().trim().min(5).max(300),
  ward: z.string().trim().min(1).max(100),
  district: z.string().trim().max(100).default(''),
  province: z.string().trim().min(1).max(100),
})

export const paginationSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
})
const afterSaleListSchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  createdOn: z.iso.date().optional(),
})
export const returnListSchema = afterSaleListSchema.extend({
  view: z.enum(['pending', 'closed', 'all']).default('pending'),
  status: z
    .enum([
      'requested',
      'approved',
      'receiving',
      'received',
      'rejected',
      'withdrawn',
      'closed',
    ])
    .optional(),
  responsibility: z.enum(['customer', 'store', 'carrier']).optional(),
})
export type ReturnListInput = z.infer<typeof returnListSchema>
export const refundListSchema = afterSaleListSchema.extend({
  view: z.enum(['pending', 'settled', 'all']).default('pending'),
  status: z
    .enum([
      'awaiting_payment',
      'pending',
      'processing',
      'unknown',
      'needs_review',
      'partially_settled',
      'settled',
      'voided',
    ])
    .optional(),
  reason: z
    .enum(['cancellation', 'return', 'return_to_sender', 'overpayment'])
    .optional(),
})
export type RefundListInput = z.infer<typeof refundListSchema>
export const productListSchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
})
const catalogPrice = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform((value) => Number(value))
  .pipe(z.number().int().min(0).max(MAX_VND))
  .optional()
export const catalogFacetSchema = productListSchema.pick({ q: true })
export const catalogListSchema = productListSchema
  .extend({
    category: z.enum(catalogCategoryCodes).optional(),
    brand: productBrandSchema.optional(),
    minPrice: catalogPrice,
    maxPrice: catalogPrice,
    discounted: z.literal('true').optional(),
  })
  .refine(
    (input) =>
      input.minPrice === undefined ||
      input.maxPrice === undefined ||
      input.minPrice <= input.maxPrice,
    {
      message: 'Minimum price must not exceed maximum price',
      path: ['maxPrice'],
    },
  )
export type CatalogListInput = z.infer<typeof catalogListSchema>

export const staffUserListSchema = productListSchema.extend({
  assignable: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})
export const orderListSchema = paginationSchema.extend({
  deletion: z.enum(['active', 'deleted', 'all']).optional(),
  q: z.string().trim().max(120).optional(),
  paymentMethod: z.enum(['cod', 'bank_transfer']).optional(),
  assignment: z.enum(['mine', 'unassigned']).optional(),
  assignmentOverdue: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  assignmentWaitingOverdue: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  assignmentDeadlineSoon: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  assignmentHandoverReview: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  placedOn: z.iso.date().optional(),
  paymentReviewOverdue: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  bankTransferNoticePending: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  codReconciliationRequired: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  paymentReviewRequired: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  status: z
    .enum([
      'placed',
      'confirmed',
      'packing',
      'shipped',
      'delivered',
      'completed',
      'cancelled',
    ])
    .optional(),
})
const productDetailLine = z.string().trim().min(1).max(200)
const productVariantOptionsSchema = z
  .array(
    z.strictObject({
      name: z.string().trim().min(1).max(40),
      value: z.string().trim().min(1).max(60),
    }),
  )
  .max(3)
  .refine(
    (options) =>
      new Set(options.map((option) => option.name.toLowerCase())).size ===
      options.length,
    'Each variant option must have a different name',
  )
const productSpecificationGroupSchema = z.strictObject({
  title: z.string().trim().min(1).max(80),
  rows: z
    .array(
      z.strictObject({
        label: z.string().trim().min(1).max(80),
        value: z.string().trim().min(1).max(300),
      }),
    )
    .min(1)
    .max(30),
})
const productFields = {
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000),
  overview: z.string().trim().min(1).max(10000).nullable(),
  category: productCategorySchema.nullable(),
  brand: productBrandSchema.nullable(),
  priceVnd: money,
  listPriceVnd: money.nullable(),
  highlights: z.array(productDetailLine).max(8),
  specifications: z.array(productSpecificationGroupSchema).max(12),
  packageContents: z.array(productDetailLine).max(20),
  warrantyMonths: z.number().int().min(1).max(120).nullable(),
  variantGroup: productBrandSchema.nullable(),
  variantOptions: productVariantOptionsSchema,
  variantRank: z.number().int().min(0).max(9999),
  active: z.boolean(),
}
export const productCreateSchema = z.strictObject({
  sku: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .transform((value) => value.toUpperCase()),
  ...productFields,
  category: productCategorySchema,
  description: productFields.description.default(''),
  overview: productFields.overview.default(null),
  listPriceVnd: productFields.listPriceVnd.default(null),
  highlights: productFields.highlights.default([]),
  specifications: productFields.specifications.default([]),
  packageContents: productFields.packageContents.default([]),
  warrantyMonths: productFields.warrantyMonths.default(null),
  variantGroup: productFields.variantGroup.default(null),
  variantOptions: productFields.variantOptions.default([]),
  variantRank: productFields.variantRank.default(0),
  active: productFields.active.default(true),
})
export const productUpdateSchema = z
  .strictObject(productFields)
  .partial()
  .extend({
    expectedVersion: z.number().int().min(1),
  })
  .refine(
    (value) => Object.keys(value).length > 1,
    'At least one product field is required',
  )
export const productImageUploadSchema = z.strictObject({
  mediaType: z.enum(['image/webp', 'image/jpeg', 'image/png']),
  contentBase64: z.string().min(24).max(699052),
  altText: z.string().trim().min(1).max(200),
})
export const productImageOrderSchema = z.strictObject({
  imageIds: z.array(idSchema).min(1).max(8),
})
export const productReviewSchema = z.strictObject({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(10).max(2000),
})
export const productReviewListSchema = paginationSchema.extend({
  rating: z.coerce.number().int().min(1).max(5).optional(),
})
export const productQuestionSchema = z.strictObject({
  question: z.string().trim().min(5).max(1000),
})
export const productFeedbackListSchema = paginationSchema.extend({
  status: z.enum(['published', 'pending', 'answered', 'hidden']).optional(),
})
export const productReviewDecisionSchema = z.strictObject({
  status: z.enum(['published', 'hidden']),
})
export const productQuestionDecisionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('answer'),
    answer: z.string().trim().min(2).max(2000),
  }),
  z.strictObject({ action: z.literal('hide') }),
  z.strictObject({ action: z.literal('restore') }),
])
const storeFields = {
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(300),
  province: z.string().trim().min(1).max(100),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 .-]{6,20}$/)
    .nullable(),
  openingHours: z.string().trim().min(1).max(120).nullable(),
  active: z.boolean(),
}
export const storeCreateSchema = z.strictObject({
  ...storeFields,
  active: storeFields.active.default(true),
})
export const storeUpdateSchema = z
  .strictObject(storeFields)
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one store field is required',
  )
export const storeAvailabilitySchema = z.strictObject({
  status: z.enum(['in_stock', 'low_stock', 'out_of_stock']).nullable(),
})
export const stockAdjustmentSchema = z.strictObject({
  delta: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0),
  reason: note,
  reference,
})
export const cartItemSchema = z.strictObject({
  quantity: z.number().int().min(0).max(MAX_QUANTITY),
  expectedVersion: z.number().int().min(0),
})

const purchaseItems = z
  .array(z.strictObject({ productId: idSchema, quantity }))
  .min(1)
  .max(MAX_LINES)
  .refine(
    (items) =>
      new Set(items.map((item) => item.productId)).size === items.length,
    'Duplicate products are not allowed',
  )
  .transform((items) =>
    items.sort((a, b) => a.productId.localeCompare(b.productId)),
  )
const checkoutFields = {
  recipient: recipientSchema,
  deliveryMethod: z.literal('standard'),
  paymentMethod: z.enum(['cod', 'bank_transfer']),
}
export const checkoutSchema = z.discriminatedUnion('source', [
  z.strictObject({
    ...checkoutFields,
    source: z.literal('cart'),
    cartVersion: z.number().int().min(0),
  }),
  z.strictObject({
    ...checkoutFields,
    source: z.literal('buy_now'),
    items: purchaseItems,
  }),
])
export const placeOrderSchema = z.strictObject({ quoteId: idSchema })
export const addressUpdateSchema = z.strictObject({
  recipient: recipientSchema,
  expectedRevision: z.number().int().min(1),
})
export const reasonSchema = z.strictObject({ reason: note })
export const orderDeletionSchema = reasonSchema.extend({
  expectedRevision: z.number().int().min(1),
})
export const orderRevisionSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
})
const orderUndoFields = {
  ...orderRevisionSchema.shape,
  reason: note,
}
const orderUndoDocumentSchema = z.strictObject({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine(
      (value) =>
        !value.includes('/') &&
        !value.includes('\\') &&
        [...value].every(
          (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
        ),
      { message: 'File names must not contain paths or control characters' },
    ),
  mediaType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
  contentBase64: z.string().min(24).max(699052),
})
export const orderUndoSchema = z.discriminatedUnion('action', [
  z.strictObject({
    ...orderUndoFields,
    action: z.literal('confirmation'),
    confirmationRenewal: z
      .strictObject({
        hours: z.number().int().min(1).max(168),
        confirmed: z.literal(true),
      })
      .optional(),
  }),
  z.strictObject({
    ...orderUndoFields,
    action: z.literal('packing'),
  }),
  z.strictObject({
    ...orderUndoFields,
    action: z.literal('handover'),
    evidenceDocument: orderUndoDocumentSchema,
    goodsInWarehouse: z.literal(true),
  }),
  z.strictObject({
    ...orderUndoFields,
    action: z.literal('delivery'),
    evidenceDocument: orderUndoDocumentSchema,
    deliveryRecordedIncorrectly: z.literal(true),
  }),
])
export const assignmentSchema = z.strictObject({
  userId: z.string().trim().min(1).max(200),
  expectedRevision: z.number().int().min(1),
  reason: note,
})
export const staffOrderSettingsSchema = z
  .strictObject({
    enabled: z.boolean(),
    acceptingOrders: z.boolean(),
    maxActiveOrders: z.number().int().min(1).max(MAX_ACTIVE_ORDERS),
    shiftEndsAt: z.iso.datetime({ offset: true }).nullable(),
    expectedRevision: z.number().int().min(0),
    reason: note,
  })
  .refine((value) => value.enabled || !value.acceptingOrders, {
    message: 'Enable automatic assignment before accepting orders',
    path: ['acceptingOrders'],
  })
  .refine((value) => !value.acceptingOrders || value.shiftEndsAt !== null, {
    message: 'Choose a shift end before accepting orders',
    path: ['shiftEndsAt'],
  })
export const packingChecklistSchema = z.strictObject({
  productsChecked: z.literal(true),
  conditionChecked: z.literal(true),
  packagingChecked: z.literal(true),
})
export const waybillVerificationSchema = z.strictObject({
  recipientVerified: z.literal(true),
  paymentVerified: z.literal(true),
})
export const waybillSchema = z.strictObject({
  ...orderRevisionSchema.shape,
  carrierId: idSchema,
  trackingReference: reference,
  ...waybillVerificationSchema.shape,
})
export const waybillCorrectionSchema = waybillSchema.extend({
  shipmentId: idSchema,
  reason: note,
})
const optionalWaybillVerification = {
  recipientVerified: z.literal(true).optional(),
  paymentVerified: z.literal(true).optional(),
}
export const savedWaybillVerificationSchema = orderRevisionSchema
  .extend({
    shipmentId: idSchema,
    ...optionalWaybillVerification,
  })
  .refine((input) => input.recipientVerified || input.paymentVerified, {
    message: 'Select at least one verification to record',
  })
export const dispatchSchema = waybillSchema
  .omit({
    recipientVerified: true,
    paymentVerified: true,
  })
  .extend({
    ...optionalWaybillVerification,
    packingChecklist: packingChecklistSchema,
  })
export const carrierRecipientResultSchema = z.strictObject({
  ...orderRevisionSchema.shape,
  shipmentId: idSchema,
  carrierId: idSchema,
  trackingReference: reference,
  recipient: recipientSchema,
  outcome: z.enum(['accepted', 'rejected']),
  reference,
  reason: note,
  confirmedAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value)),
  evidenceVerified: z.literal(true),
})
export const shipmentCarrierSchema = z.strictObject({
  carrierId: idSchema,
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  evidenceReference: reference,
  reason: note,
  evidenceVerified: z.literal(true),
  codReconciliation: z
    .strictObject({
      evidenceReference: reference,
      evidenceVerified: z.literal(true),
    })
    .optional(),
  responsibilityCorrection: z
    .strictObject({
      expectedDecisionId: idSchema,
      reference,
      evidenceVerified: z.literal(true),
    })
    .optional(),
})
export const deliverySchema = z.strictObject({
  ...orderRevisionSchema.shape,
  proofReference: reference.optional(),
  deliveredAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value)),
})
export const deliveryRetrySchema = orderRevisionSchema.extend({
  shipmentId: idSchema,
  reason: note,
  reference: reference.optional(),
})
export const paymentSchema = z.strictObject({
  method: z.enum(['cod', 'bank_transfer']),
  source: z.literal('customer'),
  receivingAccountId: idSchema,
  amountVnd: money,
  currency: z.literal('VND'),
  reference,
  receivedAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value)),
  receiptVerified: z.literal(true),
})
export const bankTransferReportSchema = z.strictObject({
  amountVnd: money,
  currency: z.literal('VND'),
  reference,
  transferredAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value)),
  evidenceReference: reference.optional(),
  note: note.optional(),
})
export const bankTransferNoticeReviewSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('recorded'),
    paymentId: idSchema,
    reason: note,
    evidenceReference: reference,
    evidenceVerified: z.literal(true),
  }),
  z.strictObject({
    outcome: z.literal('not_found'),
    statementCheckedThrough: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
    reason: note,
    evidenceReference: reference,
    evidenceVerified: z.literal(true),
  }),
])
export const collectionResolutionSchema = z.strictObject({
  party: z.enum(['customer', 'carrier']).default('customer'),
  disposition: z.enum(['debt', 'written_off']),
  amountVnd: money,
  responsibleParty: z.string().trim().min(3).max(200),
  reference,
  reason: note,
  evidenceVerified: z.literal(true),
})
export const collectionFailureSchema = reasonSchema.extend({
  party: z.enum(['customer', 'carrier']).default('customer'),
})
export const codCollectionSchema = paymentSchema
  .omit({ method: true, source: true, receivingAccountId: true })
  .extend({
    carrierId: idSchema,
  })
export const carrierCreateSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().trim().min(2).max(200),
})
const classificationEvidence = {
  reason: note,
  evidenceReference: reference,
  evidenceVerified: z.literal(true),
}
const allocationLineSchema = z
  .strictObject({
    orderId: idSchema,
    amountVnd: money,
    collectionId: idSchema.optional(),
    purpose: z.enum(['payment', 'refund_recovery']).optional(),
    reviewId: idSchema.optional(),
  })
  .refine(
    (value) =>
      value.purpose === 'refund_recovery'
        ? value.reviewId !== undefined && value.collectionId === undefined
        : value.reviewId === undefined,
    'Refund recovery requires its review ID and cannot reference a carrier collection',
  )
const allocationPlanSchema = z
  .array(allocationLineSchema)
  .max(100)
  .refine(
    (items) =>
      new Set(
        items.map(
          (item) =>
            `${item.orderId}:${item.collectionId ?? 'customer'}:${item.purpose ?? 'payment'}`,
        ),
      ).size === items.length,
    'Each order or collection can occur only once in an allocation plan',
  )
export const paymentAllocationAdjustmentSchema = z.strictObject({
  ...classificationEvidence,
  expectedRevision: z.number().int().min(1),
  allocations: allocationPlanSchema,
})
export const paymentReceiptCreateSchema = paymentSchema
  .omit({ source: true, method: true })
  .extend({
    // Accepted for old callers as recording metadata; eligibility is per allocation.
    method: paymentSchema.shape.method.optional(),
    source: z.enum(['customer', 'carrier']),
    remittanceNote,
    bankTransferNotice: z
      .strictObject({ orderId: idSchema, noticeId: idSchema })
      .optional(),
    ...classificationEvidence,
    allocations: allocationPlanSchema.pipe(
      z.array(allocationLineSchema).min(1),
    ),
  })
export const paymentBalanceReviewDecisionSchema = z.strictObject({
  ...classificationEvidence,
  expectedRevision: z.number().int().min(1),
  disposition: z.enum(['debt', 'written_off']),
  amountVnd: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  responsibleParty: z.string().trim().min(3).max(200),
  allowFulfillment: z.boolean().default(false),
})
export const paymentBalanceReviewListSchema = paginationSchema.extend({
  status: z
    .enum(['needs_review', 'debt', 'written_off', 'resolved'])
    .optional(),
})
export const refundRecoveryReceiptSchema = paymentSchema
  .omit({ method: true, source: true })
  .extend({
    ...classificationEvidence,
    expectedRevision: z.number().int().min(1),
  })
const canonicalAccountPart = (maximum: number) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => value.replace(/\s+/g, ''))
    .pipe(
      z
        .string()
        .min(1)
        .max(maximum)
        .regex(/^[a-z0-9][a-z0-9._-]*$/),
    )
const receivingAccountFields = {
  accountReference: canonicalAccountPart(100),
  name: z.string().trim().min(2).max(200),
}
export const receivingAccountCreateSchema = z.discriminatedUnion('channel', [
  z.strictObject({
    ...receivingAccountFields,
    channel: z.literal('bank_transfer'),
    providerCode: z
      .string()
      .regex(/^[0-9]{6}$/, 'Select a bank from the supported directory'),
  }),
  z.strictObject({
    ...receivingAccountFields,
    channel: z.literal('cash'),
    providerCode: canonicalAccountPart(64).pipe(z.string().min(2)),
  }),
])
export const receivingAccountListSchema = paginationSchema.extend({
  channel: z.enum(['bank_transfer', 'cash']).optional(),
  q: z.string().trim().max(120).optional(),
})
export const paymentReceiptReconciliationSchema = z.strictObject({
  ...classificationEvidence,
  receivingAccountId: idSchema,
  expectedRevision: z.number().int().min(1),
  duplicateOfId: idSchema.optional(),
  verifiedAmountVnd: money,
  allocations: allocationPlanSchema.optional(),
  verifiedReceivedAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value)),
})
export const paymentClassificationSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('customer'), ...classificationEvidence }),
  z.strictObject({
    source: z.literal('carrier'),
    collectionId: idSchema,
    ...classificationEvidence,
  }),
])
export const codCollectionReconciliationSchema = z.strictObject({
  ...classificationEvidence,
  verifiedAmountVnd: money,
  verifiedReceivedAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value)),
})
export const codCollectionAdjustmentSchema =
  codCollectionReconciliationSchema.extend({
    expectedRevision: z.number().int().min(1),
    crossCarrierMerge: z
      .strictObject({
        carrierId: idSchema,
        evidenceVerified: z.literal(true),
        expectedCollections: z
          .array(
            z.strictObject({ id: idSchema, revision: z.number().int().min(1) }),
          )
          .min(2)
          .max(1000)
          .refine(
            (items) =>
              new Set(items.map((item) => item.id)).size === items.length,
            'Collection IDs must be unique',
          ),
      })
      .optional(),
    legacyRemittanceIds: z
      .array(idSchema)
      .max(1000)
      .default([])
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'Legacy receipt IDs must be unique',
      ),
    expectedRemittances: z
      .array(
        z.strictObject({
          paymentId: idSchema,
          allocationId: idSchema,
          revision: z.number().int().min(1),
        }),
      )
      .max(1000)
      .refine(
        (items) =>
          new Set(items.map((item) => item.allocationId)).size === items.length,
        'Remittance IDs must be unique',
      ),
    remittanceAllocations: z
      .array(
        z.strictObject({
          allocationId: idSchema,
          collectionId: idSchema,
          amountVnd: z.number().int().min(0).max(MAX_VND).optional(),
        }),
      )
      .max(1000)
      .default([])
      .refine(
        (items) =>
          new Set(items.map((item) => item.allocationId)).size === items.length,
        'Each remittance can have only one allocation',
      ),
  })
const carrierRemittanceFields = paymentSchema
  .omit({ method: true, source: true })
  .extend({ remittanceNote })
const carrierRemittanceAllocations = z
  .array(
    z.strictObject({
      orderId: idSchema,
      collectionId: idSchema,
      amountVnd: money,
    }),
  )
  .min(1)
  .max(100)
  .refine(
    (items) =>
      new Set(items.map((item) => item.collectionId)).size === items.length,
    'Each carrier collection can occur only once in a remittance',
  )
export const carrierRemittanceSchema = z.union([
  // Preserve the single-collection contract for existing callers.
  carrierRemittanceFields.extend({ collectionId: idSchema }),
  carrierRemittanceFields.extend({ allocations: carrierRemittanceAllocations }),
])
export const bankReconciliationSchema = z.strictObject({
  outcome: z.enum(['cancel_unpaid', 'accept_late_payment']),
  statementReference: reference,
  statementCheckedThrough: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value)),
  verifiedOnTimeReceivedVnd: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER),
  evidenceVerified: z.literal(true),
  reason: note,
})
export const returnApprovalSchema = reasonSchema.extend({
  responsibility: z.enum(['customer', 'store', 'carrier']),
})
const returnItems = z
  .array(z.strictObject({ orderItemId: idSchema, quantity }))
  .min(1)
  .max(MAX_LINES)
  .refine(
    (items) =>
      new Set(items.map((item) => item.orderItemId)).size === items.length,
    'Duplicate order items are not allowed',
  )
  .transform((items) =>
    items.sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)),
  )
export const returnRequestSchema = z.strictObject({
  reason: note,
  items: returnItems,
})
function receivedItems(minimumQuantity: 0 | 1) {
  return z
    .array(
      z
        .strictObject({
          orderItemId: idSchema,
          quantity: z.number().int().min(minimumQuantity).max(MAX_QUANTITY),
          resellableQuantity: z.number().int().min(0).max(MAX_QUANTITY),
        })
        .refine(
          (value) => value.resellableQuantity <= value.quantity,
          'Resellable quantity exceeds received quantity',
        ),
    )
    .min(1)
    .max(MAX_LINES)
    .refine(
      (items) =>
        new Set(items.map((item) => item.orderItemId)).size === items.length,
      'Duplicate order items are not allowed',
    )
    .transform((items) =>
      items.sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)),
    )
}
export const returnReceiptSchema = z.strictObject({
  proofReference: reference,
  items: receivedItems(1),
})
export const shipmentReturnSchema = z.strictObject({
  proofReference: reference.optional(),
  reason: note,
  items: receivedItems(0),
})
export const refundOutcomeSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('unknown'), reason: note }),
  z.strictObject({
    outcome: z.literal('not_sent'),
    reason: note,
    nonSettlementVerified: z.literal(true),
  }),
  z.strictObject({
    outcome: z.literal('settled'),
    amountVnd: money,
    currency: z.literal('VND'),
    method: z.enum(['bank_transfer', 'cash']),
    reference,
    settledAt: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
    receiptVerified: z.literal(true),
    remainderNotSentVerified: z.literal(true).optional(),
  }),
])
export const refundAttemptSchema = z.strictObject({
  amountVnd: money.optional(),
})
export const refundExceptionSettlementSchema = z.strictObject({
  ...classificationEvidence,
  amountVnd: money,
  currency: z.literal('VND'),
  method: z.enum(['bank_transfer', 'cash']),
  reference,
  settledAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value)),
  receiptVerified: z.literal(true),
  remainderNotSentVerified: z.literal(true).optional(),
})
export const manualRefundAttemptSchema = refundAttemptSchema.extend({
  reason: note,
})
export const roleUpdateSchema = z.strictObject({
  role: z.enum(['customer', 'staff', 'accountant', 'admin']),
  reason: note,
})

export type CheckoutInput = z.infer<typeof checkoutSchema>
export type DispatchInput = z.infer<typeof dispatchSchema>
export type DeliveryRetryInput = z.infer<typeof deliveryRetrySchema>
export type WaybillInput = z.infer<typeof waybillSchema>
export type WaybillCorrectionInput = z.infer<typeof waybillCorrectionSchema>
export type SavedWaybillVerificationInput = z.infer<
  typeof savedWaybillVerificationSchema
>
export type CarrierRecipientResultInput = z.infer<
  typeof carrierRecipientResultSchema
>
export type ShipmentCarrierInput = z.infer<typeof shipmentCarrierSchema>
export type ProductCreateInput = z.infer<typeof productCreateSchema>
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>
export type ProductImageUploadInput = z.infer<typeof productImageUploadSchema>
export type ProductImageOrderInput = z.infer<typeof productImageOrderSchema>
export type ProductReviewInput = z.infer<typeof productReviewSchema>
export type ProductReviewListInput = z.infer<typeof productReviewListSchema>
export type ProductQuestionInput = z.infer<typeof productQuestionSchema>
export type ProductFeedbackListInput = z.infer<typeof productFeedbackListSchema>
export type ProductReviewDecisionInput = z.infer<
  typeof productReviewDecisionSchema
>
export type ProductQuestionDecisionInput = z.infer<
  typeof productQuestionDecisionSchema
>
export type StoreCreateInput = z.infer<typeof storeCreateSchema>
export type StoreUpdateInput = z.infer<typeof storeUpdateSchema>
export type StoreAvailabilityInput = z.infer<typeof storeAvailabilitySchema>
export type PaymentInput = z.infer<typeof paymentSchema>
export type BankTransferReportInput = z.infer<typeof bankTransferReportSchema>
export type BankTransferNoticeReviewInput = z.infer<
  typeof bankTransferNoticeReviewSchema
>
export type PaymentReceiptCreateInput = z.infer<
  typeof paymentReceiptCreateSchema
>
export type PaymentAllocationAdjustmentInput = z.infer<
  typeof paymentAllocationAdjustmentSchema
>
export type PaymentAllocationInput = z.infer<typeof allocationLineSchema>
export type PaymentBalanceReviewDecisionInput = z.infer<
  typeof paymentBalanceReviewDecisionSchema
>
export type RefundRecoveryReceiptInput = z.infer<
  typeof refundRecoveryReceiptSchema
>
export type ReceivingAccountCreateInput = z.infer<
  typeof receivingAccountCreateSchema
>
export type ReceivingAccountListInput = z.infer<
  typeof receivingAccountListSchema
>
export type PaymentReceiptReconciliationInput = z.infer<
  typeof paymentReceiptReconciliationSchema
>
export type CodCollectionAdjustmentInput = z.infer<
  typeof codCollectionAdjustmentSchema
>
export type CollectionResolutionInput = z.infer<
  typeof collectionResolutionSchema
>
export type RefundOutcomeInput = z.infer<typeof refundOutcomeSchema>
export type RefundExceptionSettlementInput = z.infer<
  typeof refundExceptionSettlementSchema
>
export type CodCollectionInput = z.infer<typeof codCollectionSchema>
export type CarrierRemittanceInput = z.infer<typeof carrierRemittanceSchema>
export type BankReconciliationInput = z.infer<typeof bankReconciliationSchema>
export type PaymentClassificationInput = z.infer<
  typeof paymentClassificationSchema
>
