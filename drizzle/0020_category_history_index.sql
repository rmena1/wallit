CREATE INDEX "idx_movements_category_history"
  ON "movements" ("created_by_user_id", "original_name")
  WHERE "category_id" IS NOT NULL;
