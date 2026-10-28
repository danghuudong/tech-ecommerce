-- All canonical money/delivery writers lock an order before changing its facts.
-- Serialize them while constructing the shared backfill snapshots below.
LOCK TABLE orders IN EXCLUSIVE MODE;
--> statement-breakpoint
-- Upgrade only approvals whose old fingerprint still matches the verified
-- evidence. Preserve the original approval actor/time and all cash records.
WITH evidence AS (
  SELECT a.order_id,
    string_agg(a.id::text || ':' || p.id::text || ':' || a.amount_vnd::text || ':' ||
      floor(extract(epoch FROM p.received_at) * 1000)::bigint::text || ':' || p.revision::text || ':' ||
      coalesce(p.receiving_account_id::text, '') || ':' || p.source || ':' || coalesce(account.channel, ''), '|' ORDER BY a.id) AS old_evidence,
    string_agg(a.id::text || ':' || p.id::text || ':' || a.amount_vnd::text || ':' ||
      floor(extract(epoch FROM p.received_at) * 1000)::bigint::text || ':' ||
      coalesce(p.receiving_account_id::text, '') || ':' || p.source || ':' || coalesce(account.channel, '') || ':' ||
      p.amount_vnd::text || ':' || p.currency || ':' || encode(convert_to(p.reference, 'UTF8'), 'hex'), '|' ORDER BY a.id) AS new_evidence
  FROM commerce_payment_allocations a JOIN commerce_payments p ON p.id = a.payment_id
  LEFT JOIN commerce_receiving_accounts account ON account.id = p.receiving_account_id
  WHERE a.purpose = 'payment' AND p.source <> 'carrier' AND p.duplicate_of_id IS NULL AND NOT p.receipt_reconciliation_required
  GROUP BY a.order_id
), changed AS (
  UPDATE orders o SET late_payment_accepted_fingerprint = encode(sha256(convert_to(
    o.id::text || ':' || o.total_vnd::text || ':' || floor(extract(epoch FROM o.payment_deadline_at) * 1000)::bigint::text || '|' || e.new_evidence,
    'UTF8')), 'hex'), revision = o.revision + 1, updated_at = clock_timestamp()
  FROM evidence e WHERE e.order_id = o.id AND o.payment_method = 'bank_transfer'
    AND o.late_payment_accepted_at IS NOT NULL AND o.late_payment_accepted_by IS NOT NULL
    AND o.late_payment_accepted_fingerprint = encode(sha256(convert_to(
      o.id::text || ':' || o.total_vnd::text || ':' || floor(extract(epoch FROM o.payment_deadline_at) * 1000)::bigint::text || '|' || e.old_evidence,
      'UTF8')), 'hex')
  RETURNING o.id
)
INSERT INTO commerce_order_events (order_id, actor_type, type, details)
SELECT id, 'system', 'late_payment_fingerprint_updated', jsonb_build_object('actorRole', 'system',
  'reason', 'Existing approval now depends on this order allocation and physical receipt facts') FROM changed;
