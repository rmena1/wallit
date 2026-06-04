ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "emergency" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "emergency_settled" boolean NOT NULL DEFAULT false;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emergency_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"emergency_id" text NOT NULL REFERENCES "movements"("id") ON DELETE cascade,
	"from_account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE cascade,
	"to_account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE cascade,
	"amount" integer NOT NULL,
	"date" text NOT NULL,
	"transfer_id" text,
	"created_at" timestamp NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_emergency_payments_emergency" ON "emergency_payments" USING btree ("emergency_id");
