ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "loan" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "loan_settled" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "loan_id" text;
