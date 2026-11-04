SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
LOCK TABLE "commerce_ghn_events", "commerce_ghn_operations", "commerce_shipments" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
-- Preserve existing business data if GHN was used after the rollback preflight.
DO $ghn_rollback$
BEGIN
  IF EXISTS (SELECT 1 FROM "commerce_ghn_events")
    OR EXISTS (SELECT 1 FROM "commerce_ghn_operations")
    OR EXISTS (SELECT 1 FROM "commerce_shipments" WHERE "ghn" IS NOT NULL)
  THEN
    RAISE EXCEPTION 'GHN rollback requires reconciliation: GHN records exist';
  END IF;
END;
$ghn_rollback$;
--> statement-breakpoint
DROP TABLE "commerce_ghn_events";
--> statement-breakpoint
DROP TABLE "commerce_ghn_operations";
--> statement-breakpoint
ALTER TABLE "commerce_shipments" DROP COLUMN "ghn";
