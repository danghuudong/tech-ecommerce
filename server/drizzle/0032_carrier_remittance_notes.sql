SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD COLUMN "remittance_note" text;
--> statement-breakpoint
ALTER TABLE "commerce_payments" ADD CONSTRAINT "commerce_payments_remittance_note_check" CHECK ("commerce_payments"."remittance_note" is null or char_length("commerce_payments"."remittance_note") between 1 and 1000);
