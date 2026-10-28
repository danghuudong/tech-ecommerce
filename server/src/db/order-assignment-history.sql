-- Run against the actual deployment database. Zero receipts means there is no
-- receipt history to validate; it does not establish coverage for another database.
WITH order_receipts AS MATERIALIZED (
  SELECT payment_id, order_id FROM commerce_payment_allocations
  UNION
  SELECT id, order_id FROM commerce_payments
  UNION
  SELECT history.payment_id, (allocation ->> 'orderId')::uuid
  FROM commerce_payment_allocation_adjustments AS history
  CROSS JOIN LATERAL jsonb_array_elements(
    coalesce(history.before -> 'allocations', '[]'::jsonb) ||
    coalesce(history.after -> 'allocations', '[]'::jsonb)
  ) AS allocation
), active_bank_work AS MATERIALIZED (
  SELECT id, staff_work_started_at FROM orders
  WHERE deleted_at IS NULL AND payment_method = 'bank_transfer'
    AND status IN ('placed', 'confirmed', 'packing') AND stock_state = 'reserved'
), without_snapshots AS MATERIALIZED (
  SELECT receipt.id FROM commerce_payments AS receipt
  WHERE NOT EXISTS (
    SELECT 1 FROM commerce_payment_allocation_adjustments AS history
    WHERE history.payment_id = receipt.id
  )
), history_gaps AS MATERIALIZED (
  SELECT DISTINCT work.id
  FROM active_bank_work AS work
  JOIN order_receipts AS relevant ON relevant.order_id = work.id
  JOIN commerce_payments AS receipt ON receipt.id = relevant.payment_id
  WHERE EXISTS (SELECT 1 FROM without_snapshots WHERE id = receipt.id)
    OR EXISTS (
      SELECT 1 FROM commerce_order_events AS event
      WHERE event.order_id = work.id AND event.created_at >= receipt.created_at
        AND event.type IN ('payment_received', 'refund_recovery_received', 'merchant_receipt_reconciled',
          'payment_allocations_adjusted', 'payment_balance_review_decided')
        AND NOT EXISTS (
          SELECT 1 FROM commerce_payment_allocation_adjustments AS history
          WHERE history.payment_id = receipt.id AND history.created_at <= event.created_at
        )
    )
)
SELECT current_database() AS database,
  (SELECT count(*)::int FROM commerce_payments) AS "receipts",
  (SELECT count(*)::int FROM without_snapshots) AS "receiptsWithoutSnapshots",
  (SELECT count(*)::int FROM active_bank_work) AS "activeBankOrders",
  (SELECT count(*)::int FROM active_bank_work WHERE staff_work_started_at IS NULL) AS "activeBankOrdersWithoutWorkMarker",
  (SELECT count(*)::int FROM history_gaps) AS "activeOrdersWithHistoryGaps",
  coalesce((SELECT jsonb_agg(id) FROM (SELECT id FROM history_gaps ORDER BY id LIMIT 20) AS sample), '[]'::jsonb)
    AS "sampleOrderIdsWithHistoryGaps";