--> statement-breakpoint
-- Derive current balances exactly as the ledger does, including all outgoing
-- settlements regardless of their refund status. Ambiguous incoming cash is excluded.
CREATE TEMP TABLE commerce_flow_fix_balances ON COMMIT DROP AS
WITH receipt_cash AS (
  SELECT a.order_id,
    coalesce(sum(a.amount_vnd) FILTER (WHERE a.purpose = 'payment' AND NOT p.receipt_reconciliation_required
      AND (p.source = 'customer' OR (p.source = 'legacy' AND p.method = 'bank_transfer'))), 0) AS paid_vnd,
    coalesce(sum(a.amount_vnd) FILTER (WHERE a.purpose = 'refund_recovery' AND NOT p.receipt_reconciliation_required), 0) AS recovered_vnd,
    bool_or(p.receipt_reconciliation_required OR (p.source = 'legacy' AND p.method = 'cod')) AS uncertain
  FROM commerce_payment_allocations a JOIN commerce_payments p ON p.id = a.payment_id
  WHERE p.duplicate_of_id IS NULL GROUP BY a.order_id
), cod_cash AS (
  SELECT order_id, coalesce(sum(amount_vnd) FILTER (WHERE NOT reconciliation_required AND duplicate_of_id IS NULL), 0) AS paid_vnd,
    bool_or(reconciliation_required) AS uncertain FROM commerce_cod_collections GROUP BY order_id
), returned_goods AS (
  SELECT r.order_id, sum(l.received_quantity * i.unit_price_vnd) AS credit_vnd,
    bool_and(r.responsibility <> 'customer') FILTER (WHERE l.received_quantity > 0) AS shipping_refundable
  FROM commerce_return_lines l JOIN commerce_returns r ON r.id = l.return_id
  JOIN order_items i ON i.id = l.order_item_id GROUP BY r.order_id
), refund_cash AS (
  SELECT r.order_id, sum(s.amount_vnd) AS refunded_vnd FROM commerce_refund_settlements s
  JOIN commerce_refunds r ON r.id = s.refund_id GROUP BY r.order_id
), balances AS (
  SELECT o.id AS order_id, o.payment_method, o.status, o.delivered_at,
    coalesce(p.paid_vnd, 0) + coalesce(c.paid_vnd, 0) AS paid_vnd,
    coalesce(p.recovered_vnd, 0) AS recovered_vnd, coalesce(f.refunded_vnd, 0) AS refunded_vnd,
    coalesce(g.credit_vnd, 0) AS returned_goods_vnd,
    CASE WHEN o.status = 'cancelled' THEN 0 ELSE o.total_vnd - coalesce(g.credit_vnd, 0)
      - CASE WHEN g.credit_vnd = o.subtotal_vnd AND g.shipping_refundable THEN o.shipping_fee_vnd ELSE 0 END END AS adjusted_total_vnd
  FROM orders o LEFT JOIN receipt_cash p ON p.order_id = o.id LEFT JOIN cod_cash c ON c.order_id = o.id
  LEFT JOIN returned_goods g ON g.order_id = o.id LEFT JOIN refund_cash f ON f.order_id = o.id
  WHERE NOT coalesce(p.uncertain, false) AND NOT coalesce(c.uncertain, false)
), gaps AS (
  SELECT b.*, greatest(0, paid_vnd - adjusted_total_vnd) AS gross_entitlement_vnd,
    greatest(0, refunded_vnd - recovered_vnd - greatest(0, paid_vnd - adjusted_total_vnd)) AS refund_gap_vnd,
    greatest(0, adjusted_total_vnd - paid_vnd + refunded_vnd - recovered_vnd) AS due_vnd FROM balances b
)
SELECT g.*, CASE WHEN payment_method = 'bank_transfer' AND status IN ('delivered', 'completed') AND delivered_at IS NOT NULL
  THEN greatest(0, due_vnd - refund_gap_vnd) ELSE 0 END AS purchase_gap_vnd FROM gaps g;
