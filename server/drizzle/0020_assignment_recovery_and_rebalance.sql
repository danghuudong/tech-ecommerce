ALTER TABLE "orders" ADD COLUMN "staff_work_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_order_settings" ADD COLUMN "capacity_changed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;--> statement-breakpoint

-- 0019 missed disabled staff. Recover the start of the current stopped period,
-- not a later capacity/configuration edit, so manual assignments made after
-- stopping remain explicit overrides. Never-enrolled, manually assigned owners
-- without automatic assignments are left unchanged.
WITH affected AS MATERIALIZED (
  SELECT settings.*,
    COALESCE((
      SELECT min(change.created_at)
      FROM staff_order_setting_changes AS change
      WHERE change.target_user_id = settings.user_id
        AND NOT (change.new_value @> '{"enabled":true,"acceptingOrders":true}'::jsonb)
        AND change.created_at >= greatest(
          (SELECT max(started.created_at)
           FROM staff_order_setting_changes AS started
           WHERE started.target_user_id = settings.user_id
             AND started.new_value @> '{"enabled":true,"acceptingOrders":true}'::jsonb),
          (SELECT max(assigned.assigned_at) FROM orders AS assigned
           WHERE assigned.assigned_to = settings.user_id AND assigned.assignment_source = 'automatic')
        )
    ), settings.updated_at) AS stopped_at
  FROM staff_order_settings AS settings
  WHERE NOT settings.enabled AND NOT settings.accepting_orders
    AND settings.unavailable_since IS NULL
    AND EXISTS (SELECT 1 FROM orders AS assigned
                WHERE assigned.assigned_to = settings.user_id AND assigned.assignment_source = 'automatic')
  FOR UPDATE
), repaired AS (
  UPDATE staff_order_settings AS settings
  SET unavailable_since = affected.stopped_at,
      revision = settings.revision + 1,
      updated_by = NULL,
      updated_at = clock_timestamp()
  FROM affected
  WHERE settings.user_id = affected.user_id
  RETURNING affected.user_id, affected.enabled, affected.accepting_orders,
            affected.max_active_orders, affected.shift_ends_at
)
INSERT INTO staff_order_setting_changes
  (target_user_id, actor_user_id, actor_type, previous_value, new_value, reason)
SELECT user_id, NULL, 'system',
  jsonb_build_object('enabled', enabled, 'acceptingOrders', accepting_orders,
    'maxActiveOrders', max_active_orders, 'shiftEndsAt', shift_ends_at),
  jsonb_build_object('enabled', enabled, 'acceptingOrders', accepting_orders,
    'maxActiveOrders', max_active_orders, 'shiftEndsAt', shift_ends_at),
  'Bổ sung mốc dừng của cấu hình cũ đã tắt nhận đơn để bàn giao đơn tự động; giữ ngoại lệ phân công thủ công sau khi dừng.'
FROM repaired;--> statement-breakpoint

-- Seed current work episodes from business facts, never generic order.updated_at
-- or the owner's shift end. Future reactivations write this marker atomically
-- with the payment, delivery failure, or first open return request.
WITH episodes AS (
  SELECT work.id, least(
    CASE WHEN work.status IN ('placed', 'confirmed', 'packing') AND work.stock_state = 'reserved'
      AND (work.reservation_expires_at IS NULL OR work.reservation_expires_at > clock_timestamp())
    THEN greatest(work.created_at, work.late_payment_accepted_at,
      (SELECT max(event.created_at) FROM commerce_order_events AS event
       WHERE event.order_id = work.id AND event.type = 'payment_deadline_satisfied')) END,
    CASE WHEN work.status = 'shipped' AND EXISTS (
      SELECT 1 FROM commerce_shipments AS shipment
      WHERE shipment.order_id = work.id AND shipment.status = 'delivery_failed'
    ) THEN coalesce(
      (SELECT max(event.created_at) FROM commerce_order_events AS event
       WHERE event.order_id = work.id AND event.type = 'delivery_failed'),
      (SELECT shipment.updated_at FROM commerce_shipments AS shipment
       WHERE shipment.order_id = work.id AND shipment.status = 'delivery_failed')) END,
    (SELECT min(request.created_at) FROM commerce_returns AS request
     WHERE request.order_id = work.id AND request.status IN ('requested', 'approved', 'receiving', 'received'))
  ) AS started_at
  FROM orders AS work
  WHERE work.deleted_at IS NULL AND work.staff_work_started_at IS NULL
)
UPDATE orders AS work
SET staff_work_started_at = episodes.started_at
FROM episodes
WHERE work.id = episodes.id AND work.staff_work_started_at IS NULL
  AND episodes.started_at > work.created_at;
