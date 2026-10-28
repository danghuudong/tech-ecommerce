CREATE TABLE IF NOT EXISTS "commerce_collection_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"disposition" text NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"responsible_party" text NOT NULL,
	"reference" text NOT NULL,
	"reason" text NOT NULL,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_collection_decisions_values_check" CHECK ("commerce_collection_decisions"."disposition" in ('debt', 'written_off') and "commerce_collection_decisions"."amount_vnd" between 1 and 9999999999),
	CONSTRAINT "commerce_collection_decisions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "commerce_collection_decisions_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" DROP CONSTRAINT IF EXISTS "commerce_refund_attempts_number_check";--> statement-breakpoint
ALTER TABLE "commerce_refunds" DROP CONSTRAINT IF EXISTS "commerce_refunds_attempts_check";--> statement-breakpoint
ALTER TABLE "commerce_refunds" DROP CONSTRAINT IF EXISTS "commerce_refunds_reason_check";--> statement-breakpoint
ALTER TABLE "commerce_refunds" DROP CONSTRAINT IF EXISTS "commerce_refunds_status_check";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_reservation_check";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_collection_resolution_check";--> statement-breakpoint
DROP INDEX IF EXISTS "commerce_payments_order_idx";--> statement-breakpoint
ALTER TABLE "commerce_order_events" ALTER COLUMN "actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_stock_movements" ALTER COLUMN "actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_order_events" ADD COLUMN IF NOT EXISTS "actor_type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "collection_resolution" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "reservation_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" ADD COLUMN IF NOT EXISTS "mode" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" ADD COLUMN IF NOT EXISTS "recovery_reason" text;--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" ADD COLUMN IF NOT EXISTS "resolved_by" text;--> statement-breakpoint
ALTER TABLE "commerce_stock_movements" ADD COLUMN IF NOT EXISTS "actor_type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint

-- Preserve historical system events and stock movements from earlier schema revisions.
UPDATE "commerce_order_events" SET "actor_type" = 'system' WHERE "actor_user_id" IS NULL;--> statement-breakpoint
UPDATE "commerce_stock_movements" SET "actor_type" = 'system' WHERE "actor_user_id" IS NULL;--> statement-breakpoint

-- Backfill durable deadlines using the agreed 30-minute / 24-hour policy.
-- Existing bank receipts and COD confirmation continue to end the reservation deadline.
UPDATE "orders" AS o SET "reservation_expires_at" = NULL
WHERE "reservation_expires_at" IS NOT NULL AND (
  "stock_state" <> 'reserved'
  OR "status" NOT IN ('placed', 'confirmed')
  OR ("payment_method" = 'cod' AND "status" <> 'placed')
  OR ("payment_method" = 'bank_transfer' AND
    COALESCE((SELECT SUM(p."amount_vnd") FROM "commerce_payments" p WHERE p."order_id" = o."id"), 0) >= o."total_vnd")
);--> statement-breakpoint
UPDATE "orders" AS o SET "reservation_expires_at" = o."created_at" +
  CASE WHEN o."payment_method" = 'bank_transfer' THEN interval '30 minutes' ELSE interval '24 hours' END
WHERE o."reservation_expires_at" IS NULL AND o."stock_state" = 'reserved' AND (
  (o."payment_method" = 'cod' AND o."status" = 'placed')
  OR (o."payment_method" = 'bank_transfer' AND o."status" IN ('placed', 'confirmed') AND
    COALESCE((SELECT SUM(p."amount_vnd") FROM "commerce_payments" p WHERE p."order_id" = o."id"), 0) < o."total_vnd")
);--> statement-breakpoint
UPDATE "orders" AS o SET "collection_resolution" = 'collected'
WHERE o."payment_method" = 'cod' AND o."collection_resolution" = 'open' AND
  COALESCE((SELECT SUM(p."amount_vnd") FROM "commerce_payments" p WHERE p."order_id" = o."id"), 0) >= o."total_vnd";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "commerce_collection_decisions_disposition_idx" ON "commerce_collection_decisions" USING btree ("order_id","disposition");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commerce_collection_decisions_reference_idx" ON "commerce_collection_decisions" USING btree ("reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commerce_collection_decisions_order_idx" ON "commerce_collection_decisions" USING btree ("order_id","created_at");--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.commerce_refund_attempts'::regclass
      AND conname = 'commerce_refund_attempts_resolved_by_user_id_fk'
  ) THEN
    ALTER TABLE "commerce_refund_attempts" ADD CONSTRAINT "commerce_refund_attempts_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_reservation_expiry_idx" ON "orders" USING btree ("reservation_expires_at") WHERE "orders"."reservation_expires_at" is not null;--> statement-breakpoint
CREATE INDEX "commerce_payments_order_idx" ON "commerce_payments" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "commerce_order_events" ADD CONSTRAINT "commerce_events_actor_check" CHECK (("commerce_order_events"."actor_type" = 'user' and "commerce_order_events"."actor_user_id" is not null) or ("commerce_order_events"."actor_type" = 'system' and "commerce_order_events"."actor_user_id" is null));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_reservation_check" CHECK ("orders"."reservation_expires_at" is null or ("orders"."stock_state" = 'reserved' and ("orders"."status" = 'placed' or ("orders"."status" = 'confirmed' and "orders"."payment_method" = 'bank_transfer'))));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_collection_resolution_check" CHECK ("orders"."collection_resolution" in ('open', 'debt', 'written_off', 'collected') and ("orders"."collection_resolution" = 'open' or "orders"."payment_method" = 'cod'));--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" ADD CONSTRAINT "commerce_refund_attempts_number_check" CHECK ("commerce_refund_attempts"."number" > 0 and (("commerce_refund_attempts"."mode" = 'standard' and "commerce_refund_attempts"."number" <= 3 and "commerce_refund_attempts"."recovery_reason" is null) or ("commerce_refund_attempts"."mode" = 'manual' and "commerce_refund_attempts"."number" > 3 and "commerce_refund_attempts"."recovery_reason" is not null)));--> statement-breakpoint
ALTER TABLE "commerce_refunds" ADD CONSTRAINT "commerce_refunds_funding_check" CHECK ("commerce_refunds"."status" <> 'awaiting_payment' or ("commerce_refunds"."reason" = 'return' and "commerce_refunds"."attempt_count" = 0));--> statement-breakpoint
ALTER TABLE "commerce_refunds" ADD CONSTRAINT "commerce_refunds_attempts_check" CHECK ("commerce_refunds"."attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "commerce_refunds" ADD CONSTRAINT "commerce_refunds_reason_check" CHECK ("commerce_refunds"."reason" in ('cancellation', 'return', 'return_to_sender', 'overpayment'));--> statement-breakpoint
ALTER TABLE "commerce_refunds" ADD CONSTRAINT "commerce_refunds_status_check" CHECK ("commerce_refunds"."status" in ('awaiting_payment', 'pending', 'processing', 'unknown', 'needs_review', 'settled'));--> statement-breakpoint
ALTER TABLE "commerce_stock_movements" ADD CONSTRAINT "commerce_stock_actor_check" CHECK (("commerce_stock_movements"."actor_type" = 'user' and "commerce_stock_movements"."actor_user_id" is not null) or ("commerce_stock_movements"."actor_type" = 'system' and "commerce_stock_movements"."actor_user_id" is null));