--> statement-breakpoint
-- Existing delivered shortfalls must be discoverable immediately after upgrade,
-- without recording delivery again or changing its historical acknowledgement.
WITH changed AS (
  INSERT INTO commerce_payment_balance_reviews (order_id, discrepancy_vnd, purchase_shortfall_vnd)
  SELECT order_id, (refund_gap_vnd + purchase_gap_vnd)::bigint, purchase_gap_vnd::bigint
  FROM commerce_flow_fix_balances WHERE payment_method = 'bank_transfer'
    AND status IN ('delivered', 'completed') AND purchase_gap_vnd > 0
  ON CONFLICT (order_id) DO UPDATE SET
    discrepancy_vnd = EXCLUDED.discrepancy_vnd, purchase_shortfall_vnd = EXCLUDED.purchase_shortfall_vnd,
    status = CASE WHEN EXCLUDED.discrepancy_vnd > greatest(0, commerce_payment_balance_reviews.approved_amount_vnd
      - greatest(0, (SELECT b.recovered_vnd FROM commerce_flow_fix_balances b WHERE b.order_id = EXCLUDED.order_id)
        - commerce_payment_balance_reviews.recovered_vnd_at_decision)
      - greatest(0, (SELECT b.paid_vnd FROM commerce_flow_fix_balances b WHERE b.order_id = EXCLUDED.order_id)
        - commerce_payment_balance_reviews.paid_vnd_at_decision)) THEN 'needs_review'
      ELSE coalesce(commerce_payment_balance_reviews.disposition, 'needs_review') END,
    resolved_at = NULL, revision = commerce_payment_balance_reviews.revision + 1, updated_at = clock_timestamp()
  WHERE commerce_payment_balance_reviews.discrepancy_vnd <> EXCLUDED.discrepancy_vnd
    OR commerce_payment_balance_reviews.purchase_shortfall_vnd <> EXCLUDED.purchase_shortfall_vnd
    OR commerce_payment_balance_reviews.status = 'resolved'
  RETURNING id, order_id, discrepancy_vnd, purchase_shortfall_vnd, status, revision
)
INSERT INTO commerce_order_events (order_id, actor_type, type, details)
SELECT order_id, 'system', CASE WHEN revision = 1 THEN 'payment_balance_review_opened' ELSE 'payment_balance_review_updated' END,
  jsonb_build_object('reviewId', id,
  'discrepancyVnd', discrepancy_vnd, 'purchaseShortfallVnd', purchase_shortfall_vnd, 'status', status,
  'actorRole', 'system', 'reason', 'Verified missing payment after acknowledged delivery requires administrator review') FROM changed;
