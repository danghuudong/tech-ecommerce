import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { productCategoryCodes } from '../modules/commerce/catalog-taxonomy.js'
import type {
  BankInstructions,
  CommandResult,
  QuoteLine,
  ReceiptLine,
  Recipient,
  StaffOrderSettingsValue,
} from '../modules/commerce/commerce.types.js'
import { user } from './auth.schema.js'

const time = (name: string) =>
  timestamp(name, { withTimezone: true })
    .default(sql`clock_timestamp()`)
    .notNull()
const money = (name: string) => bigint(name, { mode: 'number' }).notNull()
const binary = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category', { enum: productCategoryCodes }),
    brand: text('brand'),
    priceVnd: money('price_vnd'),
    stockOnHand: integer('stock_on_hand').default(0).notNull(),
    stockReserved: integer('stock_reserved').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    version: integer('version').default(1).notNull(),
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
  },
  (t) => [
    check('products_price_check', sql`${t.priceVnd} between 1 and 9999999999`),
    check(
      'products_stock_check',
      sql`${t.stockOnHand} >= 0 and ${t.stockReserved} between 0 and ${t.stockOnHand}`,
    ),
    check('products_version_check', sql`${t.version} > 0`),
    check(
      'products_category_check',
      sql`${t.category} in ('laptop', 'phone', 'desktop', 'monitor', 'audio', 'accessories', 'gaming', 'office')`,
    ),
    check(
      'products_active_category_check',
      sql`not ${t.active} or ${t.category} is not null`,
    ),
    check(
      'products_brand_check',
      sql`char_length(${t.brand}) between 1 and 80 and ${t.brand} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    index('products_catalog_idx').on(t.active, t.id),
    index('products_category_catalog_idx').on(t.active, t.category, t.id),
    index('products_brand_catalog_idx').on(t.active, t.brand, t.id),
  ],
)

export const carts = pgTable(
  'commerce_carts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    version: integer('version').default(0).notNull(),
    updatedAt: time('updated_at'),
  },
  (t) => [
    uniqueIndex('commerce_carts_user_idx').on(t.userId),
    check('commerce_carts_version_check', sql`${t.version} >= 0`),
  ],
)

export const cartItems = pgTable(
  'commerce_cart_items',
  {
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    uniqueIndex('commerce_cart_items_line_idx').on(t.cartId, t.productId),
    check(
      'commerce_cart_items_quantity_check',
      sql`${t.quantity} between 1 and 99`,
    ),
  ],
)

export const checkoutQuotes = pgTable(
  'commerce_checkout_quotes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    cartId: uuid('cart_id').references(() => carts.id),
    cartVersion: integer('cart_version'),
    lines: jsonb('lines').$type<QuoteLine[]>().notNull(),
    recipient: jsonb('recipient').$type<Recipient>().notNull(),
    paymentMethod: text('payment_method', {
      enum: ['cod', 'bank_transfer'],
    }).notNull(),
    bankInstructions: jsonb('bank_instructions').$type<BankInstructions>(),
    subtotalVnd: money('subtotal_vnd'),
    shippingFeeVnd: money('shipping_fee_vnd'),
    totalVnd: money('total_vnd'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedOrderId: uuid('accepted_order_id'),
    createdAt: time('created_at'),
  },
  (t) => [
    index('commerce_quotes_user_idx').on(t.userId, t.createdAt),
    check(
      'commerce_quotes_method_check',
      sql`${t.paymentMethod} in ('cod', 'bank_transfer')`,
    ),
    check(
      'commerce_quotes_money_check',
      sql`${t.subtotalVnd} > 0 and ${t.shippingFeeVnd} >= 0 and ${t.totalVnd} = ${t.subtotalVnd} + ${t.shippingFeeVnd} and ${t.totalVnd} <= 9999999999`,
    ),
    check(
      'commerce_quotes_cart_check',
      sql`(${t.cartId} is null and ${t.cartVersion} is null) or (${t.cartId} is not null and ${t.cartVersion} is not null and ${t.cartVersion} >= 0)`,
    ),
  ],
)

export const orderCodeSequence = pgSequence('commerce_order_code_seq', {
  startWith: 100001,
  cycle: false,
})

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code')
      .default(sql`'TV' || nextval('commerce_order_code_seq')::text`)
      .notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => checkoutQuotes.id),
    status: text('status', {
      enum: [
        'placed',
        'confirmed',
        'packing',
        'shipped',
        'delivered',
        'completed',
        'cancelled',
      ],
    })
      .default('placed')
      .notNull(),
    paymentMethod: text('payment_method', {
      enum: ['cod', 'bank_transfer'],
    }).notNull(),
    currency: text('currency').default('VND').notNull(),
    subtotalVnd: money('subtotal_vnd'),
    shippingFeeVnd: money('shipping_fee_vnd'),
    totalVnd: money('total_vnd'),
    recipient: jsonb('recipient').$type<Recipient>().notNull(),
    bankInstructions: jsonb('bank_instructions').$type<BankInstructions>(),
    assignedTo: text('assigned_to').references(() => user.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    // Start of the current continuous staff-work episode; null means initial work.
    staffWorkStartedAt: timestamp('staff_work_started_at', {
      withTimezone: true,
    }),
    assignmentSource: text('assignment_source', {
      enum: ['automatic', 'manual'],
    }),
    stockState: text('stock_state', {
      enum: ['reserved', 'committed', 'released'],
    })
      .default('reserved')
      .notNull(),
    revision: integer('revision').default(1).notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by').references(() => user.id),
    deletionReason: text('deletion_reason'),
    collectionFailureCount: integer('collection_failure_count')
      .default(0)
      .notNull(),
    collectionIssueReason: text('collection_issue_reason'),
    collectionResolution: text('collection_resolution', {
      enum: ['open', 'debt', 'written_off', 'collected'],
    })
      .default('open')
      .notNull(),
    reservationExpiresAt: timestamp('reservation_expires_at', {
      withTimezone: true,
    }),
    paymentReviewRequiredAt: timestamp('payment_review_required_at', {
      withTimezone: true,
    }),
    paymentDeadlineAt: timestamp('payment_deadline_at', { withTimezone: true }),
    latePaymentAcceptedAt: timestamp('late_payment_accepted_at', {
      withTimezone: true,
    }),
    latePaymentAcceptedBy: text('late_payment_accepted_by').references(
      () => user.id,
    ),
    latePaymentAcceptedFingerprint: text('late_payment_accepted_fingerprint'),
    paymentReviewDueAt: timestamp('payment_review_due_at', {
      withTimezone: true,
    }),
    paymentReviewEscalatedAt: timestamp('payment_review_escalated_at', {
      withTimezone: true,
    }),
    carrierCollectionFailureCount: integer('carrier_collection_failure_count')
      .default(0)
      .notNull(),
    carrierCollectionIssueReason: text('carrier_collection_issue_reason'),
    carrierCollectionResolution: text('carrier_collection_resolution', {
      enum: ['open', 'debt', 'written_off', 'collected'],
    })
      .default('open')
      .notNull(),
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
  },
  (t) => [
    uniqueIndex('orders_code_idx').on(t.code),
    check('orders_code_check', sql`${t.code} ~ '^TV[1-9][0-9]*$'`),
    uniqueIndex('orders_quote_idx').on(t.quoteId),
    index('orders_customer_idx').on(t.userId, t.createdAt, t.id),
    index('orders_queue_idx').on(t.status, t.assignedTo, t.createdAt),
    index('orders_staff_workload_idx')
      .on(t.assignedTo, t.status)
      .where(sql`${t.deletedAt} is null and ${t.assignedTo} is not null`),
    index('orders_assignment_queue_idx')
      .on(t.createdAt, t.id)
      .where(
        sql`${t.assignedTo} is null and ${t.deletedAt} is null and ${t.status} in ('placed', 'confirmed', 'packing')`,
      ),
    index('orders_assignment_sla_idx')
      .on(t.assignedAt)
      .where(
        sql`${t.assignedTo} is not null and ${t.deletedAt} is null and ${t.status} = 'placed'`,
      ),
    check(
      'orders_assignment_check',
      sql`(${t.assignedTo} is null and ${t.assignedAt} is null and ${t.assignmentSource} is null) or (${t.assignedTo} is not null and ${t.assignedAt} is not null and ${t.assignmentSource} is not null and ${t.assignmentSource} in ('automatic', 'manual'))`,
    ),
    index('orders_deleted_idx')
      .on(t.deletedAt, t.createdAt, t.id)
      .where(sql`${t.deletedAt} is not null`),
    check(
      'orders_deletion_check',
      sql`(${t.deletedAt} is null and ${t.deletedBy} is null and ${t.deletionReason} is null) or (${t.deletedAt} is not null and ${t.deletedBy} is not null and ${t.deletionReason} is not null and length(btrim(${t.deletionReason})) between 3 and 1000 and ${t.status} in ('cancelled', 'completed'))`,
    ),
    index('orders_reservation_expiry_idx')
      .on(t.reservationExpiresAt)
      .where(sql`${t.reservationExpiresAt} is not null`),
    index('orders_payment_review_due_idx')
      .on(t.paymentReviewDueAt)
      .where(
        sql`${t.reservationExpiresAt} is not null and ${t.paymentMethod} = 'bank_transfer' and ${t.paymentReviewEscalatedAt} is null`,
      ),
    check(
      'orders_payment_deadline_check',
      sql`(${t.paymentDeadlineAt} is null and ${t.paymentReviewDueAt} is null) or (${t.paymentMethod} = 'bank_transfer' and ${t.paymentDeadlineAt} is not null and ${t.paymentReviewDueAt} is not null and ${t.paymentReviewDueAt} > ${t.paymentDeadlineAt})`,
    ),
    check(
      'orders_payment_escalation_check',
      sql`${t.paymentReviewEscalatedAt} is null or (${t.paymentMethod} = 'bank_transfer' and ${t.paymentReviewDueAt} is not null and ${t.paymentReviewEscalatedAt} >= ${t.paymentReviewDueAt})`,
    ),
    check(
      'orders_reservation_check',
      sql`${t.reservationExpiresAt} is null or (${t.stockState} = 'reserved' and (${t.status} = 'placed' or (${t.status} in ('confirmed', 'packing') and ${t.paymentMethod} = 'bank_transfer')))`,
    ),
    check(
      'orders_late_payment_acceptance_check',
      sql`(${t.latePaymentAcceptedAt} is null and ${t.latePaymentAcceptedBy} is null and ${t.latePaymentAcceptedFingerprint} is null) or (${t.paymentMethod} = 'bank_transfer' and ${t.paymentDeadlineAt} is not null and ${t.latePaymentAcceptedAt} is not null and ${t.latePaymentAcceptedAt} >= ${t.paymentDeadlineAt} and ${t.latePaymentAcceptedBy} is not null and ${t.latePaymentAcceptedFingerprint} is not null and ${t.latePaymentAcceptedFingerprint} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'orders_collection_resolution_check',
      sql`${t.collectionResolution} in ('open', 'debt', 'written_off', 'collected') and (${t.collectionResolution} = 'open' or ${t.paymentMethod} = 'cod')`,
    ),
    check(
      'orders_status_check',
      sql`${t.status} in ('placed', 'confirmed', 'packing', 'shipped', 'delivered', 'completed', 'cancelled')`,
    ),
    check(
      'orders_method_check',
      sql`${t.paymentMethod} in ('cod', 'bank_transfer')`,
    ),
    check('orders_currency_check', sql`${t.currency} = 'VND'`),
    check(
      'orders_money_check',
      sql`${t.subtotalVnd} > 0 and ${t.shippingFeeVnd} >= 0 and ${t.totalVnd} = ${t.subtotalVnd} + ${t.shippingFeeVnd} and ${t.totalVnd} <= 9999999999`,
    ),
    check(
      'orders_bank_check',
      sql`${t.paymentMethod} <> 'bank_transfer' or ${t.bankInstructions} is not null`,
    ),
    check('orders_revision_check', sql`${t.revision} > 0`),
    check(
      'orders_collection_attempts_check',
      sql`${t.collectionFailureCount} between 0 and 3 and (${t.collectionFailureCount} = 0 or (${t.paymentMethod} = 'cod' and ${t.collectionIssueReason} is not null))`,
    ),
    check(
      'orders_payment_review_check',
      sql`${t.paymentReviewRequiredAt} is null or (${t.paymentMethod} = 'bank_transfer' and ${t.reservationExpiresAt} is not null and ${t.stockState} = 'reserved')`,
    ),
    check(
      'orders_carrier_collection_check',
      sql`${t.carrierCollectionFailureCount} between 0 and 3 and ${t.carrierCollectionResolution} in ('open', 'debt', 'written_off', 'collected') and (${t.carrierCollectionFailureCount} = 0 or ${t.carrierCollectionIssueReason} is not null) and (${t.paymentMethod} = 'cod' or (${t.carrierCollectionFailureCount} = 0 and ${t.carrierCollectionResolution} = 'open'))`,
    ),
    check(
      'orders_lifecycle_check',
      sql`
    (${t.status} in ('placed', 'confirmed', 'packing') and ${t.stockState} = 'reserved' and ${t.deliveredAt} is null and ${t.completedAt} is null and ${t.cancelledAt} is null)
    or (${t.status} = 'shipped' and ${t.stockState} = 'committed' and ${t.deliveredAt} is null and ${t.completedAt} is null and ${t.cancelledAt} is null)
    or (${t.status} = 'delivered' and ${t.stockState} = 'committed' and ${t.deliveredAt} is not null and ${t.completedAt} is null and ${t.cancelledAt} is null)
    or (${t.status} = 'completed' and ${t.stockState} = 'committed' and ${t.deliveredAt} is not null and ${t.completedAt} is not null and ${t.completedAt} >= ${t.deliveredAt} and ${t.cancelledAt} is null)
    or (${t.status} = 'cancelled' and ${t.stockState} = 'released' and ${t.cancelledAt} is not null and ${t.cancellationReason} is not null and ${t.completedAt} is null)`,
    ),
  ],
)

