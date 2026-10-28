CREATE TABLE "commerce_payment_allocation_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"evidence_reference" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"cod_collection_id" uuid,
	"amount_vnd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_payment_allocations_money_check" CHECK ("commerce_payment_allocations"."amount_vnd" between 1 and 9999999999)
);
--> statement-breakpoint
ALTER TABLE "commerce_payments" DROP CONSTRAINT "commerce_payments_source_check";--> statement-breakpoint
ALTER TABLE "commerce_payment_allocation_adjustments" ADD CONSTRAINT "commerce_payment_allocation_adjustments_payment_id_commerce_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."commerce_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payment_allocation_adjustments" ADD CONSTRAINT "commerce_payment_allocation_adjustments_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payment_allocations" ADD CONSTRAINT "commerce_payment_allocations_payment_id_commerce_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."commerce_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payment_allocations" ADD CONSTRAINT "commerce_payment_allocations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payment_allocations" ADD CONSTRAINT "commerce_payment_allocations_collection_order_fk" FOREIGN KEY ("cod_collection_id","order_id") REFERENCES "public"."commerce_cod_collections"("id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_payment_allocation_adjustments_payment_idx" ON "commerce_payment_allocation_adjustments" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "commerce_payment_allocations_order_idx" ON "commerce_payment_allocations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "commerce_payment_allocations_collection_idx" ON "commerce_payment_allocations" USING btree ("cod_collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_payment_allocations_customer_idx" ON "commerce_payment_allocations" USING btree ("payment_id","order_id") WHERE "commerce_payment_allocations"."cod_collection_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_payment_allocations_carrier_idx" ON "commerce_payment_allocations" USING btree ("payment_id","cod_collection_id") WHERE "commerce_payment_allocations"."cod_collection_id" is not null;--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD CONSTRAINT "commerce_payments_source_check" CHECK ("commerce_payments"."source" in ('legacy', 'customer', 'carrier') and ("commerce_payments"."source" <> 'carrier' or "commerce_payments"."method" = 'cod'));
--> statement-breakpoint
-- Preserve existing attribution without changing any physical receipt or cash fact.
INSERT INTO "commerce_payment_allocations" (
  "payment_id", "order_id", "cod_collection_id", "amount_vnd", "created_at"
)
SELECT "id", "order_id", "cod_collection_id", "amount_vnd", "created_at"
FROM "commerce_payments";
--> statement-breakpoint
CREATE FUNCTION "commerce_check_payment_allocations"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  receipt_ids uuid[];
  receipt_id uuid;
  receipt record;
  allocated_vnd numeric;
BEGIN
  IF TG_TABLE_NAME = 'commerce_payments' THEN
    receipt_ids := ARRAY[NEW.id];
  ELSIF TG_OP = 'INSERT' THEN
    receipt_ids := ARRAY[NEW.payment_id];
  ELSIF TG_OP = 'DELETE' THEN
    receipt_ids := ARRAY[OLD.payment_id];
  ELSE
    receipt_ids := ARRAY[OLD.payment_id, NEW.payment_id];
  END IF;

  FOR receipt_id IN
    SELECT DISTINCT id FROM unnest(receipt_ids) AS affected(id) ORDER BY id
  LOOP
    -- Serialize budgets while remaining compatible with allocation FK key-share locks.
    SELECT "amount_vnd", "source", "method", "duplicate_of_id" INTO receipt
    FROM "commerce_payments" WHERE "id" = receipt_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT coalesce(sum("amount_vnd"), 0) INTO allocated_vnd
    FROM "commerce_payment_allocations" WHERE "payment_id" = receipt_id;
    IF receipt.duplicate_of_id IS NULL AND allocated_vnd > receipt.amount_vnd THEN
      RAISE EXCEPTION 'Payment allocations exceed the physical receipt amount'
        USING ERRCODE = '23514', CONSTRAINT = 'commerce_payment_allocation_total_check';
    END IF;

    IF EXISTS (
      SELECT 1 FROM "commerce_payment_allocations" AS allocation
      JOIN "orders" AS allocated_order ON allocated_order."id" = allocation."order_id"
      WHERE allocation."payment_id" = receipt_id AND (
        allocated_order."payment_method" <> receipt.method OR
        (receipt.source = 'carrier' AND allocation."cod_collection_id" IS NULL) OR
        (receipt.source <> 'carrier' AND allocation."cod_collection_id" IS NOT NULL)
      )
    ) THEN
      RAISE EXCEPTION 'Payment allocations do not match the receipt source or payment method'
        USING ERRCODE = '23514', CONSTRAINT = 'commerce_payment_allocation_source_check';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "commerce_payment_allocations_guard"
AFTER INSERT OR UPDATE OR DELETE ON "commerce_payment_allocations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "commerce_check_payment_allocations"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "commerce_payment_receipt_allocations_guard"
AFTER UPDATE OF "amount_vnd", "source", "method", "duplicate_of_id" ON "commerce_payments"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "commerce_check_payment_allocations"();
