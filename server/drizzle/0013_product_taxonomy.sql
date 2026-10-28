-- Adopt category columns already present in development databases without
-- overwriting their values. Unknown legacy metadata stays NULL.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "category" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "brand" text;--> statement-breakpoint
CREATE INDEX "products_category_catalog_idx" ON "products" USING btree ("active","category","id");--> statement-breakpoint
CREATE INDEX "products_brand_catalog_idx" ON "products" USING btree ("active","brand","id");--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_category_check";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_check" CHECK ("products"."category" in ('laptop', 'phone', 'desktop', 'monitor', 'audio', 'accessories', 'gaming', 'office'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_check" CHECK (char_length("products"."brand") between 1 and 80 and "products"."brand" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
