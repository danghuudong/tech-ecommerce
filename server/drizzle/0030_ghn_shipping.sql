CREATE TABLE "commerce_ghn_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"identity" text NOT NULL,
	"tracking_reference" text NOT NULL,
	"environment" text NOT NULL,
	"shop_id" integer NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reason" text,
	"warehouse" text,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_ghn_events_environment_check" CHECK ("commerce_ghn_events"."environment" in ('staging', 'production'))
);
--> statement-breakpoint
CREATE TABLE "commerce_ghn_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"environment" text NOT NULL,
	"shop_id" integer NOT NULL,
	"request" jsonb NOT NULL,
	"result" jsonb,
	"last_error" text,
	"lease_until" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_ghn_operations_kind_check" CHECK ("commerce_ghn_operations"."kind" in ('create', 'cancel')),
	CONSTRAINT "commerce_ghn_operations_state_check" CHECK ("commerce_ghn_operations"."state" in ('pending', 'unknown', 'succeeded', 'failed')),
	CONSTRAINT "commerce_ghn_operations_environment_check" CHECK ("commerce_ghn_operations"."environment" in ('staging', 'production')),
	CONSTRAINT "commerce_ghn_operations_shop_check" CHECK ("commerce_ghn_operations"."shop_id" > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce_shipments" ADD COLUMN "ghn" jsonb;--> statement-breakpoint
ALTER TABLE "commerce_ghn_events" ADD CONSTRAINT "commerce_ghn_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_ghn_operations" ADD CONSTRAINT "commerce_ghn_operations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_ghn_operations" ADD CONSTRAINT "commerce_ghn_operations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_ghn_events_identity_idx" ON "commerce_ghn_events" USING btree ("identity");--> statement-breakpoint
CREATE INDEX "commerce_ghn_events_order_idx" ON "commerce_ghn_events" USING btree ("order_id","occurred_at");--> statement-breakpoint
CREATE INDEX "commerce_ghn_operations_order_idx" ON "commerce_ghn_operations" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_ghn_operations_active_idx" ON "commerce_ghn_operations" USING btree ("order_id") WHERE "commerce_ghn_operations"."state" in ('pending', 'unknown');
