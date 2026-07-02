ALTER TABLE "receivable_settlements" ADD COLUMN IF NOT EXISTS "consumed_transfer_source_category_id" text;
--> statement-breakpoint
ALTER TABLE "receivable_settlements" ADD COLUMN IF NOT EXISTS "consumed_transfer_destination_category_id" text;
--> statement-breakpoint
ALTER TABLE "receivable_settlements" ADD COLUMN IF NOT EXISTS "consumed_transfer_source_reportable" boolean;
--> statement-breakpoint
ALTER TABLE "receivable_settlements" ADD COLUMN IF NOT EXISTS "consumed_transfer_destination_reportable" boolean;
--> statement-breakpoint
ALTER TABLE "receivable_settlements" ADD COLUMN IF NOT EXISTS "consumed_transfer_source_receivable" boolean;
--> statement-breakpoint
ALTER TABLE "receivable_settlements" ADD COLUMN IF NOT EXISTS "consumed_transfer_destination_receivable" boolean;
