-- Explicit Transfer root replaces movement-level transfer linkage.
-- Migrates valid same-Space transfer pairs and fails fast for corrupt legacy transfer data.

CREATE TABLE IF NOT EXISTS "transfers" (
  "id" text PRIMARY KEY NOT NULL,
  "source_space_id" text NOT NULL REFERENCES "spaces"("id") ON DELETE cascade,
  "destination_space_id" text NOT NULL REFERENCES "spaces"("id") ON DELETE cascade,
  "source_movement_id" text NOT NULL REFERENCES "movements"("id") ON DELETE cascade,
  "destination_movement_id" text NOT NULL REFERENCES "movements"("id") ON DELETE cascade,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transfers_source_space" ON "transfers" USING btree ("source_space_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transfers_destination_space" ON "transfers" USING btree ("destination_space_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_transfers_source_movement" ON "transfers" USING btree ("source_movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_transfers_destination_movement" ON "transfers" USING btree ("destination_movement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_emergency_payments_transfer" ON "emergency_payments" USING btree ("transfer_id");--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'movements' AND column_name = 'transfer_id') THEN
    IF EXISTS (
      SELECT 1
      FROM "movements" m
      WHERE (m."transfer_id" IS NULL AND m."transfer_pair_id" IS NOT NULL)
         OR (m."transfer_id" IS NOT NULL AND m."transfer_pair_id" IS NULL)
    ) THEN
      RAISE EXCEPTION 'Cannot migrate transfers: incomplete legacy transfer linkage';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "movements" m
      WHERE m."transfer_id" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "movements" p
          WHERE p."id" = m."transfer_pair_id"
            AND p."transfer_id" = m."transfer_id"
            AND p."transfer_pair_id" = m."id"
        )
    ) THEN
      RAISE EXCEPTION 'Cannot migrate transfers: broken or cross-linked transfer pairs';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "movements" m
      WHERE m."transfer_id" IS NOT NULL
        AND m."account_id" IS NULL
    ) THEN
      RAISE EXCEPTION 'Cannot migrate transfers: transfer movement without account';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "movements" m
      JOIN "movements" p ON p."id" = m."transfer_pair_id"
      WHERE m."transfer_id" IS NOT NULL
        AND (m."type" = p."type" OR m."id" = p."id")
    ) THEN
      RAISE EXCEPTION 'Cannot migrate transfers: each transfer must have one outgoing and one incoming movement';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "movements" m
      JOIN "movements" p ON p."id" = m."transfer_pair_id"
      WHERE m."transfer_id" IS NOT NULL
        AND m."space_id" <> p."space_id"
    ) THEN
      RAISE EXCEPTION 'Cannot migrate transfers: legacy transfer pairs must belong to the same Space';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "movements" m
      LEFT JOIN "accounts" a ON a."id" = m."account_id"
      WHERE m."transfer_id" IS NOT NULL
        AND (a."id" IS NULL OR a."space_id" <> m."space_id")
    ) THEN
      RAISE EXCEPTION 'Cannot migrate transfers: transfer movement account must belong to the same Space';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "movements"
      WHERE "transfer_id" IS NOT NULL
      GROUP BY "transfer_id"
      HAVING COUNT(*) <> 2
         OR COUNT(*) FILTER (WHERE "type" = 'expense') <> 1
         OR COUNT(*) FILTER (WHERE "type" = 'income') <> 1
         OR COUNT(DISTINCT "transfer_pair_id") <> 2
    ) THEN
      RAISE EXCEPTION 'Cannot migrate transfers: ambiguous legacy transfer group';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "movements" e
      JOIN "movements" i ON i."transfer_id" = e."transfer_id" AND i."type" = 'income'
      JOIN "transfers" t ON t."id" = e."transfer_id"
      WHERE e."transfer_id" IS NOT NULL
        AND e."type" = 'expense'
        AND (
          t."source_space_id" <> e."space_id"
          OR t."destination_space_id" <> i."space_id"
          OR t."source_movement_id" <> e."id"
          OR t."destination_movement_id" <> i."id"
        )
    ) THEN
      RAISE EXCEPTION 'Cannot migrate transfers: existing transfer root conflicts with legacy linkage';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "movements" e
      JOIN "movements" i ON i."transfer_id" = e."transfer_id" AND i."type" = 'income'
      JOIN "transfers" t ON t."source_movement_id" IN (e."id", i."id") OR t."destination_movement_id" IN (e."id", i."id")
      WHERE e."transfer_id" IS NOT NULL
        AND e."type" = 'expense'
        AND t."id" <> e."transfer_id"
    ) THEN
      RAISE EXCEPTION 'Cannot migrate transfers: existing transfer root movement conflict';
    END IF;

    INSERT INTO "transfers" (
      "id",
      "source_space_id",
      "destination_space_id",
      "source_movement_id",
      "destination_movement_id",
      "created_by_user_id",
      "created_at",
      "updated_at"
    )
    SELECT
      e."transfer_id",
      e."space_id",
      i."space_id",
      e."id",
      i."id",
      COALESCE(e."created_by_user_id", i."created_by_user_id"),
      LEAST(COALESCE(e."created_at", now()), COALESCE(i."created_at", now())),
      GREATEST(COALESCE(e."updated_at", now()), COALESCE(i."updated_at", now()))
    FROM "movements" e
    JOIN "movements" i ON i."transfer_id" = e."transfer_id" AND i."type" = 'income'
    WHERE e."transfer_id" IS NOT NULL
      AND e."type" = 'expense';
  END IF;
END $$;--> statement-breakpoint

DROP INDEX IF EXISTS "idx_movements_transfer";--> statement-breakpoint
ALTER TABLE "movements" DROP COLUMN IF EXISTS "transfer_id";--> statement-breakpoint
ALTER TABLE "movements" DROP COLUMN IF EXISTS "transfer_pair_id";--> statement-breakpoint