--> statement-breakpoint
-- Repair only safe outstanding refund plans affected by actual cash on voided
-- refunds. Preserve uncertain attempts, approved attempt amounts and cash facts.
CREATE TEMP TABLE commerce_flow_fix_refunds ON COMMIT DROP AS
WITH settled AS (
  SELECT r.*, coalesce(sum(s.amount_vnd), 0) AS actual_settled_vnd
  FROM commerce_refunds r LEFT JOIN commerce_refund_settlements s ON s.refund_id = r.id
  GROUP BY r.id
), ordered AS (
  SELECT r.*, coalesce(sum(actual_settled_vnd) OVER (PARTITION BY order_id ORDER BY created_at, id
    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS previous_settled_vnd FROM settled r
)
SELECT r.*, least(r.actual_settled_vnd, greatest(0, b.recovered_vnd - r.previous_settled_vnd)) AS recovered_vnd,
  attempt.id IS NULL OR attempt.status IN ('failed', 'settled')
    OR (attempt.status = 'partially_settled' AND attempt.remainder_not_sent_verified) AS attempt_closed
FROM ordered r JOIN commerce_flow_fix_balances b ON b.order_id = r.order_id
LEFT JOIN LATERAL (SELECT a.id, a.status, a.remainder_not_sent_verified FROM commerce_refund_attempts a
  WHERE a.refund_id = r.id ORDER BY a.number DESC LIMIT 1) attempt ON true;
--> statement-breakpoint
DO $$
DECLARE
  affected record;
  obligation record;
  final_receipt record;
  allocated_vnd numeric;
  next_amount_vnd bigint;
  next_status text;
  remainder_vnd numeric;
  new_refund_id uuid;
  new_reason text;
BEGIN
  FOR affected IN SELECT b.* FROM commerce_flow_fix_balances b
    WHERE EXISTS (SELECT 1 FROM commerce_flow_fix_refunds r WHERE r.order_id = b.order_id
      AND r.status = 'voided' AND r.actual_settled_vnd > r.recovered_vnd)
    ORDER BY b.order_id LOOP
    PERFORM 1 FROM orders WHERE id = affected.order_id FOR UPDATE;
    SELECT coalesce(sum(CASE WHEN r.status = 'voided' THEN r.actual_settled_vnd - r.recovered_vnd
      ELSE greatest(r.amount_vnd, r.actual_settled_vnd) - r.recovered_vnd END), 0) INTO allocated_vnd
    FROM commerce_flow_fix_refunds r WHERE r.order_id = affected.order_id
      AND (r.status IN ('voided', 'settled') OR NOT r.attempt_closed);
    FOR obligation IN SELECT r.* FROM commerce_flow_fix_refunds r WHERE r.order_id = affected.order_id
      AND r.status NOT IN ('voided', 'settled') AND r.attempt_closed ORDER BY r.created_at, r.id LOOP
      next_amount_vnd := greatest(least(obligation.amount_vnd, obligation.actual_settled_vnd),
        least(obligation.amount_vnd, greatest(0, affected.gross_entitlement_vnd - allocated_vnd) + obligation.recovered_vnd))::bigint;
      allocated_vnd := allocated_vnd + greatest(next_amount_vnd, obligation.actual_settled_vnd) - obligation.recovered_vnd;
      next_status := CASE WHEN next_amount_vnd = 0 THEN 'voided'
        WHEN next_amount_vnd <= obligation.actual_settled_vnd THEN 'settled'
        WHEN obligation.attempt_count >= 3 THEN 'needs_review'
        WHEN obligation.actual_settled_vnd > 0 THEN 'partially_settled' ELSE 'pending' END;
      IF (next_amount_vnd = obligation.amount_vnd OR next_amount_vnd = 0) AND next_status = obligation.status THEN CONTINUE; END IF;
      SELECT s.method, s.reference, s.settled_at, s.recorded_by INTO final_receipt FROM commerce_refund_settlements s
        WHERE s.refund_id = obligation.id AND next_status = 'settled' ORDER BY s.created_at DESC, s.id DESC LIMIT 1;
      UPDATE commerce_refunds SET amount_vnd = CASE WHEN next_amount_vnd = 0 THEN obligation.amount_vnd ELSE next_amount_vnd END,
        original_amount_vnd = CASE WHEN next_amount_vnd <> obligation.amount_vnd THEN coalesce(obligation.original_amount_vnd, obligation.amount_vnd)
          ELSE obligation.original_amount_vnd END, status = next_status, settlement_method = final_receipt.method,
        settlement_reference = final_receipt.reference, settled_at = final_receipt.settled_at, settled_by = final_receipt.recorded_by,
        updated_at = clock_timestamp() WHERE id = obligation.id;
      INSERT INTO commerce_order_events (order_id, actor_type, type, details) VALUES (affected.order_id, 'system', 'refund_balance_reconciled',
        jsonb_build_object('refundId', obligation.id, 'previousAmountVnd', obligation.amount_vnd, 'amountVnd', next_amount_vnd,
          'settledVnd', obligation.actual_settled_vnd, 'status', next_status, 'actorRole', 'system',
          'reason', 'Actual cash paid through voided refunds was deducted from the remaining entitlement'));
    END LOOP;
    remainder_vnd := greatest(0, affected.gross_entitlement_vnd - allocated_vnd);
    new_reason := CASE WHEN affected.status = 'cancelled' THEN CASE WHEN EXISTS (SELECT 1 FROM commerce_refunds r
      WHERE r.order_id = affected.order_id AND r.reason = 'return_to_sender') THEN 'return_to_sender' ELSE 'cancellation' END
      WHEN affected.returned_goods_vnd > 0 THEN 'return' ELSE 'overpayment' END;
    WHILE remainder_vnd > 0 LOOP
      next_amount_vnd := least(9999999999, remainder_vnd)::bigint;
      INSERT INTO commerce_refunds (order_id, amount_vnd, reason, status) VALUES (affected.order_id, next_amount_vnd, new_reason, 'pending')
        RETURNING id INTO new_refund_id;
      INSERT INTO commerce_order_events (order_id, actor_type, type, details) VALUES (affected.order_id, 'system', 'refund_required',
        jsonb_build_object('refundId', new_refund_id, 'amountVnd', next_amount_vnd, 'reason', new_reason,
          'fundingStatus', 'customer_payment_verified', 'actorRole', 'system'));
      remainder_vnd := remainder_vnd - next_amount_vnd;
    END LOOP;
  END LOOP;
END;
$$;
