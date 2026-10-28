ALTER TABLE "commerce_shipments" DROP CONSTRAINT "commerce_shipments_lifecycle_check";--> statement-breakpoint
ALTER TABLE "commerce_shipments" ADD CONSTRAINT "commerce_shipments_lifecycle_check" CHECK (
      ("commerce_shipments"."status" in ('in_transit', 'delivery_failed') and "commerce_shipments"."delivered_at" is null and "commerce_shipments"."returned_at" is null)
      or ("commerce_shipments"."status" = 'delivered' and "commerce_shipments"."delivered_at" is not null and "commerce_shipments"."returned_at" is null)
      or ("commerce_shipments"."status" = 'returned' and "commerce_shipments"."returned_at" is not null and "commerce_shipments"."proof_reference" is not null and "commerce_shipments"."delivered_at" is null));