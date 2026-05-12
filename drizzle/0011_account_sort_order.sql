ALTER TABLE "accounts" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

WITH ranked_accounts AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id"
      ORDER BY "bank_name" ASC, "created_at" ASC, "id" ASC
    ) - 1 AS "new_sort_order"
  FROM "accounts"
)
UPDATE "accounts"
SET "sort_order" = ranked_accounts."new_sort_order"
FROM ranked_accounts
WHERE "accounts"."id" = ranked_accounts."id";
