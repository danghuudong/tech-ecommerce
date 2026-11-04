ALTER TABLE "commerce_shipments" DROP CONSTRAINT "commerce_shipments_status_check";--> statement-breakpoint
ALTER TABLE "commerce_shipments" DROP CONSTRAINT "commerce_shipments_lifecycle_check";--> statement-breakpoint
ALTER TABLE "commerce_shipments" ADD COLUMN "recipient_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "commerce_shipments" ADD COLUMN "handed_over_at" timestamp with time zone;--> statement-breakpoint
-- Before this migration, every stored shipment was created at physical handover.
UPDATE "commerce_shipments" SET "handed_over_at" = "created_at"
WHERE "handed_over_at" IS NULL AND "status" <> 'ready_to_ship';--> statement-breakpoint
ALTER TABLE "commerce_shipments" ADD CONSTRAINT "commerce_shipments_handover_check" CHECK (("commerce_shipments"."status" = 'ready_to_ship' and "commerce_shipments"."handed_over_at" is null and "commerce_shipments"."failed_attempts" = 0)
        or ("commerce_shipments"."status" <> 'ready_to_ship' and "commerce_shipments"."handed_over_at" is not null and "commerce_shipments"."handed_over_at" >= "commerce_shipments"."created_at"));--> statement-breakpoint
ALTER TABLE "commerce_shipments" ADD CONSTRAINT "commerce_shipments_status_check" CHECK ("commerce_shipments"."status" in ('ready_to_ship', 'in_transit', 'delivery_failed', 'delivered', 'returned'));--> statement-breakpoint
ALTER TABLE "commerce_shipments" ADD CONSTRAINT "commerce_shipments_lifecycle_check" CHECK (
      ("commerce_shipments"."status" in ('ready_to_ship', 'in_transit', 'delivery_failed') and "commerce_shipments"."delivered_at" is null and "commerce_shipments"."returned_at" is null)
      or ("commerce_shipments"."status" = 'delivered' and "commerce_shipments"."delivered_at" is not null and "commerce_shipments"."returned_at" is null)
      or ("commerce_shipments"."status" = 'returned' and "commerce_shipments"."returned_at" is not null and "commerce_shipments"."delivered_at" is null));
