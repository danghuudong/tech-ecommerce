CREATE TABLE "commerce_cod_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" text NOT NULL,
	"reference" text NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_cod_collections_money_check" CHECK ("commerce_cod_collections"."amount_vnd" between 1 and 9999999999 and "commerce_cod_collections"."currency" = 'VND')
);
--> statement-breakpoint
CREATE TABLE "commerce_refund_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_id" uuid NOT NULL,
	"attempt_id" uuid,
	"amount_vnd" bigint NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"method" text NOT NULL,
	"reference" text NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_refund_settlements_money_check" CHECK ("commerce_refund_settlements"."amount_vnd" between 1 and 9999999999 and "commerce_refund_settlements"."currency" = 'VND' and "commerce_refund_settlements"."method" in ('bank_transfer', 'cash'))
);
--> statement-breakpoint
ALTER TABLE "commerce_collection_decisions" DROP CONSTRAINT "commerce_collection_decisions_values_check";--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" DROP CONSTRAINT "commerce_refund_attempts_status_check";--> statement-breakpoint
ALTER TABLE "commerce_refunds" DROP CONSTRAINT "commerce_refunds_money_check";--> statement-breakpoint
ALTER TABLE "commerce_refunds" DROP CONSTRAINT "commerce_refunds_status_check";--> statement-breakpoint
DROP INDEX "commerce_collection_decisions_disposition_idx";--> statement-breakpoint
ALTER TABLE "commerce_collection_decisions" ADD COLUMN "party" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_collection_decisions" ADD COLUMN "cash_received_vnd_at_decision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_review_required_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "carrier_collection_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "carrier_collection_issue_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "carrier_collection_resolution" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD COLUMN "source" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD COLUMN "cod_collection_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" ADD COLUMN "requested_amount_vnd" bigint;--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" ADD COLUMN "settled_amount_vnd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" ADD COLUMN "remainder_not_sent_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_refunds" ADD COLUMN "original_amount_vnd" bigint;--> statement-breakpoint
ALTER TABLE "commerce_returns" ADD COLUMN "responsibility" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
-- Preserve the actual amounts and receipts of historical attempts before enforcing NOT NULL.
UPDATE "commerce_refund_attempts" a
SET "requested_amount_vnd" = r."amount_vnd",
    "settled_amount_vnd" = CASE WHEN a."status" = 'settled' THEN r."amount_vnd" ELSE 0 END,
    "remainder_not_sent_verified" = a."status" IN ('failed', 'settled')
FROM "commerce_refunds" r WHERE r."id" = a."refund_id";
--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" ALTER COLUMN "requested_amount_vnd" SET NOT NULL;
--> statement-breakpoint
-- A historical settled refund is an actual receipt, not a new transfer.
INSERT INTO "commerce_refund_settlements"
  ("refund_id", "attempt_id", "amount_vnd", "method", "reference", "settled_at", "recorded_by", "created_at")
SELECT r."id", a."id", r."amount_vnd", r."settlement_method", r."settlement_reference",
       r."settled_at", r."settled_by", r."updated_at"