export const staffOrderSettings = pgTable(
  'staff_order_settings',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id),
    enabled: boolean('enabled').default(false).notNull(),
    acceptingOrders: boolean('accepting_orders').default(false).notNull(),
    shiftEndsAt: timestamp('shift_ends_at', { withTimezone: true }),
    unavailableSince: timestamp('unavailable_since', { withTimezone: true }),
    maxActiveOrders: integer('max_active_orders').default(20).notNull(),
    capacityChangedAt: time('capacity_changed_at'),
    lastAssignedAt: timestamp('last_assigned_at', { withTimezone: true }),
    revision: integer('revision').default(1).notNull(),
    updatedBy: text('updated_by').references(() => user.id),
    updatedAt: time('updated_at'),
  },
  (t) => [
    check(
      'staff_order_settings_capacity_check',
      sql`${t.maxActiveOrders} between 1 and 100`,
    ),
    check('staff_order_settings_revision_check', sql`${t.revision} > 0`),
    check(
      'staff_order_settings_availability_check',
      sql`${t.enabled} or not ${t.acceptingOrders}`,
    ),
    check(
      'staff_order_settings_shift_check',
      sql`not ${t.acceptingOrders} or ${t.shiftEndsAt} is not null`,
    ),
    index('staff_order_settings_shift_idx')
      .on(t.shiftEndsAt)
      .where(sql`${t.acceptingOrders}`),
  ],
)

