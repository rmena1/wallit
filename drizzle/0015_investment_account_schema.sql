ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "is_investment" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "current_value" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "current_value_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "credit_limit" integer;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "investment_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE cascade,
  "space_id" text NOT NULL REFERENCES "spaces"("id") ON DELETE cascade,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "value" integer NOT NULL,
  "date" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_snapshots_account" ON "investment_snapshots" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_snapshots_space" ON "investment_snapshots" USING btree ("space_id");
