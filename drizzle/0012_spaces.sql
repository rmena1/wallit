-- Spaces: financial data is owned by Space, not User.
-- Safe PostgreSQL/Railway migration for existing single-user Wallit data.

CREATE TABLE IF NOT EXISTS "spaces" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "emoji" text NOT NULL,
  "is_personal" boolean DEFAULT false NOT NULL,
  "created_by_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "archived_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_spaces_created_by" ON "spaces" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_spaces_normalized_name" ON "spaces" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_spaces_archived" ON "spaces" USING btree ("archived_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "space_memberships" (
  "id" text PRIMARY KEY NOT NULL,
  "space_id" text NOT NULL REFERENCES "spaces"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "role" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_space_memberships_space" ON "space_memberships" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_space_memberships_user" ON "space_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_space_memberships_space_user" ON "space_memberships" USING btree ("space_id", "user_id");--> statement-breakpoint

DROP TABLE IF EXISTS "__wallit_personal_space_map";--> statement-breakpoint
CREATE TEMP TABLE "__wallit_personal_space_map" ON COMMIT DROP AS
SELECT
  u."id" AS "user_id",
  COALESCE(existing."space_id", 'personal_' || md5(u."id")) AS "space_id"
FROM "users" u
LEFT JOIN LATERAL (
  SELECT s."id" AS "space_id"
  FROM "spaces" s
  LEFT JOIN "space_memberships" sm ON sm."space_id" = s."id" AND sm."user_id" = u."id"
  WHERE s."is_personal" = true
    AND s."archived_at" IS NULL
    AND (sm."user_id" = u."id" OR s."created_by_user_id" = u."id")
  ORDER BY
    CASE WHEN sm."user_id" = u."id" THEN 0 ELSE 1 END,
    s."created_at" ASC,
    s."id" ASC
  LIMIT 1
) existing ON true;--> statement-breakpoint

INSERT INTO "spaces" ("id", "name", "normalized_name", "emoji", "is_personal", "created_by_user_id", "created_at", "updated_at")
SELECT p."space_id", 'Personal', 'personal', '👤', true, u."id", COALESCE(u."created_at", now()), now()
FROM "__wallit_personal_space_map" p
INNER JOIN "users" u ON u."id" = p."user_id"
WHERE NOT EXISTS (SELECT 1 FROM "spaces" s WHERE s."id" = p."space_id")
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "space_memberships" ("id", "space_id", "user_id", "role", "created_at")
SELECT 'membership_' || md5(p."user_id" || ':' || p."space_id"), p."space_id", p."user_id", 'owner', now()
FROM "__wallit_personal_space_map" p
WHERE EXISTS (SELECT 1 FROM "spaces" s WHERE s."id" = p."space_id")
  AND NOT EXISTS (
    SELECT 1 FROM "space_memberships" sm
    WHERE sm."space_id" = p."space_id" AND sm."user_id" = p."user_id"
  )
ON CONFLICT ("space_id", "user_id") DO NOTHING;--> statement-breakpoint

ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "space_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "space_id" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "space_id" text;--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE IF EXISTS "investment_snapshots" ADD COLUMN IF NOT EXISTS "space_id" text;--> statement-breakpoint
ALTER TABLE IF EXISTS "investment_snapshots" ADD COLUMN IF NOT EXISTS "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE IF EXISTS "emergency_payments" ADD COLUMN IF NOT EXISTS "space_id" text;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'user_id') THEN
    UPDATE "accounts" a
    SET "space_id" = p."space_id",
        "created_by_user_id" = a."user_id"
    FROM "__wallit_personal_space_map" p
    WHERE a."space_id" IS NULL AND a."user_id" = p."user_id";
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'categories' AND column_name = 'user_id') THEN
    UPDATE "categories" c
    SET "space_id" = p."space_id",
        "created_by_user_id" = c."user_id"
    FROM "__wallit_personal_space_map" p
    WHERE c."space_id" IS NULL AND c."user_id" = p."user_id";
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'movements' AND column_name = 'user_id') THEN
    UPDATE "movements" m
    SET "space_id" = p."space_id",
        "created_by_user_id" = m."user_id"
    FROM "__wallit_personal_space_map" p
    WHERE m."space_id" IS NULL AND m."user_id" = p."user_id";
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF to_regclass('public.investment_snapshots') IS NOT NULL THEN
    EXECUTE '
      UPDATE "investment_snapshots" s
      SET "space_id" = a."space_id",
          "created_by_user_id" = a."created_by_user_id"
      FROM "accounts" a
      WHERE s."account_id" = a."id" AND s."space_id" IS NULL
    ';
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF to_regclass('public.emergency_payments') IS NOT NULL THEN
    EXECUTE '
      UPDATE "emergency_payments" ep
      SET "space_id" = m."space_id"
      FROM "movements" m
      WHERE ep."emergency_id" = m."id" AND ep."space_id" IS NULL
    ';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "accounts" ALTER COLUMN "space_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "space_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "movements" ALTER COLUMN "space_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN IF to_regclass('public.investment_snapshots') IS NOT NULL THEN EXECUTE 'ALTER TABLE "investment_snapshots" ALTER COLUMN "space_id" SET NOT NULL'; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF to_regclass('public.emergency_payments') IS NOT NULL THEN EXECUTE 'ALTER TABLE "emergency_payments" ALTER COLUMN "space_id" SET NOT NULL'; END IF; END $$;--> statement-breakpoint