export const staffOrderSettingChanges = pgTable(
  'staff_order_setting_changes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    targetUserId: text('target_user_id')
      .notNull()
      .references(() => user.id),
    actorUserId: text('actor_user_id').references(() => user.id),
    actorType: text('actor_type', { enum: ['user', 'system'] })
      .default('user')
      .notNull(),
    previousValue: jsonb('previous_value')
      .$type<StaffOrderSettingsValue>()
      .notNull(),
    newValue: jsonb('new_value').$type<StaffOrderSettingsValue>().notNull(),
    reason: text('reason').notNull(),
    createdAt: time('created_at'),
  },
  (t) => [
    index('staff_order_setting_changes_user_idx').on(
      t.targetUserId,
      t.createdAt,
    ),
    check(
      'staff_order_setting_changes_reason_check',
      sql`length(btrim(${t.reason})) between 3 and 1000`,
    ),
    check(
      'staff_order_setting_changes_actor_check',
      sql`(${t.actorType} = 'user' and ${t.actorUserId} is not null) or (${t.actorType} = 'system' and ${t.actorUserId} is null)`,
    ),
  ],
)

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    skuSnapshot: text('sku_snapshot').notNull(),
    nameSnapshot: text('name_snapshot').notNull(),
    unitPriceVnd: money('unit_price_vnd'),
    quantity: integer('quantity').notNull(),
    lineTotalVnd: money('line_total_vnd'),
  },
  (t) => [
    uniqueIndex('order_items_product_idx').on(t.orderId, t.productId),
    check(
      'order_items_values_check',
      sql`${t.quantity} between 1 and 99 and ${t.unitPriceVnd} > 0 and ${t.lineTotalVnd} = ${t.unitPriceVnd} * ${t.quantity} and ${t.lineTotalVnd} <= 9999999999`,
    ),
  ],
)

export const commands = pgTable(
  'commerce_commands',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    scope: text('scope').notNull(),
    key: uuid('key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    result: jsonb('result').$type<CommandResult>(),
    createdAt: time('created_at'),
  },
  (t) => [
    uniqueIndex('commerce_commands_identity_idx').on(t.userId, t.scope, t.key),
  ],
)

export const orderEvents = pgTable(
  'commerce_order_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    actorUserId: text('actor_user_id').references(() => user.id),
    actorType: text('actor_type', { enum: ['user', 'system'] })
      .default('user')
      .notNull(),
    type: text('type').notNull(),
    details: jsonb('details').$type<CommandResult>().notNull(),
    createdAt: time('created_at').default(sql`clock_timestamp()`),
  },
  (t) => [
    index('commerce_events_order_idx').on(t.orderId, t.createdAt),
    check(
      'commerce_events_actor_check',
      sql`(${t.actorType} = 'user' and ${t.actorUserId} is not null) or (${t.actorType} = 'system' and ${t.actorUserId} is null)`,
    ),
  ],
)

