CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"alt_text" text NOT NULL,
	"media_type" text NOT NULL,
	"content" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "product_images_position_check" CHECK ("product_images"."position" >= 0),
	CONSTRAINT "product_images_type_check" CHECK ("product_images"."media_type" in ('image/webp', 'image/jpeg', 'image/png')),
	CONSTRAINT "product_images_alt_check" CHECK (length(btrim("product_images"."alt_text")) between 1 and 200),
	CONSTRAINT "product_images_content_check" CHECK (octet_length("product_images"."content") between 16 and 524288 and "product_images"."sha256" = encode(sha256("product_images"."content"), 'hex'))
);
--> statement-breakpoint
CREATE TABLE "product_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"answered_by" text,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "product_questions_question_check" CHECK (length(btrim("product_questions"."question")) between 5 and 1000),
	CONSTRAINT "product_questions_answer_check" CHECK ("product_questions"."answer" is null or length(btrim("product_questions"."answer")) between 2 and 2000),
	CONSTRAINT "product_questions_status_check" CHECK ("product_questions"."status" in ('pending', 'answered', 'hidden')),
	CONSTRAINT "product_questions_answered_check" CHECK ("product_questions"."status" <> 'answered' or ("product_questions"."answer" is not null and "product_questions"."answered_by" is not null and "product_questions"."answered_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "product_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"moderated_by" text,
	"moderated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "product_reviews_rating_check" CHECK ("product_reviews"."rating" between 1 and 5),
	CONSTRAINT "product_reviews_comment_check" CHECK (length(btrim("product_reviews"."comment")) between 10 and 2000),
	CONSTRAINT "product_reviews_status_check" CHECK ("product_reviews"."status" in ('published', 'hidden'))
);
--> statement-breakpoint
CREATE TABLE "product_store_availability" (
	"product_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"status" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "product_store_availability_product_id_store_id_pk" PRIMARY KEY("product_id","store_id"),
	CONSTRAINT "product_store_availability_status_check" CHECK ("product_store_availability"."status" in ('in_stock', 'low_stock', 'out_of_stock'))
);
--> statement-breakpoint
CREATE TABLE "commerce_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"province" text NOT NULL,
	"phone" text,
	"opening_hours" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_stores_name_check" CHECK (length(btrim("commerce_stores"."name")) between 2 and 120),
	CONSTRAINT "commerce_stores_address_check" CHECK (length(btrim("commerce_stores"."address")) between 5 and 300),
	CONSTRAINT "commerce_stores_province_check" CHECK (length(btrim("commerce_stores"."province")) between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variant_group" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variant_options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variant_rank" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_answered_by_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_moderated_by_user_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_store_availability" ADD CONSTRAINT "product_store_availability_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_store_availability" ADD CONSTRAINT "product_store_availability_store_id_commerce_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."commerce_stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_store_availability" ADD CONSTRAINT "product_store_availability_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_content_idx" ON "product_images" USING btree ("product_id","sha256");--> statement-breakpoint
CREATE INDEX "product_questions_public_idx" ON "product_questions" USING btree ("product_id","status","answered_at");--> statement-breakpoint
CREATE INDEX "product_questions_queue_idx" ON "product_questions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "product_questions_author_idx" ON "product_questions" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "product_reviews_author_idx" ON "product_reviews" USING btree ("product_id","user_id");--> statement-breakpoint
CREATE INDEX "product_reviews_public_idx" ON "product_reviews" USING btree ("product_id","status","created_at");--> statement-breakpoint
CREATE INDEX "product_reviews_moderation_idx" ON "product_reviews" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "product_store_availability_store_idx" ON "product_store_availability" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "commerce_stores_active_idx" ON "commerce_stores" USING btree ("active","province");--> statement-breakpoint
CREATE INDEX "products_variant_group_idx" ON "products" USING btree ("variant_group","active");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_variant_group_check" CHECK ("products"."variant_group" is null or (char_length("products"."variant_group") between 1 and 80 and "products"."variant_group" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_variant_rank_check" CHECK ("products"."variant_rank" between 0 and 9999);--> statement-breakpoint
-- Demo variants for the iPhone 15, only where that demo product exists.
-- New variants start with no stock: quantities enter through the stock ledger.
UPDATE "products"
SET "name" = 'iPhone 15 128GB Đen',
	"variant_group" = 'iphone-15',
	"variant_options" = '[{"name":"Dung lượng","value":"128GB"},{"name":"Màu sắc","value":"Đen"}]'::jsonb,
	"version" = "version" + 1,
	"updated_at" = CURRENT_TIMESTAMP
WHERE "sku" = 'DEMO-IPHONE-15-128'
	AND "name" = 'iPhone 15 128GB';
--> statement-breakpoint
WITH variant (sku, name, storage, options, price_step, list_step, rank) AS (
	VALUES
		('DEMO-IPHONE-15-128-BLUE', 'iPhone 15 128GB Xanh Dương', '128GB', '[{"name":"Dung lượng","value":"128GB"},{"name":"Màu sắc","value":"Xanh Dương"}]'::jsonb, 0::bigint, 0::bigint, 1::integer),
		('DEMO-IPHONE-15-128-PINK', 'iPhone 15 128GB Hồng', '128GB', '[{"name":"Dung lượng","value":"128GB"},{"name":"Màu sắc","value":"Hồng"}]'::jsonb, 0::bigint, 0::bigint, 2::integer),
		('DEMO-IPHONE-15-128-YELLOW', 'iPhone 15 128GB Vàng', '128GB', '[{"name":"Dung lượng","value":"128GB"},{"name":"Màu sắc","value":"Vàng"}]'::jsonb, 0::bigint, 0::bigint, 3::integer),
		('DEMO-IPHONE-15-128-GREEN', 'iPhone 15 128GB Xanh Lá', '128GB', '[{"name":"Dung lượng","value":"128GB"},{"name":"Màu sắc","value":"Xanh Lá"}]'::jsonb, 0::bigint, 0::bigint, 4::integer),
		('DEMO-IPHONE-15-256-BLACK', 'iPhone 15 256GB Đen', '256GB', '[{"name":"Dung lượng","value":"256GB"},{"name":"Màu sắc","value":"Đen"}]'::jsonb, 3000000::bigint, 3000000::bigint, 5::integer)
)
INSERT INTO "products" (
	"sku", "name", "description", "overview", "category", "brand", "price_vnd",
	"list_price_vnd", "highlights", "specifications", "package_contents",
	"warranty_months", "variant_group", "variant_options", "variant_rank"
)
SELECT variant.sku, variant.name,
	replace(base."description", '128GB', variant.storage), base."overview",
	base."category", base."brand", base."price_vnd" + variant.price_step,
	base."list_price_vnd" + variant.list_step, base."highlights",
	replace(base."specifications"::text, '128 GB', replace(variant.storage, 'GB', ' GB'))::jsonb,
	base."package_contents", base."warranty_months", 'iphone-15',
	variant.options, variant.rank
FROM variant
CROSS JOIN "products" AS base
WHERE base."sku" = 'DEMO-IPHONE-15-128'
	AND base."variant_group" = 'iphone-15'
ON CONFLICT ("sku") DO NOTHING;
