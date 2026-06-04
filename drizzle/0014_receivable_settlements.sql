CREATE TABLE IF NOT EXISTS "receivable_settlements" (
  "id" text PRIMARY KEY NOT NULL,
  "funded_space_id" text NOT NULL REFERENCES "spaces"("id") ON DELETE cascade,
  "paying_space_id" text NOT NULL REFERENCES "spaces"("id") ON DELETE cascade,
  "receivable_id" text NOT NULL REFERENCES "movements"("id") ON DELETE cascade,
  "outgoing_movement_id" text NOT NULL REFERENCES "movements"("id") ON DELETE cascade,
  "incoming_movement_id" text NOT NULL REFERENCES "movements"("id") ON DELETE cascade,
  "consumed_transfer_id" text,
  "consumed_transfer_source_space_id" text,
  "consumed_transfer_destination_space_id" text,
  "consumed_transfer_source_account_id" text,
  "consumed_transfer_destination_account_id" text,
  "consumed_transfer_source_name" text,
  "consumed_transfer_destination_name" text,
  "consumed_transfer_date" text,
  "consumed_transfer_source_time" text,
  "consumed_transfer_destination_time" text,
  "consumed_source_amount" bigint,
  "consumed_source_currency" text,
  "consumed_source_amount_usd" integer,
  "consumed_source_exchange_rate" integer,
  "consumed_destination_amount" bigint,
  "consumed_destination_currency" text,
  "consumed_destination_amount_usd" integer,
  "consumed_destination_exchange_rate" integer,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_receivable_settlements_funded_space" ON "receivable_settlements" USING btree ("funded_space_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_receivable_settlements_paying_space" ON "receivable_settlements" USING btree ("paying_space_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_receivable_settlements_receivable" ON "receivable_settlements" USING btree ("receivable_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_receivable_settlements_outgoing" ON "receivable_settlements" USING btree ("outgoing_movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_receivable_settlements_incoming" ON "receivable_settlements" USING btree ("incoming_movement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_receivable_settlements_consumed_transfer" ON "receivable_settlements" USING btree ("consumed_transfer_id");--> statement-breakpoint