// Documents are committed atomically with the correction they authorize. No
// update/delete operation is exposed; earlier text-only references stay in audit.
export const orderUndoDocuments = pgTable(
  'commerce_order_undo_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    orderRevision: integer('order_revision').notNull(),
    action: text('action', { enum: ['handover', 'delivery'] }).notNull(),
    fileName: text('file_name').notNull(),
    mediaType: text('media_type', {
      enum: ['application/pdf', 'image/png', 'image/jpeg'],
    }).notNull(),
    content: binary('content').notNull(),
    sha256: text('sha256').notNull(),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => user.id),
    createdAt: time('created_at'),
  },
  (t) => [
    uniqueIndex('commerce_undo_documents_order_revision_idx').on(
      t.orderId,
      t.orderRevision,
    ),
    check(
      'commerce_undo_documents_revision_check',
      sql`${t.orderRevision} > 0`,
    ),
    check(
      'commerce_undo_documents_action_check',
      sql`${t.action} in ('handover', 'delivery')`,
    ),
    check(
      'commerce_undo_documents_type_check',
      sql`${t.mediaType} in ('application/pdf', 'image/png', 'image/jpeg')`,
    ),
    check(
      'commerce_undo_documents_name_check',
      sql`length(btrim(${t.fileName})) between 1 and 160`,
    ),
    check(
      'commerce_undo_documents_content_check',
      sql`octet_length(${t.content}) between 16 and 524288 and ${t.sha256} = encode(sha256(${t.content}), 'hex')`,
    ),
  ],
)

export const stockMovements = pgTable(
  'commerce_stock_movements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    orderId: uuid('order_id').references(() => orders.id),
    actorUserId: text('actor_user_id').references(() => user.id),
    actorType: text('actor_type', { enum: ['user', 'system'] })
      .default('user')
      .notNull(),
    kind: text('kind', {
      enum: ['adjustment', 'reserve', 'release', 'ship', 'return'],
    }).notNull(),
    onHandDelta: integer('on_hand_delta').notNull(),
    reservedDelta: integer('reserved_delta').notNull(),
    reason: text('reason').notNull(),
    reference: text('reference').notNull(),
    createdAt: time('created_at'),
  },
  (t) => [
    index('commerce_stock_product_idx').on(t.productId, t.createdAt),
    index('commerce_stock_return_order_idx')
      .on(t.orderId)
      .where(sql`${t.kind} = 'return'`),
    check(
      'commerce_stock_actor_check',
      sql`(${t.actorType} = 'user' and ${t.actorUserId} is not null) or (${t.actorType} = 'system' and ${t.actorUserId} is null)`,
    ),
    uniqueIndex('commerce_stock_identity_idx').on(
      t.productId,
      t.kind,
      t.reference,
    ),
    check(
      'commerce_stock_values_check',
      sql`
    (${t.kind} = 'adjustment' and ${t.onHandDelta} <> 0 and ${t.reservedDelta} = 0)
    or (${t.kind} = 'reserve' and ${t.onHandDelta} = 0 and ${t.reservedDelta} > 0 and ${t.orderId} is not null)
    or (${t.kind} = 'release' and ${t.onHandDelta} = 0 and ${t.reservedDelta} < 0 and ${t.orderId} is not null)
    or (${t.kind} = 'ship' and ${t.onHandDelta} < 0 and ${t.onHandDelta} = ${t.reservedDelta} and ${t.orderId} is not null)
    or (${t.kind} = 'return' and ${t.onHandDelta} > 0 and ${t.reservedDelta} = 0 and ${t.orderId} is not null)`,
    ),
  ],
)

export const carriers = pgTable(
  'commerce_carriers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    createdBy: text('created_by').references(() => user.id),
    createdAt: time('created_at'),
  },
  (t) => [
    uniqueIndex('commerce_carriers_code_idx').on(t.code),
    check(
      'commerce_carriers_code_check',
      sql`${t.code} ~ '^[a-z0-9][a-z0-9._-]{1,63}$'`,
    ),
  ],
)

export const codCollections = pgTable(
  'commerce_cod_collections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    carrier: text('carrier').notNull(),
    carrierId: uuid('carrier_id')
      .notNull()
      .references(() => carriers.id),
    reconciliationRequired: boolean('reconciliation_required')
      .default(false)
      .notNull(),
    duplicateOfId: uuid('duplicate_of_id'),
    reference: text('reference').notNull(),
    revision: integer('revision').default(1).notNull(),
    amountVnd: money('amount_vnd'),
    currency: text('currency').default('VND').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => user.id),
    createdAt: time('created_at'),
  },
  (t) => [
    index('commerce_cod_collections_order_idx').on(t.orderId),
    uniqueIndex('commerce_cod_collections_receipt_idx')
      .on(t.carrierId, t.reference)
      .where(
        sql`${t.duplicateOfId} is null and not ${t.reconciliationRequired}`,
      ),
    index('commerce_cod_collections_lookup_idx').on(t.carrierId, t.reference),
    foreignKey({
      name: 'commerce_cod_collections_duplicate_fk',
      columns: [t.duplicateOfId],
      foreignColumns: [t.id],
    }),
    check(
      'commerce_cod_collections_duplicate_check',
      sql`${t.duplicateOfId} is null or (${t.duplicateOfId} <> ${t.id} and not ${t.reconciliationRequired})`,
    ),
    uniqueIndex('commerce_cod_collections_identity_idx').on(t.id, t.orderId),
    check(
      'commerce_cod_collections_money_check',
      sql`${t.amountVnd} between 1 and 9999999999 and ${t.currency} = 'VND' and ${t.revision} >= 1`,
    ),
  ],
)

export const codCollectionReconciliations = pgTable(
  'commerce_cod_collection_reconciliations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => codCollections.id),
    duplicateIds: jsonb('duplicate_ids').$type<string[]>().notNull(),
    evidenceReference: text('evidence_reference').notNull(),
    reason: text('reason').notNull(),
    decidedBy: text('decided_by')
      .notNull()
      .references(() => user.id),
    createdAt: time('created_at'),
  },
  (t) => [
    uniqueIndex('commerce_cod_reconciliations_collection_idx').on(
      t.collectionId,
    ),
  ],
)

