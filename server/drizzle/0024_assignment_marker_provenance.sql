-- 0022 could mistake the first visible payment for an unpaid -> paid transition
-- when a pre-0005 receipt had no snapshot. 0023 only repaired NULL markers, so
-- reconcile those already written too. Only invalidate an unchanged recovery
-- marker: subsequent live payment, delivery and return work must keep its clock.
-- db:migrate holds the workforce gate and routing mutex for the pending chain.
WITH recovered_work AS MATERIALIZED (
  SELECT work.id, work.created_at, work.staff_work_started_at,
    recovery.id AS recovery_event_id, recovery.details ->> 'paymentEventId' AS payment_event_id
  FROM orders AS work
  CROSS JOIN LATERAL (
    SELECT event.id, event.details
    FROM commerce_order_events AS event
    WHERE event.order_id = work.id AND event.type = 'staff_work_started_at_recovered'
      AND event.actor_type = 'system'
      AND (event.details ->> 'staffWorkStartedAt')::timestamptz = work.staff_work_started_at
    ORDER BY event.created_at DESC, event.id DESC
    LIMIT 1
  ) AS recovery
  WHERE work.staff_work_started_at IS NOT NULL
  ORDER BY work.id
  FOR UPDATE OF work
), receipt_orders AS MATERIALIZED (
  SELECT allocation.payment_id, allocation.order_id
  FROM commerce_payment_allocations AS allocation JOIN recovered_work AS work ON work.id = allocation.order_id
  UNION
  SELECT receipt.id, work.id
  FROM commerce_payments AS receipt JOIN recovered_work AS work ON work.id = receipt.order_id
  UNION
  SELECT history.payment_id, work.id
  FROM commerce_payment_allocation_adjustments AS history
  CROSS JOIN LATERAL jsonb_array_elements(
    coalesce(history.before -> 'allocations', '[]'::jsonb) ||
    coalesce(history.after -> 'allocations', '[]'::jsonb)
  ) AS allocation
  JOIN recovered_work AS work ON allocation ->> 'orderId' = work.id::text
), uncertain AS MATERIALIZED (
  SELECT work.id, jsonb_agg(DISTINCT receipt.id ORDER BY receipt.id) AS receipt_ids
  FROM recovered_work AS work
  JOIN receipt_orders AS relevant ON relevant.order_id = work.id
  JOIN commerce_payments AS receipt ON receipt.id = relevant.payment_id
  WHERE EXISTS (
    SELECT 1 FROM commerce_order_events AS event
    WHERE event.order_id = work.id
      AND event.type IN ('payment_received', 'refund_recovery_received', 'merchant_receipt_reconciled',
        'payment_allocations_adjusted', 'payment_balance_review_decided')
      AND event.created_at >= greatest(work.created_at, receipt.created_at)
      AND event.created_at <= work.staff_work_started_at
      AND NOT EXISTS (
        SELECT 1 FROM commerce_payment_allocation_adjustments AS history
        WHERE history.payment_id = receipt.id AND history.created_at <= event.created_at
      )
  )
  GROUP BY work.id
), repaired AS (
  UPDATE orders AS target
  SET staff_work_started_at = NULL, revision = target.revision + 1,
      updated_at = clock_timestamp()
  FROM recovered_work AS work JOIN uncertain ON uncertain.id = work.id
  WHERE target.id = work.id AND target.staff_work_started_at = work.staff_work_started_at
  RETURNING target.id, work.staff_work_started_at AS previous_started_at,
    work.recovery_event_id, work.payment_event_id, uncertain.receipt_ids
)
INSERT INTO commerce_order_events (order_id, actor_user_id, actor_type, type, details)
SELECT id, NULL, 'system', 'staff_work_started_at_recovery_invalidated',
  jsonb_build_object('previousStaffWorkStartedAt', previous_started_at, 'staffWorkStartedAt', NULL,
    'recoveryEventId', recovery_event_id, 'paymentEventId', payment_event_id,
    'receiptIdsWithHistoryGaps', receipt_ids,
    'reason', 'Gỡ mốc mở lại do nâng cấp suy diễn từ lịch sử receipt thiếu snapshot; chưa đủ bằng chứng công việc từng bị ngừng.')
FROM repaired;--> statement-breakpoint

-- A role exit before settings existed cannot have stopped these settings.
-- 0019 seeded updated_at for enabled-but-never-started staff, while 0023 kept
-- that synthetic marker whenever ANY historical staff-role exit existed.
-- Require enrollment evidence, and preserve role exits after enrollment, real
-- receiving shifts and all automatic assignment history (including moved work).
WITH never_received AS MATERIALIZED (
  SELECT settings.*
  FROM staff_order_settings AS settings
  JOIN "user" AS person ON person.id = settings.user_id AND person.role = 'staff'
  CROSS JOIN LATERAL (
    SELECT min(change.created_at) AS created_at
    FROM staff_order_setting_changes AS change
    WHERE change.target_user_id = settings.user_id
  ) AS enrollment
  WHERE NOT settings.accepting_orders AND settings.unavailable_since IS NOT NULL
    AND enrollment.created_at IS NOT NULL
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
        AND change.created_at >= enrollment.created_at
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
  'Xóa mốc dừng do nâng cấp tạo: nhân viên chưa từng nhận đơn tự động, các lần rời vai trò staff đều trước khi có cấu hình nhận đơn.'
FROM repaired;
