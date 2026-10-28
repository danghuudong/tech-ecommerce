-- Repair orders finalized before finalizeReceipt recorded the resumption marker.
-- Replay receipt snapshots at each financial command, rather than using today's
-- allocations, receipt.received_at, order.updated_at, or the latest extra payment.
WITH work AS MATERIALIZED (
  SELECT * FROM orders
  WHERE deleted_at IS NULL AND payment_method = 'bank_transfer'
    AND status IN ('placed', 'confirmed', 'packing') AND stock_state = 'reserved'
    AND reservation_expires_at IS NULL AND staff_work_started_at IS NULL
    AND payment_deadline_at <= clock_timestamp()
  ORDER BY id
  FOR UPDATE
), receipt_orders AS MATERIALIZED (
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
      AND cash.paid - refunds.refunded + cash.recovered >= work.total_vnd
      AS approved
  FROM work
  JOIN commerce_order_events AS event ON event.order_id = work.id
    AND event.type IN ('payment_received', 'refund_recovery_received', 'merchant_receipt_reconciled', 'payment_allocations_adjusted')
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
), transitions AS (
  SELECT *, lag(approved, 1, false) OVER (
    PARTITION BY order_id ORDER BY created_at, event_id
  ) AS previously_approved,
  first_value(approved) OVER (
    PARTITION BY order_id ORDER BY created_at DESC, event_id DESC
  ) AS currently_approved
  FROM payment_states
), resumed AS MATERIALIZED (
  SELECT DISTINCT ON (order_id) order_id, event_id, created_at AS started_at
  FROM transitions
  WHERE approved AND NOT previously_approved AND currently_approved
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
    'reason', 'Khôi phục thời điểm mở lại công việc từ lịch sử thanh toán trước bản sửa.')
FROM repaired;--> statement-breakpoint

-- 0019 used settings.updated_at, which may be a capacity edit long after pausing.
-- Correct non-null markers too, using a real receiving -> stopped transition in
-- the current stopped period. A later restart invalidates an earlier stop.
WITH stopped AS MATERIALIZED (
  SELECT settings.*,
    CASE WHEN transition.previous_value ->> 'shiftEndsAt' IS NOT NULL
      THEN least(transition.created_at, (transition.previous_value ->> 'shiftEndsAt')::timestamptz)
      ELSE transition.created_at END AS stopped_at,
    transition.receiving_since
  FROM staff_order_settings AS settings
  CROSS JOIN LATERAL (
    SELECT change.previous_value, change.created_at,
      (SELECT max(started.created_at)
       FROM staff_order_setting_changes AS started
       WHERE started.target_user_id = settings.user_id
         AND started.created_at <= change.created_at
         AND started.new_value @> '{"enabled":true,"acceptingOrders":true}'::jsonb) AS receiving_since
    FROM staff_order_setting_changes AS change
    WHERE change.target_user_id = settings.user_id
      AND change.previous_value @> '{"enabled":true,"acceptingOrders":true}'::jsonb
      AND NOT (change.new_value @> '{"enabled":true,"acceptingOrders":true}'::jsonb)
      AND NOT EXISTS (
        SELECT 1 FROM staff_order_setting_changes AS restarted
        WHERE restarted.target_user_id = settings.user_id
          AND restarted.created_at > change.created_at
          AND restarted.new_value @> '{"enabled":true,"acceptingOrders":true}'::jsonb
      )
    ORDER BY change.created_at DESC, change.id DESC
    LIMIT 1
  ) AS transition
  WHERE NOT settings.accepting_orders
  ORDER BY settings.user_id
  FOR UPDATE OF settings
), repaired AS (
  UPDATE staff_order_settings AS settings
  SET unavailable_since = stopped.stopped_at,
      revision = settings.revision + 1,
      updated_by = NULL,
      updated_at = clock_timestamp()
  FROM stopped
  WHERE settings.user_id = stopped.user_id
    AND settings.unavailable_since IS DISTINCT FROM stopped.stopped_at
    -- Live commands capture their clock just before inserting the audit row.
    -- Preserve that valid earlier marker; fix missing, delayed, or stale-period values.
    AND (settings.unavailable_since IS NULL
      OR settings.unavailable_since > stopped.stopped_at
      OR settings.unavailable_since < stopped.receiving_since)
  RETURNING stopped.user_id, stopped.enabled, stopped.accepting_orders,
    stopped.max_active_orders, stopped.shift_ends_at,
    stopped.unavailable_since AS previous_stopped_at, settings.unavailable_since AS stopped_at
)
INSERT INTO staff_order_setting_changes
  (target_user_id, actor_user_id, actor_type, previous_value, new_value, reason)
SELECT user_id, NULL, 'system',
  jsonb_build_object('enabled', enabled, 'acceptingOrders', accepting_orders,
    'maxActiveOrders', max_active_orders, 'shiftEndsAt', shift_ends_at,
    'unavailableSince', previous_stopped_at),
  jsonb_build_object('enabled', enabled, 'acceptingOrders', accepting_orders,
    'maxActiveOrders', max_active_orders, 'shiftEndsAt', shift_ends_at,
    'unavailableSince', stopped_at),
  'Sửa mốc dừng theo lịch sử bật/tắt ca, bảo toàn phân công thủ công sau khi dừng.'
FROM repaired;