export const payments = pgTable(
  'commerce_payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Recording context retained for audit; monetary attribution lives in allocations.
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    // Original recording context; receivingAccounts.channel is the cash channel.
    method: text('method', { enum: ['cod', 'bank_transfer'] }).notNull(),
    source: text('source', { enum: ['legacy', 'customer', 'carrier'] })
      .default('legacy')
      .notNull(),
    codCollectionId: uuid('cod_collection_id'),
    receivingAccountId: uuid('receiving_account_id').references(
      () => receivingAccounts.id,
    ),
    receiptReconciliationRequired: boolean('receipt_reconciliation_required')
      .default(true)
      .notNull(),
    duplicateOfId: uuid('duplicate_of_id'),
    revision: integer('revision').default(1).notNull(),
    reference: text('reference').notNull(),
    amountVnd: money('amount_vnd'),
    currency: text('currency').default('VND').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => user.id),
    createdAt: time('created_at'),
  },
  (t) => [
    index('commerce_payments_order_idx').on(t.orderId),
    uniqueIndex('commerce_payments_receipt_idx')
      .on(t.receivingAccountId, t.reference)
      .where(
        sql`${t.duplicateOfId} is null and not ${t.receiptReconciliationRequired}`,
      ),
    index('commerce_payments_reference_idx').on(t.reference),
    foreignKey({
      name: 'commerce_payments_duplicate_fk',
      columns: [t.duplicateOfId],
      foreignColumns: [t.id],
    }),
    check(
      'commerce_payments_receipt_identity_check',
      sql`${t.revision} >= 1 and (${t.receiptReconciliationRequired} or ${t.receivingAccountId} is not null) and (${t.duplicateOfId} is null or (${t.duplicateOfId} <> ${t.id} and not ${t.receiptReconciliationRequired}))`,
    ),
    check(
      'commerce_payments_values_check',
      sql`${t.method} in ('cod', 'bank_transfer') and ${t.amountVnd} between 1 and 9999999999 and ${t.currency} = 'VND'`,
    ),
    index('commerce_payments_collection_idx').on(t.codCollectionId),
    foreignKey({
      name: 'commerce_payments_collection_order_fk',
      columns: [t.codCollectionId, t.orderId],
      foreignColumns: [codCollections.id, codCollections.orderId],
    }),
    check(
      'commerce_payments_source_check',
      sql`${t.source} in ('legacy', 'customer', 'carrier') and (${t.source} <> 'carrier' or ${t.method} = 'cod')`,
    ),
  ],
)

export const paymentBalanceReviews = pgTable(
  'commerce_payment_balance_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    status: text('status', {
      enum: ['needs_review', 'debt', 'written_off', 'resolved'],
    })
      .default('needs_review')
      .notNull(),
    discrepancyVnd: money('discrepancy_vnd').default(0),
    purchaseShortfallVnd: money('purchase_shortfall_vnd').default(0),
    disposition: text('disposition', { enum: ['debt', 'written_off'] }),
    approvedAmountVnd: money('approved_amount_vnd').default(0),
    recoveredVndAtDecision: money('recovered_vnd_at_decision').default(0),
    paidVndAtDecision: money('paid_vnd_at_decision').default(0),
    allowFulfillment: boolean('allow_fulfillment').default(false).notNull(),
    revision: integer('revision').default(1).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
  },
  (t) => [
    uniqueIndex('commerce_payment_balance_reviews_order_idx').on(t.orderId),
    uniqueIndex('commerce_payment_balance_reviews_identity_idx').on(
      t.id,
      t.orderId,
    ),
    index('commerce_payment_balance_reviews_work_idx').on(
      t.status,
      t.updatedAt,
    ),
    check(
      'commerce_payment_balance_reviews_values_check',
      sql`${t.revision} >= 1 and ${t.discrepancyVnd} between 0 and 9007199254740991 and ${t.purchaseShortfallVnd} between 0 and ${t.discrepancyVnd} and ${t.approvedAmountVnd} between 0 and 9007199254740991 and ${t.recoveredVndAtDecision} between 0 and 9007199254740991 and ${t.paidVndAtDecision} between 0 and 9007199254740991 and ${t.status} in ('needs_review', 'debt', 'written_off', 'resolved') and (${t.disposition} is null or ${t.disposition} in ('debt', 'written_off')) and ((${t.disposition} is null and ${t.approvedAmountVnd} = 0 and ${t.recoveredVndAtDecision} = 0 and ${t.paidVndAtDecision} = 0) or (${t.disposition} is not null and ${t.approvedAmountVnd} > 0))`,
    ),
    check(
      'commerce_payment_balance_reviews_fulfillment_check',
      sql`not ${t.allowFulfillment} or (${t.disposition} is not null and ${t.disposition} = 'written_off' and ${t.status} in ('written_off', 'needs_review'))`,
    ),
  ],
)

export const paymentBalanceReviewDecisions = pgTable(
  'commerce_payment_balance_review_decisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => paymentBalanceReviews.id),
    disposition: text('disposition', {
      enum: ['debt', 'written_off'],
    }).notNull(),
    responsibleParty: text('responsible_party').notNull(),
    evidenceReference: text('evidence_reference').notNull(),
    reason: text('reason').notNull(),
    before: jsonb('before').$type<CommandResult>().notNull(),
    after: jsonb('after').$type<CommandResult>().notNull(),
    decidedBy: text('decided_by')
      .notNull()
      .references(() => user.id),
    createdAt: time('created_at'),
  },
  (t) => [
    index('commerce_payment_balance_review_decisions_review_idx').on(
      t.reviewId,
    ),
    check(
      'commerce_payment_balance_review_decisions_disposition_check',
      sql`${t.disposition} in ('debt', 'written_off')`,
    ),
  ],
)

export const paymentAllocations = pgTable(
  'commerce_payment_allocations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    codCollectionId: uuid('cod_collection_id'),
    purpose: text('purpose', { enum: ['payment', 'refund_recovery'] })
      .default('payment')
      .notNull(),
    reviewId: uuid('review_id'),
    amountVnd: money('amount_vnd'),
    createdAt: time('created_at'),
  },
  (t) => [
    index('commerce_payment_allocations_order_idx').on(t.orderId),
    index('commerce_payment_allocations_collection_idx').on(t.codCollectionId),
    uniqueIndex('commerce_payment_allocations_customer_idx')
      .on(t.paymentId, t.orderId, t.purpose)
      .where(sql`${t.codCollectionId} is null`),
    uniqueIndex('commerce_payment_allocations_carrier_idx')
      .on(t.paymentId, t.codCollectionId)
      .where(sql`${t.codCollectionId} is not null`),
    foreignKey({
      name: 'commerce_payment_allocations_collection_order_fk',
      columns: [t.codCollectionId, t.orderId],
      foreignColumns: [codCollections.id, codCollections.orderId],
    }),
    foreignKey({
      name: 'commerce_payment_allocations_review_order_fk',
      columns: [t.reviewId, t.orderId],
      foreignColumns: [paymentBalanceReviews.id, paymentBalanceReviews.orderId],
    }),
    check(
      'commerce_payment_allocations_purpose_check',
      sql`(${t.purpose} = 'payment' and ${t.reviewId} is null) or (${t.purpose} = 'refund_recovery' and ${t.reviewId} is not null and ${t.codCollectionId} is null)`,
    ),
    check(
      'commerce_payment_allocations_money_check',
      sql`${t.amountVnd} between 1 and 9999999999`,
    ),
  ],
)

