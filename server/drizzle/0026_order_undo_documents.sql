CREATE TABLE "commerce_order_undo_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_revision" integer NOT NULL,
	"action" text NOT NULL,
	"file_name" text NOT NULL,
	"media_type" text NOT NULL,
	"content" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_undo_documents_revision_check" CHECK ("commerce_order_undo_documents"."order_revision" > 0),
	CONSTRAINT "commerce_undo_documents_action_check" CHECK ("commerce_order_undo_documents"."action" in ('handover', 'delivery')),
	CONSTRAINT "commerce_undo_documents_type_check" CHECK ("commerce_order_undo_documents"."media_type" in ('application/pdf', 'image/png', 'image/jpeg')),
	CONSTRAINT "commerce_undo_documents_name_check" CHECK (length(btrim("commerce_order_undo_documents"."file_name")) between 1 and 160),
	CONSTRAINT "commerce_undo_documents_content_check" CHECK (octet_length("commerce_order_undo_documents"."content") between 16 and 524288 and "commerce_order_undo_documents"."sha256" = encode(sha256("commerce_order_undo_documents"."content"), 'hex'))
);
--> statement-breakpoint
ALTER TABLE "commerce_order_undo_documents" ADD CONSTRAINT "commerce_order_undo_documents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_order_undo_documents" ADD CONSTRAINT "commerce_order_undo_documents_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_undo_documents_order_revision_idx" ON "commerce_order_undo_documents" USING btree ("order_id","order_revision");