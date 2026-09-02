ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "source_email_provider" text;
ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "source_email_id" text;
--> statement-breakpoint

-- Complete recoverable legacy USD triples before canonicalizing them. Rows for
-- which neither USD amount nor exchange rate exists are intentionally rejected
-- below: guessing either value would silently change financial meaning.
UPDATE "movements"
SET "amount_usd" = ROUND("amount"::numeric * 100 / "exchange_rate")::integer,
    "updated_at" = NOW()
WHERE "currency" = 'USD'
  AND ("amount_usd" IS NULL OR "amount_usd" <= 0)
  AND "exchange_rate" > 0;

UPDATE "movements"
SET "exchange_rate" = ROUND("amount"::numeric * 100 / "amount_usd")::integer,
    "updated_at" = NOW()
WHERE "currency" = 'USD'
  AND ("exchange_rate" IS NULL OR "exchange_rate" <= 0)
  AND "amount_usd" > 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "movements"
    WHERE "currency" = 'USD'
      AND ("amount" <= 0 OR "amount_usd" IS NULL OR "amount_usd" <= 0 OR "exchange_rate" IS NULL OR "exchange_rate" <= 0)
  ) THEN
    RAISE EXCEPTION 'Cannot enable USD money invariant: unrecoverable USD movements require manual repair';
  END IF;
END $$;

-- Normalize historical discrepancies before enabling the invariant. The app
-- still preserves user-entered values inside the allowed $10 CLP tolerance.
UPDATE "movements"
SET "amount" = ROUND("amount_usd"::numeric * "exchange_rate"::numeric / 100)::bigint,
    "updated_at" = NOW()
WHERE "currency" = 'USD'
  AND ABS("amount"::numeric - ROUND("amount_usd"::numeric * "exchange_rate"::numeric / 100)) > 1000;
--> statement-breakpoint

ALTER TABLE "movements" DROP CONSTRAINT IF EXISTS "movements_usd_money_consistency";
ALTER TABLE "movements"
  ADD CONSTRAINT "movements_usd_money_consistency" CHECK (
    "currency" <> 'USD'
    OR (
      "amount" > 0
      AND "amount_usd" IS NOT NULL AND "amount_usd" > 0
      AND "exchange_rate" IS NOT NULL AND "exchange_rate" > 0
      AND ABS("amount"::numeric - ROUND("amount_usd"::numeric * "exchange_rate"::numeric / 100)) <= 1000
    )
  );
--> statement-breakpoint

ALTER TABLE "movements" DROP CONSTRAINT IF EXISTS "movements_source_email_identity_complete";
ALTER TABLE "movements"
  ADD CONSTRAINT "movements_source_email_identity_complete" CHECK (
    ("source_email_provider" IS NULL AND "source_email_id" IS NULL)
    OR (
      "created_by_user_id" IS NOT NULL
      AND "source_email_provider" IS NOT NULL
      AND "source_email_provider" = LOWER(BTRIM("source_email_provider"))
      AND LENGTH("source_email_provider") > 0
      AND "source_email_id" IS NOT NULL
      AND "source_email_id" = BTRIM("source_email_id")
      AND LENGTH("source_email_id") > 0
    )
  );
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_movements_source_email"
  ON "movements" ("created_by_user_id", "source_email_provider", "source_email_id")
  WHERE "source_email_id" IS NOT NULL;
