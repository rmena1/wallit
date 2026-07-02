ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "reportable" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
UPDATE "movements" m
SET "reportable" = false,
    "category_id" = NULL
WHERE EXISTS (
  SELECT 1 FROM "transfers" t
  WHERE t."source_movement_id" = m."id"
     OR t."destination_movement_id" = m."id"
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_movements_reportable" ON "movements" ("space_id", "reportable");
