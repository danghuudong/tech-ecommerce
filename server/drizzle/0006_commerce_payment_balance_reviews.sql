CREATE TABLE "commerce_payment_balance_review_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"disposition" text NOT NULL,
	"responsible_party" text NOT NULL,
	"evidence_reference" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_payment_balance_review_decisions_disposition_check" CHECK ("commerce_payment_balance_review_decisions"."disposition" in ('debt', 'written_off'))
);
--> statement-breakpoint
CREATE TABLE "commerce_payment_balance_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text DEFAULT 'needs_review' NOT NULL,
	"discrepancy_vnd" bigint DEFAULT 0 NOT NULL,
	"disposition" text,
	"approved_amount_vnd" bigint DEFAULT 0 NOT NULL,
	"recovered_vnd_at_decision" bigint DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_payment_balance_reviews_values_check" CHECK ("commerce_payment_balance_reviews"."revision" >= 1 and "commerce_payment_balance_reviews"."discrepancy_vnd" between 0 and 9007199254740991 and "commerce_payment_balance_reviews"."approved_amount_vnd" between 0 and 9007199254740991 and "commerce_payment_balance_reviews"."recovered_vnd_at_decision" between 0 and 9007199254740991 and "commerce_payment_balance_reviews"."status" in ('needs_review', 'debt', 'written_off', 'resolved') and ("commerce_payment_balance_reviews"."disposition" is null or "commerce_payment_balance_reviews"."disposition" in ('debt', 'written_off')) and (("commerce_payment_balance_reviews"."disposition" is null and "commerce_payment_balance_reviews"."approved_amount_vnd" = 0 and "commerce_payment_balance_reviews"."recovered_vnd_at_decision" = 0) or ("commerce_payment_balance_reviews"."disposition" is not null and "commerce_payment_balance_reviews"."approved_amount_vnd" > 0)))
);
--> statement-breakpoint
DROP INDEX "commerce_payment_allocations_customer_idx";--> statement-breakpoint
ALTER TABLE "commerce_payment_allocations" ADD COLUMN "purpose" text DEFAULT 'payment' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_payment_allocations" ADD COLUMN "review_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce_payment_balance_review_decisions" ADD CONSTRAINT "commerce_payment_balance_review_decisions_review_id_commerce_payment_balance_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."commerce_payment_balance_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payment_balance_review_decisions" ADD CONSTRAINT "commerce_payment_balance_review_decisions_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payment_balance_reviews" ADD CONSTRAINT "commerce_payment_balance_reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_payment_balance_review_decisions_review_idx" ON "commerce_payment_balance_review_decisions" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_payment_balance_reviews_order_idx" ON "commerce_payment_balance_reviews" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_payment_balance_reviews_identity_idx" ON "commerce_payment_balance_reviews" USING btree ("id","order_id");--> statement-breakpoint
CREATE INDEX "commerce_payment_balance_reviews_work_idx" ON "commerce_payment_balance_reviews" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "commerce_payment_allocations" ADD CONSTRAINT "commerce_payment_allocations_review_order_fk" FOREIGN KEY ("review_id","order_id") REFERENCES "public"."commerce_payment_balance_reviews"("id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_payment_allocations_customer_idx" ON "commerce_payment_allocations" USING btree ("payment_id","order_id","purpose") WHERE "commerce_payment_allocations"."cod_collection_id" is null;--> statement-breakpoint
ALTER TABLE "commerce_payment_allocations" ADD CONSTRAINT "commerce_payment_allocations_purpose_check" CHECK (("commerce_payment_allocations"."purpose" = 'payment' and "commerce_payment_allocations"."review_id" is null) or ("commerce_payment_allocations"."purpose" = 'refund_recovery' and "commerce_payment_allocations"."review_id" is not null and "commerce_payment_allocations"."cod_collection_id" is null));
--> statement-breakpoint
-- Open work for verified historic discrepancies, including already settled refunds.
-- Existing receipt/settlement facts and allocations are not rewritten.
WITH receipt_cash AS (
  SELECT a.order_id,
    coalesce(sum(a.amount_vnd) FILTER (WHERE p.source = 'customer' OR (p.source = 'legacy' AND p.method = 'bank_transfer')), 0) AS paid_vnd,
    bool_or(p.receipt_reconciliation_required OR (p.source = 'legacy' AND p.method = 'cod')) AS uncertain
  FROM commerce_payment_allocations a JOIN commerce_payments p ON p.id = a.payment_id
  WHERE p.duplicate_of_id IS NULL
  GROUP BY a.order_id
), cod_cash AS (
  SELECT order_id,
    coalesce(sum(amount_vnd) FILTER (WHERE NOT reconciliation_required AND duplicate_of_id IS NULL), 0) AS paid_vnd,
    bool_or(reconciliation_required) AS uncertain
  FROM commerce_cod_collections GROUP BY order_id
), returned_goods AS (
  SELECT r.order_id, sum(l.received_quantity * i.unit_price_vnd) AS credit_vnd,
    bool_and(r.responsibility <> 'customer') FILTER (WHERE l.received_quantity > 0) AS shipping_refundable
  FROM commerce_return_lines l JOIN commerce_returns r ON r.id = l.return_id
  JOIN order_items i ON i.id = l.order_item_id GROUP BY r.order_id
), refund_cash AS (
  SELECT r.order_id, sum(s.amount_vnd) AS refunded_vnd
  FROM commerce_refund_settlements s JOIN commerce_refunds r ON r.id = s.refund_id GROUP BY r.order_id
), balances AS (
  SELECT o.id AS order_id, coalesce(f.refunded_vnd, 0) AS refunded_vnd,
    coalesce(p.paid_vnd, 0) + coalesce(c.paid_vnd, 0) AS paid_vnd,
    CASE WHEN o.status = 'cancelled' THEN 0 ELSE o.total_vnd - coalesce(g.credit_vnd, 0)
      - CASE WHEN g.credit_vnd = o.subtotal_vnd AND g.shipping_refundable THEN o.shipping_fee_vnd ELSE 0 END END AS adjusted_total_vnd
  FROM orders o LEFT JOIN receipt_cash p ON p.order_id = o.id
  LEFT JOIN cod_cash c ON c.order_id = o.id LEFT JOIN returned_goods g ON g.order_id = o.id
  LEFT JOIN refund_cash f ON f.order_id = o.id
  WHERE NOT coalesce(p.uncertain, false) AND NOT coalesce(c.uncertain, false)
)
INSERT INTO commerce_payment_balance_reviews (order_id, discrepancy_vnd)
SELECT order_id, (refunded_vnd - greatest(0, paid_vnd - adjusted_total_vnd))::bigint
FROM balances WHERE refunded_vnd > greatest(0, paid_vnd - adjusted_total_vnd);
--> statement-breakpoint
-- The agreed method belongs to each order; the cash channel belongs to the
-- receiving account. A customer bank receipt can cover prepaid and delivered COD.
CREATE OR REPLACE FUNCTION "commerce_check_payment_allocations"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  receipt_ids uuid[];
  receipt_id uuid;
  receipt record;
  allocated_vnd numeric;
BEGIN
  IF TG_TABLE_NAME = 'commerce_payments' THEN receipt_ids := ARRAY[NEW.id];
  ELSIF TG_OP = 'INSERT' THEN receipt_ids := ARRAY[NEW.payment_id];
  ELSIF TG_OP = 'DELETE' THEN receipt_ids := ARRAY[OLD.payment_id];
  ELSE receipt_ids := ARRAY[OLD.payment_id, NEW.payment_id]; END IF;
  FOR receipt_id IN SELECT DISTINCT id FROM unnest(receipt_ids) AS affected(id) ORDER BY id LOOP
    SELECT p.amount_vnd, p.source, p.method, p.duplicate_of_id, p.receipt_reconciliation_required, account.channel INTO receipt
    FROM commerce_payments p LEFT JOIN commerce_receiving_accounts account ON account.id = p.receiving_account_id
    WHERE p.id = receipt_id FOR NO KEY UPDATE OF p;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT coalesce(sum(amount_vnd), 0) INTO allocated_vnd
    FROM commerce_payment_allocations WHERE payment_id = receipt_id;
    IF receipt.duplicate_of_id IS NULL AND allocated_vnd > receipt.amount_vnd THEN
      RAISE EXCEPTION 'Payment allocations exceed the physical receipt amount'
        USING ERRCODE = '23514', CONSTRAINT = 'commerce_payment_allocation_total_check';
    END IF;
    IF EXISTS (
      SELECT 1 FROM commerce_payment_allocations a JOIN orders o ON o.id = a.order_id
      WHERE a.payment_id = receipt_id AND (
        (receipt.source = 'carrier' AND (a.cod_collection_id IS NULL OR o.payment_method <> 'cod' OR a.purpose <> 'payment')) OR
        (receipt.source <> 'carrier' AND a.cod_collection_id IS NOT NULL) OR
        (a.purpose = 'refund_recovery' AND NOT (receipt.source = 'customer' OR (receipt.source = 'legacy' AND receipt.method = 'bank_transfer'))) OR
        (a.purpose = 'payment' AND o.payment_method = 'bank_transfer' AND receipt.duplicate_of_id IS NULL
          AND NOT receipt.receipt_reconciliation_required AND receipt.channel IS DISTINCT FROM 'bank_transfer')
      )
    ) THEN
      RAISE EXCEPTION 'Payment allocations do not match the cash source or receiving channel'
        USING ERRCODE = '23514', CONSTRAINT = 'commerce_payment_allocation_source_check';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER "commerce_payment_receipt_allocations_guard" ON "commerce_payments";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "commerce_payment_receipt_allocations_guard"
AFTER UPDATE OF "amount_vnd", "source", "method", "duplicate_of_id", "receipt_reconciliation_required", "receiving_account_id" ON "commerce_payments"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "commerce_check_payment_allocations"();
--> statement-breakpoint
CREATE FUNCTION "commerce_check_refund_recoveries"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  order_ids uuid[];
  affected_order_id uuid;
  recovered_vnd numeric;
  refunded_vnd numeric;
BEGIN
  IF TG_TABLE_NAME = 'commerce_payments' THEN
    SELECT array_agg(a.order_id) INTO order_ids FROM commerce_payment_allocations a WHERE a.payment_id = NEW.id;
  ELSIF TG_OP = 'INSERT' THEN order_ids := ARRAY[NEW.order_id];
  ELSIF TG_OP = 'DELETE' THEN order_ids := ARRAY[OLD.order_id];
  ELSE order_ids := ARRAY[OLD.order_id, NEW.order_id]; END IF;
  FOR affected_order_id IN SELECT DISTINCT id FROM unnest(order_ids) AS affected(id) ORDER BY id LOOP
    -- Existing cash writers already hold these locks; serialize the aggregate for
    -- other database writers without conflicting with allocation FK key-share locks.
    PERFORM 1 FROM orders o WHERE o.id = affected_order_id FOR NO KEY UPDATE;
    SELECT coalesce(sum(a.amount_vnd), 0) INTO recovered_vnd
    FROM commerce_payment_allocations a JOIN commerce_payments p ON p.id = a.payment_id
    WHERE a.order_id = affected_order_id AND a.purpose = 'refund_recovery'
      AND p.duplicate_of_id IS NULL AND NOT p.receipt_reconciliation_required;
    SELECT coalesce(sum(s.amount_vnd), 0) INTO refunded_vnd
    FROM commerce_refund_settlements s JOIN commerce_refunds r ON r.id = s.refund_id WHERE r.order_id = affected_order_id;
    IF recovered_vnd > refunded_vnd THEN
      RAISE EXCEPTION 'Refund recovery exceeds money actually refunded'
        USING ERRCODE = '23514', CONSTRAINT = 'commerce_refund_recovery_total_check';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "commerce_payment_allocations_recovery_guard"
AFTER INSERT OR UPDATE OR DELETE ON "commerce_payment_allocations"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "commerce_check_refund_recoveries"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "commerce_payment_receipt_recovery_guard"
AFTER UPDATE OF "amount_vnd", "source", "duplicate_of_id", "receipt_reconciliation_required" ON "commerce_payments"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "commerce_check_refund_recoveries"();
