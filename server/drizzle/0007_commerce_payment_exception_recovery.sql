ALTER TABLE "orders" DROP CONSTRAINT "orders_reservation_check";--> statement-breakpoint
ALTER TABLE "commerce_payment_balance_reviews" DROP CONSTRAINT "commerce_payment_balance_reviews_values_check";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "late_payment_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "late_payment_accepted_by" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "late_payment_accepted_fingerprint" text;--> statement-breakpoint
ALTER TABLE "commerce_payment_balance_reviews" ADD COLUMN "purchase_shortfall_vnd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_payment_balance_reviews" ADD COLUMN "paid_vnd_at_decision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_refund_settlements" ADD COLUMN "excess_amount_vnd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_refund_settlements" ADD COLUMN "exception_evidence_reference" text;--> statement-breakpoint
ALTER TABLE "commerce_refund_settlements" ADD COLUMN "exception_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_late_payment_accepted_by_user_id_fk" FOREIGN KEY ("late_payment_accepted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_late_payment_acceptance_check" CHECK (("orders"."late_payment_accepted_at" is null and "orders"."late_payment_accepted_by" is null and "orders"."late_payment_accepted_fingerprint" is null) or ("orders"."payment_method" = 'bank_transfer' and "orders"."payment_deadline_at" is not null and "orders"."late_payment_accepted_at" is not null and "orders"."late_payment_accepted_at" >= "orders"."payment_deadline_at" and "orders"."late_payment_accepted_by" is not null and "orders"."late_payment_accepted_fingerprint" is not null and "orders"."late_payment_accepted_fingerprint" ~ '^[a-f0-9]{64}$'));
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_reservation_check" CHECK ("orders"."reservation_expires_at" is null or ("orders"."stock_state" = 'reserved' and ("orders"."status" = 'placed' or ("orders"."status" in ('confirmed', 'packing') and "orders"."payment_method" = 'bank_transfer'))));
--> statement-breakpoint
ALTER TABLE "commerce_payment_balance_reviews" ADD CONSTRAINT "commerce_payment_balance_reviews_values_check" CHECK ("commerce_payment_balance_reviews"."revision" >= 1 and "commerce_payment_balance_reviews"."discrepancy_vnd" between 0 and 9007199254740991 and "commerce_payment_balance_reviews"."purchase_shortfall_vnd" between 0 and "commerce_payment_balance_reviews"."discrepancy_vnd" and "commerce_payment_balance_reviews"."approved_amount_vnd" between 0 and 9007199254740991 and "commerce_payment_balance_reviews"."recovered_vnd_at_decision" between 0 and 9007199254740991 and "commerce_payment_balance_reviews"."paid_vnd_at_decision" between 0 and 9007199254740991 and "commerce_payment_balance_reviews"."status" in ('needs_review', 'debt', 'written_off', 'resolved') and ("commerce_payment_balance_reviews"."disposition" is null or "commerce_payment_balance_reviews"."disposition" in ('debt', 'written_off')) and (("commerce_payment_balance_reviews"."disposition" is null and "commerce_payment_balance_reviews"."approved_amount_vnd" = 0 and "commerce_payment_balance_reviews"."recovered_vnd_at_decision" = 0 and "commerce_payment_balance_reviews"."paid_vnd_at_decision" = 0) or ("commerce_payment_balance_reviews"."disposition" is not null and "commerce_payment_balance_reviews"."approved_amount_vnd" > 0)));
--> statement-breakpoint
ALTER TABLE "commerce_refund_settlements" ADD CONSTRAINT "commerce_refund_settlements_exception_check" CHECK ("commerce_refund_settlements"."excess_amount_vnd" between 0 and "commerce_refund_settlements"."amount_vnd" and (("commerce_refund_settlements"."excess_amount_vnd" = 0 and "commerce_refund_settlements"."exception_evidence_reference" is null and "commerce_refund_settlements"."exception_reason" is null) or ("commerce_refund_settlements"."excess_amount_vnd" > 0 and "commerce_refund_settlements"."attempt_id" is not null and "commerce_refund_settlements"."exception_evidence_reference" is not null and length(trim("commerce_refund_settlements"."exception_evidence_reference")) > 0 and "commerce_refund_settlements"."exception_reason" is not null and length(trim("commerce_refund_settlements"."exception_reason")) > 0)));
--> statement-breakpoint
-- Derive obligations from existing verified facts. No receipt, settlement,
-- approved refund amount, delivery or inventory fact is changed by this migration.
CREATE TEMP TABLE commerce_exception_backfill_balances ON COMMIT DROP AS
WITH receipt_cash AS (
  SELECT a.order_id,
    coalesce(sum(a.amount_vnd) FILTER (WHERE a.purpose = 'payment' AND NOT p.receipt_reconciliation_required
      AND (p.source = 'customer' OR (p.source = 'legacy' AND p.method = 'bank_transfer'))), 0) AS paid_vnd,
    coalesce(sum(a.amount_vnd) FILTER (WHERE a.purpose = 'refund_recovery' AND NOT p.receipt_reconciliation_required), 0) AS recovered_vnd,
    bool_or(p.receipt_reconciliation_required OR (p.source = 'legacy' AND p.method = 'cod')) AS uncertain,
    coalesce(sum(a.amount_vnd) FILTER (WHERE a.purpose = 'payment' AND p.source <> 'carrier'
      AND NOT p.receipt_reconciliation_required AND p.received_at <= o.payment_deadline_at), 0) AS on_time_vnd
  FROM commerce_payment_allocations a JOIN commerce_payments p ON p.id = a.payment_id
  JOIN orders o ON o.id = a.order_id WHERE p.duplicate_of_id IS NULL GROUP BY a.order_id
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
  SELECT o.id AS order_id, coalesce(p.paid_vnd, 0) + coalesce(c.paid_vnd, 0) AS paid_vnd,
    coalesce(p.recovered_vnd, 0) AS recovered_vnd, coalesce(f.refunded_vnd, 0) AS refunded_vnd,
    coalesce(p.on_time_vnd, 0) AS on_time_vnd,
    NOT coalesce(p.uncertain, false) AND NOT coalesce(c.uncertain, false) AS balances_verified,
    CASE WHEN o.status = 'cancelled' THEN 0 ELSE o.total_vnd - coalesce(g.credit_vnd, 0)
      - CASE WHEN g.credit_vnd = o.subtotal_vnd AND g.shipping_refundable THEN o.shipping_fee_vnd ELSE 0 END END AS adjusted_total_vnd,
    o.payment_method, o.status, o.delivered_at
  FROM orders o LEFT JOIN receipt_cash p ON p.order_id = o.id
  LEFT JOIN cod_cash c ON c.order_id = o.id LEFT JOIN returned_goods g ON g.order_id = o.id
  LEFT JOIN refund_cash f ON f.order_id = o.id
), gaps AS (
  SELECT b.*, greatest(0, refunded_vnd - recovered_vnd - greatest(0, paid_vnd - adjusted_total_vnd)) AS refund_gap_vnd,
    greatest(0, adjusted_total_vnd - paid_vnd + refunded_vnd - recovered_vnd) AS due_vnd
  FROM balances b
)
SELECT g.*,
  CASE WHEN payment_method = 'bank_transfer' AND status IN ('delivered', 'completed') AND delivered_at IS NOT NULL
    THEN greatest(0, due_vnd - refund_gap_vnd) ELSE 0 END AS purchase_gap_vnd
FROM gaps g;
--> statement-breakpoint
-- Old decisions concern refunds only. Preserve their remaining approval while
-- explicitly exposing any additional prepaid purchase shortfall for review.
UPDATE commerce_payment_balance_reviews r SET paid_vnd_at_decision = b.paid_vnd::bigint
FROM commerce_exception_backfill_balances b
WHERE b.order_id = r.order_id AND b.balances_verified AND r.disposition IS NOT NULL;
--> statement-breakpoint
WITH changed AS (
  INSERT INTO commerce_payment_balance_reviews (order_id, discrepancy_vnd, purchase_shortfall_vnd)
  SELECT order_id, (refund_gap_vnd + purchase_gap_vnd)::bigint, purchase_gap_vnd::bigint
  FROM commerce_exception_backfill_balances WHERE balances_verified AND refund_gap_vnd + purchase_gap_vnd > 0
  ON CONFLICT (order_id) DO UPDATE SET
    discrepancy_vnd = EXCLUDED.discrepancy_vnd, purchase_shortfall_vnd = EXCLUDED.purchase_shortfall_vnd,
    status = CASE WHEN EXCLUDED.discrepancy_vnd > greatest(0, commerce_payment_balance_reviews.approved_amount_vnd
      - greatest(0, (SELECT b.recovered_vnd FROM commerce_exception_backfill_balances b WHERE b.order_id = EXCLUDED.order_id)
        - commerce_payment_balance_reviews.recovered_vnd_at_decision)) THEN 'needs_review'
      ELSE coalesce(commerce_payment_balance_reviews.disposition, 'needs_review') END,
    resolved_at = NULL, revision = commerce_payment_balance_reviews.revision + 1, updated_at = clock_timestamp()
  WHERE commerce_payment_balance_reviews.discrepancy_vnd <> EXCLUDED.discrepancy_vnd
    OR commerce_payment_balance_reviews.purchase_shortfall_vnd <> EXCLUDED.purchase_shortfall_vnd
    OR commerce_payment_balance_reviews.status = 'resolved'
  RETURNING id, order_id, discrepancy_vnd, purchase_shortfall_vnd, status
)
INSERT INTO commerce_order_events (order_id, actor_type, type, details)
SELECT order_id, 'system', 'payment_balance_review_updated', jsonb_build_object(
  'reviewId', id, 'discrepancyVnd', discrepancy_vnd, 'purchaseShortfallVnd', purchase_shortfall_vnd,
  'status', status, 'actorRole', 'system', 'reason', 'Verified historic payment shortfall was added to admin work') FROM changed;
--> statement-breakpoint
-- Restore only evidenced old admin approvals with no later cash correction.
-- Hash format matches bank-payment-policy.ts exactly, including millisecond time.
WITH approvals AS (
  SELECT DISTINCT ON (order_id) order_id, actor_user_id, created_at
  FROM commerce_order_events WHERE type = 'bank_deadline_reconciled'
    AND details->>'outcome' = 'accept_late_payment' AND details->>'actorRole' = 'admin' AND actor_user_id IS NOT NULL
  ORDER BY order_id, created_at DESC, id DESC
), evidence AS (
  SELECT a.order_id, string_agg(a.id::text || ':' || p.id::text || ':' || a.amount_vnd::text || ':' ||
    floor(extract(epoch FROM p.received_at) * 1000)::bigint::text || ':' || p.revision::text || ':' ||
    coalesce(p.receiving_account_id::text, '') || ':' || p.source || ':' || coalesce(account.channel, ''), '|' ORDER BY a.id) AS canonical,
    max(p.created_at) AS last_receipt_at
  FROM commerce_payment_allocations a JOIN commerce_payments p ON p.id = a.payment_id
  LEFT JOIN commerce_receiving_accounts account ON account.id = p.receiving_account_id
  WHERE a.purpose = 'payment' AND p.source <> 'carrier' AND p.duplicate_of_id IS NULL AND NOT p.receipt_reconciliation_required
  GROUP BY a.order_id
)
UPDATE orders o SET late_payment_accepted_at = v.created_at, late_payment_accepted_by = v.actor_user_id,
  late_payment_accepted_fingerprint = encode(sha256(convert_to(o.id::text || ':' || o.total_vnd::text || ':' ||
    floor(extract(epoch FROM o.payment_deadline_at) * 1000)::bigint::text || '|' || coalesce(e.canonical, ''), 'UTF8')), 'hex')
FROM approvals v JOIN commerce_exception_backfill_balances b ON b.order_id = v.order_id
JOIN evidence e ON e.order_id = v.order_id
WHERE o.id = v.order_id AND o.payment_method = 'bank_transfer' AND o.payment_deadline_at IS NOT NULL
  AND v.created_at >= o.payment_deadline_at AND e.last_receipt_at <= v.created_at
  AND b.balances_verified AND b.paid_vnd >= o.total_vnd AND b.paid_vnd - b.refunded_vnd + b.recovered_vnd >= o.total_vnd
  AND NOT EXISTS (SELECT 1 FROM commerce_order_events later WHERE later.order_id = o.id AND later.created_at > v.created_at
    AND later.type IN ('payment_received', 'refund_recovery_received', 'merchant_receipt_reconciled', 'payment_allocations_adjusted',
      'cod_payment_classified', 'refund_settled', 'refund_partially_settled', 'refund_exception_settlement_recorded'));
--> statement-breakpoint
-- Existing fully paid late reservations without valid approval must re-enter the
-- same statement review/SLA queue, including orders already being packed.
WITH changed AS (
  UPDATE orders o SET reservation_expires_at = o.payment_deadline_at,
    payment_review_required_at = coalesce(o.payment_review_required_at, clock_timestamp()),
    payment_review_escalated_at = CASE WHEN o.payment_review_due_at <= clock_timestamp()
      THEN coalesce(o.payment_review_escalated_at, clock_timestamp()) ELSE o.payment_review_escalated_at END,
    revision = o.revision + 1, updated_at = clock_timestamp()
  FROM commerce_exception_backfill_balances b
  WHERE b.order_id = o.id AND o.payment_method = 'bank_transfer' AND o.stock_state = 'reserved'
    AND o.payment_deadline_at <= clock_timestamp() AND o.late_payment_accepted_at IS NULL
    AND (NOT b.balances_verified OR b.on_time_vnd < o.total_vnd OR b.paid_vnd - b.refunded_vnd + b.recovered_vnd < o.total_vnd)
    AND o.reservation_expires_at IS NULL
  RETURNING o.id, o.payment_deadline_at, o.payment_review_due_at
)
INSERT INTO commerce_order_events (order_id, actor_type, type, details)
SELECT id, 'system', 'bank_statement_review_required', jsonb_build_object('deadline', payment_deadline_at,
  'reviewDueAt', payment_review_due_at, 'stockHeld', true, 'actorRole', 'system',
  'reason', 'Original payment deadline requires verified timely receipt or explicit late approval') FROM changed;
