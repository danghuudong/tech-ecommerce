-- Current ownership cannot prove past participation: automatic assignments may
-- already have moved to another employee. Include immutable assignment history
-- and receiving-shift history; a manual-only, never-enrolled owner is excluded.
WITH participation AS MATERIALIZED (
  SELECT target_user_id AS user_id, max(created_at) AS started_at
  FROM staff_order_setting_changes
  WHERE new_value @> '{"enabled":true,"acceptingOrders":true}'::jsonb
  GROUP BY target_user_id
  UNION ALL
  SELECT details ->> 'assignedTo' AS user_id, max(created_at) AS started_at
  FROM commerce_order_events
  WHERE type = 'order_assigned' AND details ->> 'source' = 'automatic'
  GROUP BY details ->> 'assignedTo'
  UNION ALL
  SELECT assigned_to AS user_id, max(assigned_at) AS started_at
  FROM orders
  WHERE assignment_source = 'automatic'
  GROUP BY assigned_to
), last_participation AS (
  SELECT user_id, max(started_at) AS started_at
  FROM participation
  GROUP BY user_id
), affected AS MATERIALIZED (
  SELECT settings.*,
    COALESCE((
      SELECT min(change.created_at)
      FROM staff_order_setting_changes AS change
      WHERE change.target_user_id = settings.user_id
        AND NOT (change.new_value @> '{"enabled":true,"acceptingOrders":true}'::jsonb)
        AND change.created_at >= history.started_at
    ), settings.updated_at) AS stopped_at
  FROM staff_order_settings AS settings
  JOIN last_participation AS history ON history.user_id = settings.user_id
  WHERE NOT settings.accepting_orders AND settings.unavailable_since IS NULL
    AND history.started_at IS NOT NULL
  FOR UPDATE OF settings
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
  'Khôi phục mốc dừng từ lịch sử nhận đơn và ca làm; giữ ngoại lệ phân công thủ công sau khi dừng.'
FROM repaired;
