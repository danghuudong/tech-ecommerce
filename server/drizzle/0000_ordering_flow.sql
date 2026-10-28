CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'customer' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_role_check" CHECK ("user"."role" in ('customer', 'staff', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_cart_items" (
	"cart_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "commerce_cart_items_quantity_check" CHECK ("commerce_cart_items"."quantity" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "commerce_carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_carts_version_check" CHECK ("commerce_carts"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce_checkout_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"cart_id" uuid,
	"cart_version" integer,
	"lines" jsonb NOT NULL,
	"recipient" jsonb NOT NULL,
	"payment_method" text NOT NULL,
	"bank_instructions" jsonb,
	"subtotal_vnd" bigint NOT NULL,
	"shipping_fee_vnd" bigint NOT NULL,
	"total_vnd" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_quotes_method_check" CHECK ("commerce_checkout_quotes"."payment_method" in ('cod', 'bank_transfer')),
	CONSTRAINT "commerce_quotes_money_check" CHECK ("commerce_checkout_quotes"."subtotal_vnd" > 0 and "commerce_checkout_quotes"."shipping_fee_vnd" >= 0 and "commerce_checkout_quotes"."total_vnd" = "commerce_checkout_quotes"."subtotal_vnd" + "commerce_checkout_quotes"."shipping_fee_vnd" and "commerce_checkout_quotes"."total_vnd" <= 9999999999),
	CONSTRAINT "commerce_quotes_cart_check" CHECK (("commerce_checkout_quotes"."cart_id" is null and "commerce_checkout_quotes"."cart_version" is null) or ("commerce_checkout_quotes"."cart_id" is not null and "commerce_checkout_quotes"."cart_version" is not null and "commerce_checkout_quotes"."cart_version" >= 0))
);
--> statement-breakpoint
CREATE TABLE "commerce_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"type" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku_snapshot" text NOT NULL,
	"name_snapshot" text NOT NULL,
	"unit_price_vnd" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_vnd" bigint NOT NULL,
	CONSTRAINT "order_items_values_check" CHECK ("order_items"."quantity" between 1 and 99 and "order_items"."unit_price_vnd" > 0 and "order_items"."line_total_vnd" = "order_items"."unit_price_vnd" * "order_items"."quantity" and "order_items"."line_total_vnd" <= 9999999999)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"quote_id" uuid NOT NULL,
	"status" text DEFAULT 'placed' NOT NULL,
	"payment_method" text NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"subtotal_vnd" bigint NOT NULL,
	"shipping_fee_vnd" bigint NOT NULL,
	"total_vnd" bigint NOT NULL,
	"recipient" jsonb NOT NULL,
	"bank_instructions" jsonb,
	"assigned_to" text,
	"stock_state" text DEFAULT 'reserved' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"delivered_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"collection_failure_count" integer DEFAULT 0 NOT NULL,
	"collection_issue_reason" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "orders_status_check" CHECK ("orders"."status" in ('placed', 'confirmed', 'packing', 'shipped', 'delivered', 'completed', 'cancelled')),
	CONSTRAINT "orders_method_check" CHECK ("orders"."payment_method" in ('cod', 'bank_transfer')),
	CONSTRAINT "orders_currency_check" CHECK ("orders"."currency" = 'VND'),
	CONSTRAINT "orders_money_check" CHECK ("orders"."subtotal_vnd" > 0 and "orders"."shipping_fee_vnd" >= 0 and "orders"."total_vnd" = "orders"."subtotal_vnd" + "orders"."shipping_fee_vnd" and "orders"."total_vnd" <= 9999999999),
	CONSTRAINT "orders_bank_check" CHECK ("orders"."payment_method" <> 'bank_transfer' or "orders"."bank_instructions" is not null),
	CONSTRAINT "orders_revision_check" CHECK ("orders"."revision" > 0),
	CONSTRAINT "orders_collection_attempts_check" CHECK ("orders"."collection_failure_count" between 0 and 3 and ("orders"."collection_failure_count" = 0 or ("orders"."payment_method" = 'cod' and "orders"."collection_issue_reason" is not null))),
	CONSTRAINT "orders_lifecycle_check" CHECK (
    ("orders"."status" in ('placed', 'confirmed', 'packing') and "orders"."stock_state" = 'reserved' and "orders"."delivered_at" is null and "orders"."completed_at" is null and "orders"."cancelled_at" is null)
    or ("orders"."status" = 'shipped' and "orders"."stock_state" = 'committed' and "orders"."delivered_at" is null and "orders"."completed_at" is null and "orders"."cancelled_at" is null)
    or ("orders"."status" = 'delivered' and "orders"."stock_state" = 'committed' and "orders"."delivered_at" is not null and "orders"."completed_at" is null and "orders"."cancelled_at" is null)
    or ("orders"."status" = 'completed' and "orders"."stock_state" = 'committed' and "orders"."delivered_at" is not null and "orders"."completed_at" is not null and "orders"."completed_at" >= "orders"."delivered_at" and "orders"."cancelled_at" is null)
    or ("orders"."status" = 'cancelled' and "orders"."stock_state" = 'released' and "orders"."cancelled_at" is not null and "orders"."cancellation_reason" is not null and "orders"."completed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "commerce_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"method" text NOT NULL,
	"reference" text NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_payments_values_check" CHECK ("commerce_payments"."method" in ('cod', 'bank_transfer') and "commerce_payments"."amount_vnd" between 1 and 9999999999 and "commerce_payments"."currency" = 'VND')
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_vnd" bigint NOT NULL,
	"stock_on_hand" integer DEFAULT 0 NOT NULL,
	"stock_reserved" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "products_price_check" CHECK ("products"."price_vnd" between 1 and 9999999999),
	CONSTRAINT "products_stock_check" CHECK ("products"."stock_on_hand" >= 0 and "products"."stock_reserved" between 0 and "products"."stock_on_hand"),
	CONSTRAINT "products_version_check" CHECK ("products"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce_refund_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_refund_attempts_number_check" CHECK ("commerce_refund_attempts"."number" between 1 and 3),
	CONSTRAINT "commerce_refund_attempts_status_check" CHECK ("commerce_refund_attempts"."status" in ('pending', 'failed', 'unknown', 'settled'))
);
--> statement-breakpoint
CREATE TABLE "commerce_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"return_id" uuid,
	"reason" text NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"settlement_method" text,
	"settlement_reference" text,
	"settled_at" timestamp with time zone,
	"settled_by" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_refunds_money_check" CHECK ("commerce_refunds"."amount_vnd" between 1 and 9999999999),
	CONSTRAINT "commerce_refunds_attempts_check" CHECK ("commerce_refunds"."attempt_count" between 0 and 3),
	CONSTRAINT "commerce_refunds_reason_check" CHECK ("commerce_refunds"."reason" in ('cancellation', 'return', 'return_to_sender')),
	CONSTRAINT "commerce_refunds_status_check" CHECK ("commerce_refunds"."status" in ('pending', 'processing', 'unknown', 'needs_review', 'settled')),
	CONSTRAINT "commerce_refunds_method_check" CHECK ("commerce_refunds"."settlement_method" is null or "commerce_refunds"."settlement_method" in ('bank_transfer', 'cash')),
	CONSTRAINT "commerce_refunds_settled_check" CHECK (("commerce_refunds"."status" = 'settled' and "commerce_refunds"."settlement_reference" is not null and "commerce_refunds"."settled_at" is not null and "commerce_refunds"."settled_by" is not null and "commerce_refunds"."settlement_method" is not null) or ("commerce_refunds"."status" <> 'settled' and "commerce_refunds"."settlement_reference" is null and "commerce_refunds"."settled_at" is null and "commerce_refunds"."settled_by" is null and "commerce_refunds"."settlement_method" is null))
);
--> statement-breakpoint
CREATE TABLE "commerce_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"restocked_quantity" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "commerce_return_lines_quantities_check" CHECK ("commerce_return_lines"."quantity" between 1 and 99 and "commerce_return_lines"."received_quantity" between 0 and "commerce_return_lines"."quantity" and "commerce_return_lines"."restocked_quantity" between 0 and "commerce_return_lines"."received_quantity")
);
--> statement-breakpoint
CREATE TABLE "commerce_return_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"proof_reference" text NOT NULL,
	"items" jsonb NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"decision_reason" text,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_returns_status_check" CHECK ("commerce_returns"."status" in ('requested', 'approved', 'receiving', 'received', 'rejected', 'withdrawn', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "commerce_role_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"previous_role" text NOT NULL,
	"new_role" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"tracking_reference" text NOT NULL,
	"status" text DEFAULT 'in_transit' NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"proof_reference" text,
	"failure_reason" text,
	"delivered_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_shipments_status_check" CHECK ("commerce_shipments"."status" in ('in_transit', 'delivery_failed', 'delivered', 'returned')),
	CONSTRAINT "commerce_shipments_attempts_check" CHECK ("commerce_shipments"."failed_attempts" between 0 and 3),
	CONSTRAINT "commerce_shipments_lifecycle_check" CHECK (
      ("commerce_shipments"."status" in ('in_transit', 'delivery_failed') and "commerce_shipments"."delivered_at" is null and "commerce_shipments"."returned_at" is null)
      or ("commerce_shipments"."status" = 'delivered' and "commerce_shipments"."delivered_at" is not null and "commerce_shipments"."proof_reference" is not null and "commerce_shipments"."returned_at" is null)
      or ("commerce_shipments"."status" = 'returned' and "commerce_shipments"."returned_at" is not null and "commerce_shipments"."proof_reference" is not null and "commerce_shipments"."delivered_at" is null))
);
--> statement-breakpoint
CREATE TABLE "commerce_stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"order_id" uuid,
	"actor_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"on_hand_delta" integer NOT NULL,
	"reserved_delta" integer NOT NULL,
	"reason" text NOT NULL,
	"reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_stock_values_check" CHECK (
    ("commerce_stock_movements"."kind" = 'adjustment' and "commerce_stock_movements"."on_hand_delta" <> 0 and "commerce_stock_movements"."reserved_delta" = 0)
    or ("commerce_stock_movements"."kind" = 'reserve' and "commerce_stock_movements"."on_hand_delta" = 0 and "commerce_stock_movements"."reserved_delta" > 0 and "commerce_stock_movements"."order_id" is not null)
    or ("commerce_stock_movements"."kind" = 'release' and "commerce_stock_movements"."on_hand_delta" = 0 and "commerce_stock_movements"."reserved_delta" < 0 and "commerce_stock_movements"."order_id" is not null)
    or ("commerce_stock_movements"."kind" = 'ship' and "commerce_stock_movements"."on_hand_delta" < 0 and "commerce_stock_movements"."on_hand_delta" = "commerce_stock_movements"."reserved_delta" and "commerce_stock_movements"."order_id" is not null)
    or ("commerce_stock_movements"."kind" = 'return' and "commerce_stock_movements"."on_hand_delta" > 0 and "commerce_stock_movements"."reserved_delta" = 0 and "commerce_stock_movements"."order_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_cart_items" ADD CONSTRAINT "commerce_cart_items_cart_id_commerce_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."commerce_carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_cart_items" ADD CONSTRAINT "commerce_cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_carts" ADD CONSTRAINT "commerce_carts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_checkout_quotes" ADD CONSTRAINT "commerce_checkout_quotes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_checkout_quotes" ADD CONSTRAINT "commerce_checkout_quotes_cart_id_commerce_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."commerce_carts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_commands" ADD CONSTRAINT "commerce_commands_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_order_events" ADD CONSTRAINT "commerce_order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_order_events" ADD CONSTRAINT "commerce_order_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_commerce_checkout_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."commerce_checkout_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD CONSTRAINT "commerce_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD CONSTRAINT "commerce_payments_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" ADD CONSTRAINT "commerce_refund_attempts_refund_id_commerce_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."commerce_refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" ADD CONSTRAINT "commerce_refund_attempts_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_refunds" ADD CONSTRAINT "commerce_refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_refunds" ADD CONSTRAINT "commerce_refunds_return_id_commerce_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."commerce_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_refunds" ADD CONSTRAINT "commerce_refunds_settled_by_user_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_return_lines" ADD CONSTRAINT "commerce_return_lines_return_id_commerce_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."commerce_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_return_lines" ADD CONSTRAINT "commerce_return_lines_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_return_receipts" ADD CONSTRAINT "commerce_return_receipts_return_id_commerce_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."commerce_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_return_receipts" ADD CONSTRAINT "commerce_return_receipts_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_returns" ADD CONSTRAINT "commerce_returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_returns" ADD CONSTRAINT "commerce_returns_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_returns" ADD CONSTRAINT "commerce_returns_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_role_changes" ADD CONSTRAINT "commerce_role_changes_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_role_changes" ADD CONSTRAINT "commerce_role_changes_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_shipments" ADD CONSTRAINT "commerce_shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_stock_movements" ADD CONSTRAINT "commerce_stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_stock_movements" ADD CONSTRAINT "commerce_stock_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_stock_movements" ADD CONSTRAINT "commerce_stock_movements_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_role_idx" ON "user" USING btree ("role","id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_cart_items_line_idx" ON "commerce_cart_items" USING btree ("cart_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_carts_user_idx" ON "commerce_carts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "commerce_quotes_user_idx" ON "commerce_checkout_quotes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_commands_identity_idx" ON "commerce_commands" USING btree ("user_id","scope","key");--> statement-breakpoint
CREATE INDEX "commerce_events_order_idx" ON "commerce_order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_product_idx" ON "order_items" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_quote_idx" ON "orders" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "orders_queue_idx" ON "orders" USING btree ("status","assigned_to","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_payments_order_idx" ON "commerce_payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_payments_receipt_idx" ON "commerce_payments" USING btree ("method","reference");--> statement-breakpoint
CREATE INDEX "products_catalog_idx" ON "products" USING btree ("active","id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_refund_attempts_number_idx" ON "commerce_refund_attempts" USING btree ("refund_id","number");--> statement-breakpoint
CREATE INDEX "commerce_refunds_order_idx" ON "commerce_refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "commerce_refunds_work_idx" ON "commerce_refunds" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_refunds_settlement_idx" ON "commerce_refunds" USING btree ("settlement_method","settlement_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_return_lines_item_idx" ON "commerce_return_lines" USING btree ("return_id","order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_return_receipts_proof_idx" ON "commerce_return_receipts" USING btree ("proof_reference");--> statement-breakpoint
CREATE INDEX "commerce_returns_order_idx" ON "commerce_returns" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_shipments_order_idx" ON "commerce_shipments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_shipments_tracking_idx" ON "commerce_shipments" USING btree ("tracking_reference");--> statement-breakpoint
CREATE INDEX "commerce_stock_product_idx" ON "commerce_stock_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_stock_identity_idx" ON "commerce_stock_movements" USING btree ("product_id","kind","reference");