export const paymentAllocationAdjustments = pgTable(
  'commerce_payment_allocation_adjustments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    evidenceReference: text('evidence_reference').notNull(),
    reason: text('reason').notNull(),
    before: jsonb('before').$type<CommandResult>().notNull(),
    after: jsonb('after').$type<CommandResult>().notNull(),
    decidedBy: text('decided_by')
      .notNull()
      .references(() => user.id),
    createdAt: time('created_at'),
  },
  (t) => [
    index('commerce_payment_allocation_adjustments_payment_idx').on(
      t.paymentId,
    ),
  ],
)

export const receivingBanks = pgTable(
  'commerce_receiving_banks',
  {
    bin: text('bin').primaryKey(),
    code: text('code').notNull(),
    shortName: text('short_name').notNull(),
    name: text('name').notNull(),
  },
  (t) => [
    check('commerce_receiving_banks_bin_check', sql`${t.bin} ~ '^[0-9]{6}$'`),
  ],
)

export const receivingAccounts = pgTable(
  'commerce_receiving_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    channel: text('channel', { enum: ['bank_transfer', 'cash'] }).notNull(),
    providerCode: text('provider_code').notNull(),
    bankBin: text('bank_bin').references(() => receivingBanks.bin),
    accountReference: text('account_reference').notNull(),
    name: text('name').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: time('created_at'),
  },
  (t) => [
    uniqueIndex('commerce_receiving_accounts_identity_idx').on(
      t.channel,
      t.providerCode,
      t.accountReference,
    ),
    check(
      'commerce_receiving_accounts_identity_check',
      sql`${t.channel} in ('bank_transfer', 'cash') and ${t.providerCode} ~ '^[a-z0-9][a-z0-9._-]{1,63}$' and ${t.accountReference} ~ '^[a-z0-9][a-z0-9._-]{0,99}$'`,
    ),
    check(
      'commerce_receiving_accounts_bank_check',
      sql`(${t.channel} = 'cash' and ${t.bankBin} is null) or (${t.channel} = 'bank_transfer' and ${t.bankBin} is not null and ${t.providerCode} = ${t.bankBin})`,
    ),
  ],
)

export const paymentReceiptReconciliations = pgTable(
  'commerce_payment_receipt_reconciliations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    evidenceReference: text('evidence_reference').notNull(),
    reason: text('reason').notNull(),
    before: jsonb('before').$type<CommandResult>().notNull(),
    after: jsonb('after').$type<CommandResult>().notNull(),
    decidedBy: text('decided_by')
      .notNull()
      .references(() => user.id),
    createdAt: time('created_at'),
  },
  (t) => [
    index('commerce_payment_receipt_reconciliations_payment_idx').on(
      t.paymentId,
    ),
  ],
)

export const codCollectionAdjustments = pgTable(
  'commerce_cod_collection_adjustments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => codCollections.id),
    evidenceReference: text('evidence_reference').notNull(),
    reason: text('reason').notNull(),
    before: jsonb('before').$type<CommandResult>().notNull(),
    after: jsonb('after').$type<CommandResult>().notNull(),
    decidedBy: text('decided_by')
      .notNull()
      .references(() => user.id),
    createdAt: time('created_at'),
  },
  (t) => [
    index('commerce_cod_collection_adjustments_collection_idx').on(
      t.collectionId,
    ),
  ],
)

export const paymentClassifications = pgTable(
  'commerce_payment_classifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    source: text('source', { enum: ['customer', 'carrier'] }).notNull(),
    codCollectionId: uuid('cod_collection_id').references(
      () => codCollections.id,
    ),
    evidenceReference: text('evidence_reference').notNull(),
    reason: text('reason').notNull(),
    decidedBy: text('decided_by')
      .notNull()
      .references(() => user.id),
    createdAt: time('created_at'),
  },
  (t) => [
    uniqueIndex('commerce_payment_classifications_payment_idx').on(t.paymentId),
    check(
      'commerce_payment_classifications_source_check',
      sql`(${t.source} = 'customer' and ${t.codCollectionId} is null) or (${t.source} = 'carrier' and ${t.codCollectionId} is not null)`,
    ),
  ],
)

export const shipments = pgTable(
  'commerce_shipments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    // Historical shipments can remain unknown until their carrier is verified.
    carrierId: uuid('carrier_id').references(() => carriers.id),
    trackingReference: text('tracking_reference').notNull(),
    status: text('status', {
      enum: ['in_transit', 'delivery_failed', 'delivered', 'returned'],
    })
      .default('in_transit')
      .notNull(),
    failedAttempts: integer('failed_attempts').default(0).notNull(),
    proofReference: text('proof_reference'),
    failureReason: text('failure_reason'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
  },
  (t) => [
    uniqueIndex('commerce_shipments_order_idx').on(t.orderId),
    uniqueIndex('commerce_shipments_carrier_tracking_idx').on(
      t.carrierId,
      t.trackingReference,
    ),
    uniqueIndex('commerce_shipments_legacy_tracking_idx')
      .on(t.trackingReference)
      .where(sql`${t.carrierId} is null`),
    check(
      'commerce_shipments_status_check',
      sql`${t.status} in ('in_transit', 'delivery_failed', 'delivered', 'returned')`,
    ),
    check(
      'commerce_shipments_attempts_check',
      sql`${t.failedAttempts} between 0 and 3`,
    ),
    check(
      'commerce_shipments_lifecycle_check',
      sql`
      (${t.status} in ('in_transit', 'delivery_failed') and ${t.deliveredAt} is null and ${t.returnedAt} is null)
      or (${t.status} = 'delivered' and ${t.deliveredAt} is not null and ${t.returnedAt} is null)
      or (${t.status} = 'returned' and ${t.returnedAt} is not null and ${t.deliveredAt} is null)`,
    ),
  ],
)

