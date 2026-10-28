ALTER TABLE "staff_order_setting_changes" ALTER COLUMN "actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_order_settings" ALTER COLUMN "updated_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_order_setting_changes" ADD COLUMN "actor_type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_order_settings" ADD COLUMN "shift_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_order_settings" ADD COLUMN "unavailable_since" timestamp with time zone;--> statement-breakpoint
-- Existing indefinite shifts must be reopened by an admin with an explicit end.
-- Record the system change before enforcing the new shift constraint.
WITH legacy AS MATERIALIZED (
  SELECT *, clock_timestamp() AS ended_at
  FROM "staff_order_settings"
  WHERE "accepting_orders" AND "shift_ends_at" IS NULL
  FOR UPDATE
), paused AS (
  UPDATE "staff_order_settings" AS settings
  SET "accepting_orders" = false,
      "unavailable_since" = legacy.ended_at,
      "revision" = settings."revision" + 1,
      "updated_by" = NULL,
      "updated_at" = legacy.ended_at
  FROM legacy
  WHERE settings."user_id" = legacy."user_id"
  RETURNING legacy."user_id", legacy."enabled", legacy."max_active_orders"
)
INSERT INTO "staff_order_setting_changes"
  ("target_user_id", "actor_user_id", "actor_type", "previous_value", "new_value", "reason")
SELECT "user_id", NULL, 'system',
  jsonb_build_object('enabled', "enabled", 'acceptingOrders', true, 'maxActiveOrders', "max_active_orders", 'shiftEndsAt', NULL),
  jsonb_build_object('enabled', "enabled", 'acceptingOrders', false, 'maxActiveOrders', "max_active_orders", 'shiftEndsAt', NULL),
  'Dừng ca cũ chưa có giờ kết thúc. Admin cần chọn giờ kết thúc khi bật lại nhận đơn.'
FROM paused;--> statement-breakpoint
-- Preserve the waiting age of staff who had already paused automatic intake.
UPDATE "staff_order_settings"
SET "unavailable_since" = "updated_at"
WHERE "enabled" AND NOT "accepting_orders"
  AND "unavailable_since" IS NULL AND "shift_ends_at" IS NULL;--> statement-breakpoint
CREATE INDEX "orders_staff_workload_idx" ON "orders" USING btree ("assigned_to","status") WHERE "orders"."deleted_at" is null and "orders"."assigned_to" is not null;--> statement-breakpoint
CREATE INDEX "staff_order_settings_shift_idx" ON "staff_order_settings" USING btree ("shift_ends_at") WHERE "staff_order_settings"."accepting_orders";--> statement-breakpoint
ALTER TABLE "staff_order_setting_changes" ADD CONSTRAINT "staff_order_setting_changes_actor_check" CHECK (("staff_order_setting_changes"."actor_type" = 'user' and "staff_order_setting_changes"."actor_user_id" is not null) or ("staff_order_setting_changes"."actor_type" = 'system' and "staff_order_setting_changes"."actor_user_id" is null));--> statement-breakpoint
ALTER TABLE "staff_order_settings" ADD CONSTRAINT "staff_order_settings_shift_check" CHECK (not "staff_order_settings"."accepting_orders" or "staff_order_settings"."shift_ends_at" is not null);
