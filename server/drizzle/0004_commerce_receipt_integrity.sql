CREATE TABLE "commerce_cod_collection_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"evidence_reference" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_payment_receipt_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"evidence_reference" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_receiving_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"provider_code" text NOT NULL,
	"account_reference" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_receiving_accounts_identity_check" CHECK ("commerce_receiving_accounts"."channel" in ('bank_transfer', 'cash') and "commerce_receiving_accounts"."provider_code" ~ '^[a-z0-9][a-z0-9._-]{1,63}$' and "commerce_receiving_accounts"."account_reference" ~ '^[a-z0-9][a-z0-9._-]{0,99}$')
);
--> statement-breakpoint
ALTER TABLE "commerce_cod_collections" DROP CONSTRAINT "commerce_cod_collections_money_check";--> statement-breakpoint
DROP INDEX "commerce_payments_receipt_idx";--> statement-breakpoint
ALTER TABLE "commerce_cod_collections" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Historic receipts have no verified receiving-account identity. Preserve their
-- facts and require an administrator's evidence before counting merchant cash.
-- An order's payment method cannot identify the channel/account of COD remittances.
ALTER TABLE "commerce_payments" ADD COLUMN "receiving_account_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD COLUMN "receipt_reconciliation_required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD COLUMN "duplicate_of_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_cod_collection_adjustments" ADD CONSTRAINT "commerce_cod_collection_adjustments_collection_id_commerce_cod_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."commerce_cod_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_cod_collection_adjustments" ADD CONSTRAINT "commerce_cod_collection_adjustments_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payment_receipt_reconciliations" ADD CONSTRAINT "commerce_payment_receipt_reconciliations_payment_id_commerce_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."commerce_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payment_receipt_reconciliations" ADD CONSTRAINT "commerce_payment_receipt_reconciliations_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_receiving_accounts" ADD CONSTRAINT "commerce_receiving_accounts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_cod_collection_adjustments_collection_idx" ON "commerce_cod_collection_adjustments" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "commerce_payment_receipt_reconciliations_payment_idx" ON "commerce_payment_receipt_reconciliations" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_receiving_accounts_identity_idx" ON "commerce_receiving_accounts" USING btree ("channel","provider_code","account_reference");--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD CONSTRAINT "commerce_payments_receiving_account_id_commerce_receiving_accounts_id_fk" FOREIGN KEY ("receiving_account_id") REFERENCES "public"."commerce_receiving_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD CONSTRAINT "commerce_payments_duplicate_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."commerce_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_payments_reference_idx" ON "commerce_payments" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_payments_receipt_idx" ON "commerce_payments" USING btree ("receiving_account_id","reference") WHERE "commerce_payments"."duplicate_of_id" is null and not "commerce_payments"."receipt_reconciliation_required";--> statement-breakpoint
ALTER TABLE "commerce_cod_collections" ADD CONSTRAINT "commerce_cod_collections_money_check" CHECK ("commerce_cod_collections"."amount_vnd" between 1 and 9999999999 and "commerce_cod_collections"."currency" = 'VND' and "commerce_cod_collections"."revision" >= 1);--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD CONSTRAINT "commerce_payments_receipt_identity_check" CHECK ("commerce_payments"."revision" >= 1 and ("commerce_payments"."receipt_reconciliation_required" or "commerce_payments"."receiving_account_id" is not null) and ("commerce_payments"."duplicate_of_id" is null or ("commerce_payments"."duplicate_of_id" <> "commerce_payments"."id" and not "commerce_payments"."receipt_reconciliation_required")));