FROM "commerce_refunds" r
LEFT JOIN LATERAL (
  SELECT "id" FROM "commerce_refund_attempts" WHERE "refund_id" = r."id" AND "status" = 'settled'
  ORDER BY "number" DESC LIMIT 1
) a ON true WHERE r."status" = 'settled';
--> statement-breakpoint
-- Existing receipts have no reliable carrier attribution; retain their legacy source.
-- Snapshot only cash that was already recorded when each decision was made.
UPDATE "commerce_collection_decisions" d
SET "cash_received_vnd_at_decision" = COALESCE((
  SELECT sum(p."amount_vnd") FROM "commerce_payments" p
  WHERE p."order_id" = d."order_id" AND p."created_at" <= d."created_at"
), 0) - COALESCE((
  SELECT sum(s."amount_vnd") FROM "commerce_refund_settlements" s
  JOIN "commerce_refunds" r ON r."id" = s."refund_id"
  WHERE r."order_id" = d."order_id" AND s."created_at" <= d."created_at"
), 0);
--> statement-breakpoint
-- Correct only obligations with no attempt. Never rewrite an unresolved transfer.
-- Accepted return quantities are the goods credit; legacy responsibility stays customer.
WITH financials AS (
  SELECT o."id", greatest(0, COALESCE((SELECT sum(p."amount_vnd") FROM "commerce_payments" p
    WHERE p."order_id" = o."id"), 0) - CASE WHEN o."status" = 'cancelled' THEN 0
    ELSE o."total_vnd" - COALESCE((SELECT sum(l."received_quantity" * i."unit_price_vnd")
      FROM "commerce_return_lines" l JOIN "commerce_returns" t ON t."id" = l."return_id"
      JOIN "order_items" i ON i."id" = l."order_item_id" WHERE t."order_id" = o."id"), 0) END) AS entitlement,
    COALESCE((SELECT sum(r."amount_vnd") FROM "commerce_refunds" r
      WHERE r."order_id" = o."id" AND NOT (r."attempt_count" = 0 AND r."status" IN ('pending', 'awaiting_payment'))), 0) AS protected
  FROM "orders" o
), allocation AS (
  SELECT r."id", r."amount_vnd" AS previous_amount, r."status" AS previous_status,
    greatest(0, least(r."amount_vnd", f.entitlement - f.protected - COALESCE(
      sum(r."amount_vnd") OVER (PARTITION BY r."order_id" ORDER BY r."created_at", r."id"
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)))::bigint AS amount
  FROM "commerce_refunds" r JOIN financials f ON f."id" = r."order_id"
  WHERE r."attempt_count" = 0 AND r."status" IN ('pending', 'awaiting_payment')
), changed AS (
  UPDATE "commerce_refunds" r SET
    "original_amount_vnd" = CASE WHEN a.amount <> r."amount_vnd" THEN COALESCE(r."original_amount_vnd", r."amount_vnd") ELSE r."original_amount_vnd" END,
    "amount_vnd" = CASE WHEN a.amount > 0 THEN a.amount ELSE r."amount_vnd" END,
    "status" = CASE WHEN a.amount > 0 THEN 'pending' ELSE 'voided' END,
    "updated_at" = clock_timestamp()
  FROM allocation a WHERE a."id" = r."id" AND (a.amount <> r."amount_vnd" OR a.previous_status = 'awaiting_payment')
  RETURNING r."id", r."order_id", a.previous_amount, a.amount, r."status"
), logged AS (
  INSERT INTO "commerce_order_events" ("order_id", "actor_user_id", "actor_type", "type", "details")
  SELECT "order_id", NULL, 'system', 'refund_balance_reconciled',
    jsonb_build_object('actorRole', 'system', 'migration', '0002', 'refundId', "id",
      'previousAmountVnd', previous_amount, 'amountVnd', amount, 'status', "status") FROM changed
  RETURNING "order_id"
)
UPDATE "orders" SET "revision" = "revision" + 1, "updated_at" = clock_timestamp()
WHERE "id" IN (SELECT "order_id" FROM logged);
--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_refund_attempts_identity_idx" ON "commerce_refund_attempts" USING btree ("id","refund_id");--> statement-breakpoint
ALTER TABLE "commerce_cod_collections" ADD CONSTRAINT "commerce_cod_collections_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_cod_collections" ADD CONSTRAINT "commerce_cod_collections_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_refund_settlements" ADD CONSTRAINT "commerce_refund_settlements_refund_id_commerce_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."commerce_refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_refund_settlements" ADD CONSTRAINT "commerce_refund_settlements_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_refund_settlements" ADD CONSTRAINT "commerce_refund_settlements_attempt_refund_fk" FOREIGN KEY ("attempt_id","refund_id") REFERENCES "public"."commerce_refund_attempts"("id","refund_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_cod_collections_order_idx" ON "commerce_cod_collections" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_cod_collections_receipt_idx" ON "commerce_cod_collections" USING btree ("carrier","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_cod_collections_identity_idx" ON "commerce_cod_collections" USING btree ("id","order_id");--> statement-breakpoint
CREATE INDEX "commerce_refund_settlements_refund_idx" ON "commerce_refund_settlements" USING btree ("refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_refund_settlements_receipt_idx" ON "commerce_refund_settlements" USING btree ("method","reference");--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD CONSTRAINT "commerce_payments_collection_order_fk" FOREIGN KEY ("cod_collection_id","order_id") REFERENCES "public"."commerce_cod_collections"("id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_payments_collection_idx" ON "commerce_payments" USING btree ("cod_collection_id");--> statement-breakpoint
CREATE INDEX "commerce_collection_decisions_disposition_idx" ON "commerce_collection_decisions" USING btree ("order_id","party","disposition");--> statement-breakpoint
ALTER TABLE "commerce_collection_decisions" ADD CONSTRAINT "commerce_collection_decisions_values_check" CHECK ("commerce_collection_decisions"."disposition" in ('debt', 'written_off') and "commerce_collection_decisions"."party" in ('customer', 'carrier') and "commerce_collection_decisions"."amount_vnd" between 1 and 9999999999 and "commerce_collection_decisions"."cash_received_vnd_at_decision" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_review_check" CHECK ("orders"."payment_review_required_at" is null or ("orders"."payment_method" = 'bank_transfer' and "orders"."reservation_expires_at" is not null and "orders"."stock_state" = 'reserved'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_carrier_collection_check" CHECK ("orders"."carrier_collection_failure_count" between 0 and 3 and "orders"."carrier_collection_resolution" in ('open', 'debt', 'written_off', 'collected') and ("orders"."carrier_collection_failure_count" = 0 or "orders"."carrier_collection_issue_reason" is not null) and ("orders"."payment_method" = 'cod' or ("orders"."carrier_collection_failure_count" = 0 and "orders"."carrier_collection_resolution" = 'open')));--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD CONSTRAINT "commerce_payments_source_check" CHECK ("commerce_payments"."source" in ('legacy', 'customer', 'carrier') and (("commerce_payments"."source" = 'carrier' and "commerce_payments"."method" = 'cod' and "commerce_payments"."cod_collection_id" is not null) or ("commerce_payments"."source" <> 'carrier' and "commerce_payments"."cod_collection_id" is null)));--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" ADD CONSTRAINT "commerce_refund_attempts_money_check" CHECK ("commerce_refund_attempts"."requested_amount_vnd" between 1 and 9999999999 and "commerce_refund_attempts"."settled_amount_vnd" between 0 and "commerce_refund_attempts"."requested_amount_vnd");--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" ADD CONSTRAINT "commerce_refund_attempts_outcome_check" CHECK (("commerce_refund_attempts"."status" <> 'settled' or "commerce_refund_attempts"."settled_amount_vnd" = "commerce_refund_attempts"."requested_amount_vnd") and ("commerce_refund_attempts"."status" <> 'failed' or ("commerce_refund_attempts"."settled_amount_vnd" = 0 and "commerce_refund_attempts"."remainder_not_sent_verified")) and ("commerce_refund_attempts"."status" <> 'partially_settled' or ("commerce_refund_attempts"."settled_amount_vnd" > 0 and "commerce_refund_attempts"."settled_amount_vnd" < "commerce_refund_attempts"."requested_amount_vnd")));--> statement-breakpoint
ALTER TABLE "commerce_refund_attempts" ADD CONSTRAINT "commerce_refund_attempts_status_check" CHECK ("commerce_refund_attempts"."status" in ('pending', 'failed', 'unknown', 'settled', 'partially_settled'));--> statement-breakpoint
ALTER TABLE "commerce_refunds" ADD CONSTRAINT "commerce_refunds_money_check" CHECK ("commerce_refunds"."amount_vnd" between 1 and 9999999999 and ("commerce_refunds"."original_amount_vnd" is null or "commerce_refunds"."original_amount_vnd" between 1 and 9999999999));--> statement-breakpoint
ALTER TABLE "commerce_refunds" ADD CONSTRAINT "commerce_refunds_status_check" CHECK ("commerce_refunds"."status" in ('awaiting_payment', 'pending', 'processing', 'unknown', 'needs_review', 'settled', 'partially_settled', 'voided'));--> statement-breakpoint
ALTER TABLE "commerce_returns" ADD CONSTRAINT "commerce_returns_responsibility_check" CHECK ("commerce_returns"."responsibility" in ('customer', 'store', 'carrier'));
