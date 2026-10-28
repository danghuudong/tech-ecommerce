CREATE TABLE "commerce_carriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_carriers_code_check" CHECK ("commerce_carriers"."code" ~ '^[a-z0-9][a-z0-9._-]{1,63}$')
);
--> statement-breakpoint
CREATE TABLE "commerce_cod_collection_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"duplicate_ids" jsonb NOT NULL,
	"evidence_reference" text NOT NULL,
	"reason" text NOT NULL,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_payment_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"source" text NOT NULL,
	"cod_collection_id" uuid,
	"evidence_reference" text NOT NULL,
	"reason" text NOT NULL,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_payment_classifications_source_check" CHECK (("commerce_payment_classifications"."source" = 'customer' and "commerce_payment_classifications"."cod_collection_id" is null) or ("commerce_payment_classifications"."source" = 'carrier' and "commerce_payment_classifications"."cod_collection_id" is not null))
);
--> statement-breakpoint
DROP INDEX "commerce_cod_collections_receipt_idx";--> statement-breakpoint
ALTER TABLE "commerce_cod_collections" ADD COLUMN "carrier_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce_cod_collections" ADD COLUMN "reconciliation_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_cod_collections" ADD COLUMN "duplicate_of_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_review_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_review_escalated_at" timestamp with time zone;--> statement-breakpoint
-- Derive carrier identities from existing labels; preserve every original receipt.
-- Reject an ambiguous generated code instead of silently merging different labels.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "commerce_cod_collections" WHERE length(btrim("carrier")) < 2) THEN
    RAISE EXCEPTION 'Legacy carrier labels require verification before migration';
  END IF;
  IF EXISTS (
    SELECT code FROM (
      SELECT DISTINCT lower(btrim("carrier")) AS label,
        CASE WHEN lower(btrim("carrier")) ~ '^[a-z0-9][a-z0-9._-]{1,63}$'
          THEN lower(btrim("carrier")) ELSE 'legacy-' || md5(lower(btrim("carrier"))) END AS code
      FROM "commerce_cod_collections"
    ) labels GROUP BY code HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Conflicting legacy carrier identities require verification before migration';
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO "commerce_carriers" ("code", "name")
SELECT CASE WHEN lower(btrim("carrier")) ~ '^[a-z0-9][a-z0-9._-]{1,63}$'
  THEN lower(btrim("carrier")) ELSE 'legacy-' || md5(lower(btrim("carrier"))) END,
  min(btrim("carrier"))
FROM "commerce_cod_collections" GROUP BY lower(btrim("carrier"));
--> statement-breakpoint
UPDATE "commerce_cod_collections" c SET "carrier_id" = carrier."id"
FROM "commerce_carriers" carrier WHERE carrier."code" =
  CASE WHEN lower(btrim(c."carrier")) ~ '^[a-z0-9][a-z0-9._-]{1,63}$'
    THEN lower(btrim(c."carrier")) ELSE 'legacy-' || md5(lower(btrim(c."carrier"))) END;
--> statement-breakpoint
ALTER TABLE "commerce_cod_collections" ALTER COLUMN "carrier_id" SET NOT NULL;
--> statement-breakpoint
-- Case-equivalent historical duplicates need evidence. None are deleted or declared paid twice.
UPDATE "commerce_cod_collections" c SET "reconciliation_required" = true
FROM (SELECT "carrier_id", "reference" FROM "commerce_cod_collections"
  GROUP BY "carrier_id", "reference" HAVING count(*) > 1) duplicates
WHERE c."carrier_id" = duplicates."carrier_id" AND c."reference" = duplicates."reference";
--> statement-breakpoint
WITH logged AS (
  INSERT INTO "commerce_order_events" ("order_id", "actor_user_id", "actor_type", "type", "details")
  SELECT "order_id", NULL, 'system', 'cod_reconciliation_required',
    jsonb_build_object('actorRole', 'system', 'migration', '0003', 'responsibleRole', 'admin')
  FROM (
    SELECT "order_id" FROM "commerce_cod_collections" WHERE "reconciliation_required"
    UNION SELECT "order_id" FROM "commerce_payments" WHERE "method" = 'cod' AND "source" = 'legacy'
  ) affected RETURNING "order_id"
)
UPDATE "orders" SET "revision" = "revision" + 1, "updated_at" = clock_timestamp()
WHERE "id" IN (SELECT "order_id" FROM logged);
--> statement-breakpoint
-- Recover a deadline only from a recorded snapshot or an existing active reservation.
-- Closed historical orders lacking either retain NULL, reported as an unknown deadline.
WITH recovered AS (
  SELECT o."id", COALESCE((
    SELECT CASE WHEN pg_input_is_valid(candidate.value, 'timestamp with time zone')
      THEN candidate.value::timestamptz END
    FROM "commerce_order_events" e CROSS JOIN LATERAL (
      SELECT COALESCE(e."details"->>'paymentDeadlineAt', e."details"->>'reservationExpiresAt',
        e."details"->>'deadline', e."details"->>'expiredAt') AS value
    ) candidate
    WHERE e."order_id" = o."id" AND e."type" IN ('order_placed', 'bank_statement_review_required',
      'bank_deadline_reconciled', 'order_reservation_expired', 'payment_deadline_satisfied')
      AND pg_input_is_valid(candidate.value, 'timestamp with time zone')
    ORDER BY CASE WHEN e."type" = 'order_placed' THEN 0 ELSE 1 END, e."created_at", e."id" LIMIT 1
  ), o."reservation_expires_at") AS deadline
  FROM "orders" o WHERE o."payment_method" = 'bank_transfer'
)
UPDATE "orders" o SET "payment_deadline_at" = r.deadline,
  "payment_review_due_at" = r.deadline + interval '2 hours'
FROM recovered r WHERE r."id" = o."id" AND r.deadline IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "commerce_carriers" ADD CONSTRAINT "commerce_carriers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_cod_collection_reconciliations" ADD CONSTRAINT "commerce_cod_collection_reconciliations_collection_id_commerce_cod_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."commerce_cod_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_cod_collection_reconciliations" ADD CONSTRAINT "commerce_cod_collection_reconciliations_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payment_classifications" ADD CONSTRAINT "commerce_payment_classifications_payment_id_commerce_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."commerce_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payment_classifications" ADD CONSTRAINT "commerce_payment_classifications_cod_collection_id_commerce_cod_collections_id_fk" FOREIGN KEY ("cod_collection_id") REFERENCES "public"."commerce_cod_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payment_classifications" ADD CONSTRAINT "commerce_payment_classifications_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_carriers_code_idx" ON "commerce_carriers" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_cod_reconciliations_collection_idx" ON "commerce_cod_collection_reconciliations" USING btree ("collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_payment_classifications_payment_idx" ON "commerce_payment_classifications" USING btree ("payment_id");--> statement-breakpoint
ALTER TABLE "commerce_cod_collections" ADD CONSTRAINT "commerce_cod_collections_carrier_id_commerce_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."commerce_carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_cod_collections" ADD CONSTRAINT "commerce_cod_collections_duplicate_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."commerce_cod_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_cod_collections_lookup_idx" ON "commerce_cod_collections" USING btree ("carrier_id","reference");--> statement-breakpoint
CREATE INDEX "orders_payment_review_due_idx" ON "orders" USING btree ("payment_review_due_at") WHERE "orders"."reservation_expires_at" is not null and "orders"."payment_method" = 'bank_transfer' and "orders"."payment_review_escalated_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_cod_collections_receipt_idx" ON "commerce_cod_collections" USING btree ("carrier_id","reference") WHERE "commerce_cod_collections"."duplicate_of_id" is null and not "commerce_cod_collections"."reconciliation_required";--> statement-breakpoint
ALTER TABLE "commerce_cod_collections" ADD CONSTRAINT "commerce_cod_collections_duplicate_check" CHECK ("commerce_cod_collections"."duplicate_of_id" is null or ("commerce_cod_collections"."duplicate_of_id" <> "commerce_cod_collections"."id" and not "commerce_cod_collections"."reconciliation_required"));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_deadline_check" CHECK (("orders"."payment_deadline_at" is null and "orders"."payment_review_due_at" is null) or ("orders"."payment_method" = 'bank_transfer' and "orders"."payment_deadline_at" is not null and "orders"."payment_review_due_at" is not null and "orders"."payment_review_due_at" > "orders"."payment_deadline_at"));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_escalation_check" CHECK ("orders"."payment_review_escalated_at" is null or ("orders"."payment_method" = 'bank_transfer' and "orders"."payment_review_due_at" is not null and "orders"."payment_review_escalated_at" >= "orders"."payment_review_due_at"));
