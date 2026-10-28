CREATE SEQUENCE "public"."commerce_order_code_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 100001 CACHE 1;--> statement-breakpoint
DROP INDEX "commerce_shipments_tracking_idx";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "code" text DEFAULT 'TV' || nextval('commerce_order_code_seq')::text NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_shipments" ADD COLUMN "carrier_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce_shipments" ADD CONSTRAINT "commerce_shipments_carrier_id_commerce_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."commerce_carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_code_idx" ON "orders" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_shipments_carrier_tracking_idx" ON "commerce_shipments" USING btree ("carrier_id","tracking_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_shipments_legacy_tracking_idx" ON "commerce_shipments" USING btree ("tracking_reference") WHERE "commerce_shipments"."carrier_id" is null;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_code_check" CHECK ("orders"."code" ~ '^TV[1-9][0-9]*$');