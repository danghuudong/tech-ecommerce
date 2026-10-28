CREATE TABLE "staff_order_setting_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_user_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"previous_value" jsonb NOT NULL,
	"new_value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "staff_order_setting_changes_reason_check" CHECK (length(btrim("staff_order_setting_changes"."reason")) between 3 and 1000)
);
--> statement-breakpoint
CREATE TABLE "staff_order_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"accepting_orders" boolean DEFAULT false NOT NULL,
	"max_active_orders" integer DEFAULT 20 NOT NULL,
	"last_assigned_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "staff_order_settings_capacity_check" CHECK ("staff_order_settings"."max_active_orders" between 1 and 100),
	CONSTRAINT "staff_order_settings_revision_check" CHECK ("staff_order_settings"."revision" > 0),
	CONSTRAINT "staff_order_settings_availability_check" CHECK ("staff_order_settings"."enabled" or not "staff_order_settings"."accepting_orders")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "assignment_source" text;--> statement-breakpoint
UPDATE "orders" AS o
SET "assigned_at" = COALESCE(
  (SELECT max(e."created_at") FROM "commerce_order_events" AS e
   WHERE e."order_id" = o."id" AND e."type" = 'order_assigned'
     AND e."details"->>'assignedTo' = o."assigned_to"),
  o."created_at"
), "assignment_source" = 'manual'
WHERE o."assigned_to" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_order_setting_changes" ADD CONSTRAINT "staff_order_setting_changes_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_order_setting_changes" ADD CONSTRAINT "staff_order_setting_changes_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_order_settings" ADD CONSTRAINT "staff_order_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_order_settings" ADD CONSTRAINT "staff_order_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_order_setting_changes_user_idx" ON "staff_order_setting_changes" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_assignment_queue_idx" ON "orders" USING btree ("created_at","id") WHERE "orders"."assigned_to" is null and "orders"."deleted_at" is null and "orders"."status" in ('placed', 'confirmed', 'packing');--> statement-breakpoint
CREATE INDEX "orders_assignment_sla_idx" ON "orders" USING btree ("assigned_at") WHERE "orders"."assigned_to" is not null and "orders"."deleted_at" is null and "orders"."status" = 'placed';--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_assignment_check" CHECK (("orders"."assigned_to" is null and "orders"."assigned_at" is null and "orders"."assignment_source" is null) or ("orders"."assigned_to" is not null and "orders"."assigned_at" is not null and "orders"."assignment_source" is not null and "orders"."assignment_source" in ('automatic', 'manual')));