export const collectionDecisions = pgTable(
  'commerce_collection_decisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    disposition: text('disposition', {
      enum: ['debt', 'written_off'],
    }).notNull(),
    party: text('party', { enum: ['customer', 'carrier'] })
      .default('customer')
      .notNull(),
    cashReceivedVndAtDecision: bigint('cash_received_vnd_at_decision', {
      mode: 'number',
    })
      .default(0)
      .notNull(),
    amountVnd: money('amount_vnd'),
    responsibleParty: text('responsible_party').notNull(),
    kind: text('kind', { enum: ['resolution', 'responsibility_correction'] })
      .default('resolution')
      .notNull(),
    responsibleCarrierId: uuid('responsible_carrier_id').references(
      () => carriers.id,
    ),
    supersedesDecisionId: uuid('supersedes_decision_id'),
    reference: text('reference').notNull(),
    reason: text('reason').notNull(),
    decidedBy: text('decided_by')
      .notNull()
      .references(() => user.id),
    createdAt: time('created_at'),
  },
  (t) => [
    index('commerce_collection_decisions_disposition_idx').on(
      t.orderId,
      t.party,
      t.disposition,
    ),
    uniqueIndex('commerce_collection_decisions_reference_idx').on(t.reference),
    uniqueIndex('commerce_collection_decisions_identity_idx').on(
      t.id,
      t.orderId,
      t.party,
    ),
    uniqueIndex('commerce_collection_decisions_superseded_idx')
      .on(t.supersedesDecisionId)
      .where(sql`${t.supersedesDecisionId} is not null`),
    foreignKey({
      name: 'commerce_collection_decisions_supersedes_fk',
      columns: [t.supersedesDecisionId, t.orderId, t.party],
      foreignColumns: [t.id, t.orderId, t.party],
    }),
    check(
      'commerce_collection_decisions_responsibility_check',
      sql`${t.kind} in ('resolution', 'responsibility_correction') and (${t.responsibleCarrierId} is null or ${t.party} = 'carrier') and (${t.supersedesDecisionId} is null or (${t.supersedesDecisionId} <> ${t.id} and ${t.party} = 'carrier' and ${t.responsibleCarrierId} is not null)) and (${t.kind} <> 'responsibility_correction' or ${t.supersedesDecisionId} is not null)`,
    ),
    index('commerce_collection_decisions_order_idx').on(t.orderId, t.createdAt),
    check(
      'commerce_collection_decisions_values_check',
      sql`${t.disposition} in ('debt', 'written_off') and ${t.party} in ('customer', 'carrier') and ${t.amountVnd} between 1 and 9999999999 and ${t.cashReceivedVndAtDecision} >= 0`,
    ),
  ],
)

export const returns = pgTable(
  'commerce_returns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    status: text('status', {
      enum: [
        'requested',
        'approved',
        'receiving',
        'received',
        'rejected',
        'withdrawn',
        'closed',
      ],
    })
      .default('requested')
      .notNull(),
    reason: text('reason').notNull(),
    decisionReason: text('decision_reason'),
    responsibility: text('responsibility', {
      enum: ['customer', 'store', 'carrier'],
    })
      .default('customer')
      .notNull(),
    decidedBy: text('decided_by').references(() => user.id),
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
  },
  (t) => [
    index('commerce_returns_order_idx').on(t.orderId),
    check(
      'commerce_returns_status_check',
      sql`${t.status} in ('requested', 'approved', 'receiving', 'received', 'rejected', 'withdrawn', 'closed')`,
    ),
    check(
      'commerce_returns_responsibility_check',
      sql`${t.responsibility} in ('customer', 'store', 'carrier')`,
    ),
  ],
)

export const returnLines = pgTable(
  'commerce_return_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    returnId: uuid('return_id')
      .notNull()
      .references(() => returns.id),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id),
    quantity: integer('quantity').notNull(),
    receivedQuantity: integer('received_quantity').default(0).notNull(),
    restockedQuantity: integer('restocked_quantity').default(0).notNull(),
  },
  (t) => [
    uniqueIndex('commerce_return_lines_item_idx').on(t.returnId, t.orderItemId),
    check(
      'commerce_return_lines_quantities_check',
      sql`${t.quantity} between 1 and 99 and ${t.receivedQuantity} between 0 and ${t.quantity} and ${t.restockedQuantity} between 0 and ${t.receivedQuantity}`,
    ),
  ],
)

export const returnReceipts = pgTable(
  'commerce_return_receipts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    returnId: uuid('return_id')
      .notNull()
      .references(() => returns.id),
    proofReference: text('proof_reference').notNull(),
    items: jsonb('items').$type<ReceiptLine[]>().notNull(),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => user.id),
    createdAt: time('created_at').default(sql`clock_timestamp()`),
  },
  (t) => [
    uniqueIndex('commerce_return_receipts_proof_idx').on(t.proofReference),
  ],
)

