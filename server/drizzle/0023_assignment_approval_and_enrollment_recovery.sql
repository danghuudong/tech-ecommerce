-- Extend 0022 to refund-loss fulfillment decisions. Replay the authorization
-- effective at each command, including withdrawal/reapproval and later cash changes.
-- Incomplete pre-0005 histories are reported by db:assignment:check; do not turn
-- missing receipt evidence into an assumed unpaid -> paid transition.
WITH work AS MATERIALIZED (
  SELECT * FROM orders
  WHERE deleted_at IS NULL AND payment_method = 'bank_transfer'
    AND status IN ('placed', 'confirmed', 'packing') AND stock_state = 'reserved'
    AND reservation_expires_at IS NULL AND staff_work_started_at IS NULL
    AND payment_deadline_at <= clock_timestamp()
  ORDER BY id
  FOR UPDATE
), receipt_orders AS MATERIALIZED (
  SELECT allocation.payment_id, allocation.order_id
  FROM commerce_payment_allocations AS allocation JOIN work ON work.id = allocation.order_id
  UNION
  SELECT receipt.id, work.id FROM commerce_payments AS receipt JOIN work ON work.id = receipt.order_id
  UNION
  SELECT DISTINCT history.payment_id, work.id AS order_id
  FROM commerce_payment_allocation_adjustments AS history
  CROSS JOIN LATERAL jsonb_array_elements(
    coalesce(history.before -> 'allocations', '[]'::jsonb) ||
    coalesce(history.after -> 'allocations', '[]'::jsonb)
  ) AS allocation
  JOIN work ON allocation ->> 'orderId' = work.id::text
), payment_states AS MATERIALIZED (
  SELECT work.id AS order_id, event.id AS event_id, event.created_at,
    work.payment_deadline_at,
    coalesce(cash.verified, false)
      AND cash.on_time_paid >= work.total_vnd
      AND cash.paid > 0
      AND (cash.paid - refunds.refunded + cash.recovered >= work.total_vnd
        OR coalesce(
          review.snapshot @> '{"allowFulfillment":true,"disposition":"written_off","status":"written_off"}'::jsonb
          AND cash.paid >= work.total_vnd
          AND refunds.refunded - cash.recovered - greatest(0, cash.paid - work.total_vnd) > 0
          AND greatest(0, (review.snapshot ->> 'approvedAmountVnd')::bigint
            - greatest(0, cash.recovered - (review.snapshot ->> 'recoveredVndAtDecision')::bigint)
            - greatest(0, cash.paid - (review.snapshot ->> 'paidVndAtDecision')::bigint))
              >= refunds.refunded - cash.recovered - greatest(0, cash.paid - work.total_vnd)
          AND NOT EXISTS (
            SELECT 1 FROM commerce_order_events AS lifecycle
            WHERE lifecycle.order_id = work.id
              AND lifecycle.details ->> 'reviewId' = review.review_id::text
              AND lifecycle.type = 'payment_balance_review_resolved'
              AND lifecycle.created_at > review.created_at AND lifecycle.created_at <= event.created_at
          )
          AND coalesce((
            SELECT lifecycle.details ->> 'status' FROM commerce_order_events AS lifecycle
            WHERE lifecycle.order_id = work.id
              AND lifecycle.details ->> 'reviewId' = review.review_id::text
              AND lifecycle.type = 'payment_balance_review_updated'
              AND lifecycle.created_at > review.created_at AND lifecycle.created_at <= event.created_at
            ORDER BY lifecycle.created_at DESC, lifecycle.id DESC LIMIT 1
          ), 'written_off') = 'written_off', false)) AS approved,
    NOT EXISTS (
      SELECT 1 FROM receipt_orders AS relevant
      JOIN commerce_payments AS receipt ON receipt.id = relevant.payment_id
      WHERE relevant.order_id = work.id AND receipt.created_at <= event.created_at
        AND NOT EXISTS (
          SELECT 1 FROM commerce_payment_allocation_adjustments AS history
          WHERE history.payment_id = receipt.id AND history.created_at <= event.created_at
        )
    ) AS history_complete
  FROM work
  JOIN commerce_order_events AS event ON event.order_id = work.id
    AND event.type IN ('payment_received', 'refund_recovery_received', 'merchant_receipt_reconciled',
      'payment_allocations_adjusted', 'payment_balance_review_decided')
    AND event.created_at >= work.created_at AND event.created_at <= clock_timestamp()
  CROSS JOIN LATERAL (
    SELECT
      bool_and(receipt.snapshot -> 'receiptReconciliationRequired' = 'false'::jsonb
        AND NOT (receipt.snapshot ->> 'source' = 'legacy' AND receipt.method = 'cod'))
        FILTER (WHERE receipt.snapshot ->> 'duplicateOfId' IS NULL) AS verified,
      coalesce(sum((allocation ->> 'amountVnd')::bigint) FILTER (
        WHERE receipt.snapshot -> 'receiptReconciliationRequired' = 'false'::jsonb
          AND receipt.snapshot ->> 'duplicateOfId' IS NULL
          AND allocation ->> 'purpose' = 'payment'
          AND (receipt.snapshot ->> 'source' = 'customer'
            OR (receipt.snapshot ->> 'source' = 'legacy' AND receipt.method = 'bank_transfer'))
      ), 0) AS paid,
      coalesce(sum((allocation ->> 'amountVnd')::bigint) FILTER (
        WHERE receipt.snapshot -> 'receiptReconciliationRequired' = 'false'::jsonb
          AND receipt.snapshot ->> 'duplicateOfId' IS NULL
          AND allocation ->> 'purpose' = 'payment'
          AND receipt.snapshot ->> 'source' <> 'carrier'
          AND (receipt.snapshot ->> 'receivedAt')::timestamptz <= work.payment_deadline_at
      ), 0) AS on_time_paid,
      coalesce(sum((allocation ->> 'amountVnd')::bigint) FILTER (
        WHERE receipt.snapshot -> 'receiptReconciliationRequired' = 'false'::jsonb
          AND receipt.snapshot ->> 'duplicateOfId' IS NULL
          AND allocation ->> 'purpose' = 'refund_recovery'
      ), 0) AS recovered
    FROM (
      SELECT DISTINCT ON (history.payment_id) history.after AS snapshot, receipt.method
      FROM receipt_orders AS relevant
      JOIN commerce_payment_allocation_adjustments AS history ON history.payment_id = relevant.payment_id
      JOIN commerce_payments AS receipt ON receipt.id = history.payment_id
      WHERE relevant.order_id = work.id AND history.created_at <= event.created_at
      ORDER BY history.payment_id, (history.after ->> 'receiptRevision')::int DESC,
        history.created_at DESC, history.id DESC
    ) AS receipt
    CROSS JOIN LATERAL jsonb_array_elements(receipt.snapshot -> 'allocations') AS allocation
    WHERE allocation ->> 'orderId' = work.id::text
  ) AS cash
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(settlement.amount_vnd), 0) AS refunded
    FROM commerce_refund_settlements AS settlement
    JOIN commerce_refunds AS refund ON refund.id = settlement.refund_id
    WHERE refund.order_id = work.id AND settlement.created_at <= event.created_at
  ) AS refunds
  LEFT JOIN LATERAL (
    SELECT decision.after AS snapshot, decision.review_id, decision.created_at
    FROM commerce_payment_balance_review_decisions AS decision
    JOIN commerce_payment_balance_reviews AS balance ON balance.id = decision.review_id
    WHERE balance.order_id = work.id AND decision.created_at <= event.created_at
      AND (event.type <> 'payment_balance_review_decided' OR event.details ->> 'decisionId' = decision.id::text)
    ORDER BY (decision.after ->> 'revision')::int DESC, decision.created_at DESC, decision.id DESC
    LIMIT 1
  ) AS review ON true
), transitions AS (
  SELECT *, lag(approved, 1, false) OVER (
    PARTITION BY order_id ORDER BY created_at, event_id
  ) AS previously_approved,
  first_value(approved) OVER (
    PARTITION BY order_id ORDER BY created_at DESC, event_id DESC
  ) AS currently_approved,
  bool_and(history_complete) OVER (PARTITION BY order_id) AS history_complete_for_order
  FROM payment_states
), resumed AS MATERIALIZED (
  SELECT DISTINCT ON (order_id) order_id, event_id, created_at AS started_at
  FROM transitions
  WHERE approved AND NOT previously_approved AND currently_approved AND history_complete_for_order
    AND created_at >= payment_deadline_at
  ORDER BY order_id, created_at DESC, event_id DESC
), repaired AS (
  UPDATE orders AS target
  SET staff_work_started_at = resumed.started_at,
      revision = target.revision + 1,
      updated_at = clock_timestamp()
  FROM resumed
  WHERE target.id = resumed.order_id AND target.staff_work_started_at IS NULL
  RETURNING target.id, target.staff_work_started_at, resumed.event_id
)
INSERT INTO commerce_order_events (order_id, actor_user_id, actor_type, type, details)
SELECT id, NULL, 'system', 'staff_work_started_at_recovered',
  jsonb_build_object('staffWorkStartedAt', staff_work_started_at, 'paymentEventId', event_id,
    'reason', 'Khôi phục thời điểm mở lại từ lịch sử thanh toán và quyết định duyệt lỗ cho tiếp tục xử lý.')