ALTER TABLE "movements" ALTER COLUMN "amount" TYPE bigint;--> statement-breakpoint

ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "accounts_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "movements" DROP CONSTRAINT IF EXISTS "movements_user_id_users_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_accounts_user";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_categories_user";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_movements_user";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_movements_date";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_movements_review";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "user_id";--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN IF EXISTS "user_id";--> statement-breakpoint
ALTER TABLE "movements" DROP COLUMN IF EXISTS "user_id";--> statement-breakpoint
ALTER TABLE IF EXISTS "investment_snapshots" DROP COLUMN IF EXISTS "user_id";--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_space_id_spaces_id_fk') THEN
    ALTER TABLE "accounts" ADD CONSTRAINT "accounts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_created_by_user_id_users_id_fk') THEN
    ALTER TABLE "accounts" ADD CONSTRAINT "accounts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_space_id_spaces_id_fk') THEN
    ALTER TABLE "categories" ADD CONSTRAINT "categories_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_created_by_user_id_users_id_fk') THEN
    ALTER TABLE "categories" ADD CONSTRAINT "categories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movements_space_id_spaces_id_fk') THEN
    ALTER TABLE "movements" ADD CONSTRAINT "movements_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movements_created_by_user_id_users_id_fk') THEN
    ALTER TABLE "movements" ADD CONSTRAINT "movements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF to_regclass('public.investment_snapshots') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'investment_snapshots_space_id_spaces_id_fk') THEN
      ALTER TABLE "investment_snapshots" ADD CONSTRAINT "investment_snapshots_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE cascade;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'investment_snapshots_created_by_user_id_users_id_fk') THEN
      ALTER TABLE "investment_snapshots" ADD CONSTRAINT "investment_snapshots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null;
    END IF;
  END IF;
  IF to_regclass('public.emergency_payments') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_payments_space_id_spaces_id_fk') THEN
      ALTER TABLE "emergency_payments" ADD CONSTRAINT "emergency_payments_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE cascade;
    END IF;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_accounts_space" ON "accounts" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_accounts_space_sort" ON "accounts" USING btree ("space_id", "sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_categories_space" ON "categories" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_movements_space" ON "movements" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_movements_date" ON "movements" USING btree ("space_id", "date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_movements_review" ON "movements" USING btree ("space_id", "needs_review");--> statement-breakpoint
DO $$ BEGIN IF to_regclass('public.investment_snapshots') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS "idx_snapshots_space" ON "investment_snapshots" USING btree ("space_id")'; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF to_regclass('public.emergency_payments') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS "idx_emergency_payments_space" ON "emergency_payments" USING btree ("space_id")'; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF to_regclass('public.emergency_payments') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS "idx_emergency_payments_space_emergency" ON "emergency_payments" USING btree ("space_id", "emergency_id")'; END IF; END $$;--> statement-breakpoint

WITH ranked_accounts AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "space_id"
      ORDER BY "sort_order" ASC, "bank_name" ASC, "created_at" ASC, "id" ASC
    ) - 1 AS "new_sort_order"
  FROM "accounts"
)
UPDATE "accounts"
SET "sort_order" = ranked_accounts."new_sort_order"
FROM ranked_accounts
WHERE "accounts"."id" = ranked_accounts."id";