export const refunds = pgTable(
  'commerce_refunds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    returnId: uuid('return_id').references(() => returns.id),
    reason: text('reason', {
      enum: ['cancellation', 'return', 'return_to_sender', 'overpayment'],
    }).notNull(),
    amountVnd: money('amount_vnd'),
    originalAmountVnd: bigint('original_amount_vnd', { mode: 'number' }),
    status: text('status', {
      enum: [
        'awaiting_payment',
        'pending',
        'processing',
        'unknown',
        'needs_review',
        'settled',
        'partially_settled',
        'voided',
      ],
    })
      .default('pending')
      .notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    settlementMethod: text('settlement_method', {
      enum: ['bank_transfer', 'cash'],
    }),
    settlementReference: text('settlement_reference'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    settledBy: text('settled_by').references(() => user.id),
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
  },
  (t) => [
    index('commerce_refunds_order_idx').on(t.orderId),
    index('commerce_refunds_work_idx').on(t.status, t.createdAt),
    uniqueIndex('commerce_refunds_settlement_idx').on(
      t.settlementMethod,
      t.settlementReference,
    ),
    check(
      'commerce_refunds_money_check',
      sql`${t.amountVnd} between 1 and 9999999999 and (${t.originalAmountVnd} is null or ${t.originalAmountVnd} between 1 and 9999999999)`,
    ),
    check('commerce_refunds_attempts_check', sql`${t.attemptCount} >= 0`),
    check(
      'commerce_refunds_reason_check',
      sql`${t.reason} in ('cancellation', 'return', 'return_to_sender', 'overpayment')`,
    ),
    check(
      'commerce_refunds_status_check',
      sql`${t.status} in ('awaiting_payment', 'pending', 'processing', 'unknown', 'needs_review', 'settled', 'partially_settled', 'voided')`,
    ),
    check(
      'commerce_refunds_funding_check',
      sql`${t.status} <> 'awaiting_payment' or (${t.reason} = 'return' and ${t.attemptCount} = 0)`,
    ),
    check(
      'commerce_refunds_method_check',
      sql`${t.settlementMethod} is null or ${t.settlementMethod} in ('bank_transfer', 'cash')`,
    ),
    check(
      'commerce_refunds_settled_check',
      sql`(${t.status} = 'settled' and ${t.settlementReference} is not null and ${t.settledAt} is not null and ${t.settledBy} is not null and ${t.settlementMethod} is not null) or (${t.status} <> 'settled' and ${t.settlementReference} is null and ${t.settledAt} is null and ${t.settledBy} is null and ${t.settlementMethod} is null)`,
    ),
  ],
)

export const refundAttempts = pgTable(
  'commerce_refund_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    refundId: uuid('refund_id')
      .notNull()
      .references(() => refunds.id),
    number: integer('number').notNull(),
    mode: text('mode', { enum: ['standard', 'manual'] })
      .default('standard')
      .notNull(),
    recoveryReason: text('recovery_reason'),
    requestedAmountVnd: money('requested_amount_vnd'),
    // Approved portion only; actual cash, including exceptions, lives in settlements.
    settledAmountVnd: bigint('settled_amount_vnd', { mode: 'number' })
      .default(0)
      .notNull(),
    remainderNotSentVerified: boolean('remainder_not_sent_verified')
      .default(false)
      .notNull(),
    status: text('status', {
      enum: ['pending', 'failed', 'unknown', 'settled', 'partially_settled'],
    })
      .default('pending')
      .notNull(),
    reason: text('reason'),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => user.id),
    resolvedBy: text('resolved_by').references(() => user.id),
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
  },
  (t) => [
    uniqueIndex('commerce_refund_attempts_number_idx').on(t.refundId, t.number),
    uniqueIndex('commerce_refund_attempts_identity_idx').on(t.id, t.refundId),
    check(
      'commerce_refund_attempts_number_check',
      sql`${t.number} > 0 and ((${t.mode} = 'standard' and ${t.number} <= 3 and ${t.recoveryReason} is null) or (${t.mode} = 'manual' and ${t.number} > 3 and ${t.recoveryReason} is not null))`,
    ),
    check(
      'commerce_refund_attempts_status_check',
      sql`${t.status} in ('pending', 'failed', 'unknown', 'settled', 'partially_settled')`,
    ),
    check(
      'commerce_refund_attempts_money_check',
      sql`${t.requestedAmountVnd} between 1 and 9999999999 and ${t.settledAmountVnd} between 0 and ${t.requestedAmountVnd}`,
    ),
    check(
      'commerce_refund_attempts_outcome_check',
      sql`(${t.status} <> 'settled' or ${t.settledAmountVnd} = ${t.requestedAmountVnd}) and (${t.status} <> 'failed' or (${t.settledAmountVnd} = 0 and ${t.remainderNotSentVerified})) and (${t.status} <> 'partially_settled' or (${t.settledAmountVnd} > 0 and ${t.settledAmountVnd} < ${t.requestedAmountVnd}))`,
    ),
  ],
)

export const refundSettlements = pgTable(
  'commerce_refund_settlements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    refundId: uuid('refund_id')
      .notNull()
      .references(() => refunds.id),
    attemptId: uuid('attempt_id'),
    amountVnd: money('amount_vnd'),
    excessAmountVnd: bigint('excess_amount_vnd', { mode: 'number' })
      .default(0)
      .notNull(),
    exceptionEvidenceReference: text('exception_evidence_reference'),
    exceptionReason: text('exception_reason'),
    currency: text('currency').default('VND').notNull(),
    method: text('method', { enum: ['bank_transfer', 'cash'] }).notNull(),
    reference: text('reference').notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }).notNull(),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => user.id),
    createdAt: time('created_at'),
  },
  (t) => [
    index('commerce_refund_settlements_refund_idx').on(t.refundId),
    uniqueIndex('commerce_refund_settlements_receipt_idx').on(
      t.method,
      t.reference,
    ),
    foreignKey({
      name: 'commerce_refund_settlements_attempt_refund_fk',
      columns: [t.attemptId, t.refundId],
      foreignColumns: [refundAttempts.id, refundAttempts.refundId],
    }),
    check(
      'commerce_refund_settlements_money_check',
      sql`${t.amountVnd} between 1 and 9999999999 and ${t.currency} = 'VND' and ${t.method} in ('bank_transfer', 'cash')`,
    ),
    check(
      'commerce_refund_settlements_exception_check',
      sql`${t.excessAmountVnd} between 0 and ${t.amountVnd} and ((${t.excessAmountVnd} = 0 and ${t.exceptionEvidenceReference} is null and ${t.exceptionReason} is null) or (${t.excessAmountVnd} > 0 and ${t.attemptId} is not null and ${t.exceptionEvidenceReference} is not null and length(trim(${t.exceptionEvidenceReference})) > 0 and ${t.exceptionReason} is not null and length(trim(${t.exceptionReason})) > 0))`,
    ),
  ],
)

export const roleChanges = pgTable('commerce_role_changes', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorUserId: text('actor_user_id')
    .notNull()
    .references(() => user.id),
  targetUserId: text('target_user_id')
    .notNull()
    .references(() => user.id),
  previousRole: text('previous_role').notNull(),
  newRole: text('new_role').notNull(),
  reason: text('reason').notNull(),
  createdAt: time('created_at').default(sql`clock_timestamp()`),
})