FROM repaired;--> statement-breakpoint

-- 0019 invented a stop for enabled-but-never-started settings. No shift/intake,
-- automatic assignment (including moved orders), or workforce-role exit may be
-- present. Role-exit markers are deliberate, even for manual-only staff.
WITH never_received AS MATERIALIZED (
  SELECT settings.*
  FROM staff_order_settings AS settings
  JOIN "user" AS person ON person.id = settings.user_id AND person.role = 'staff'
  WHERE NOT settings.accepting_orders
    AND settings.unavailable_since IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM staff_order_setting_changes AS change
      WHERE change.target_user_id = settings.user_id
        AND (change.previous_value @> '{"acceptingOrders":true}'::jsonb
          OR change.new_value @> '{"acceptingOrders":true}'::jsonb)
    )
    AND NOT EXISTS (
      SELECT 1 FROM commerce_order_events AS event
      WHERE event.type = 'order_assigned' AND event.details ->> 'source' = 'automatic'
        AND event.details ->> 'assignedTo' = settings.user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM orders AS assigned
      WHERE assigned.assigned_to = settings.user_id AND assigned.assignment_source = 'automatic'
    )
    AND NOT EXISTS (
      SELECT 1 FROM commerce_role_changes AS change
      WHERE change.target_user_id = settings.user_id
        AND change.previous_role = 'staff' AND change.new_role <> 'staff'
    )
  ORDER BY settings.user_id
  FOR UPDATE OF settings
), repaired AS (
  UPDATE staff_order_settings AS settings
  SET unavailable_since = NULL, revision = settings.revision + 1,
      updated_by = NULL, updated_at = clock_timestamp()
  FROM never_received
  WHERE settings.user_id = never_received.user_id
  RETURNING never_received.*
)
INSERT INTO staff_order_setting_changes
  (target_user_id, actor_user_id, actor_type, previous_value, new_value, reason)
SELECT user_id, NULL, 'system',
  jsonb_build_object('enabled', enabled, 'acceptingOrders', accepting_orders,
    'maxActiveOrders', max_active_orders, 'shiftEndsAt', shift_ends_at, 'unavailableSince', unavailable_since),
  jsonb_build_object('enabled', enabled, 'acceptingOrders', accepting_orders,
    'maxActiveOrders', max_active_orders, 'shiftEndsAt', shift_ends_at, 'unavailableSince', NULL),
  'Xóa mốc dừng do nâng cấp tạo cho nhân viên chưa từng nhận đơn tự động; giữ phân công thủ công.'
FROM repaired;
