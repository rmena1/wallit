CREATE TABLE "own_bank_transfer_imports" (
  "id" text PRIMARY KEY,
  "created_by_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "operation_key" text NOT NULL,
  "date" text NOT NULL,
  "time" text,
  "amount" bigint NOT NULL,
  "currency" text NOT NULL DEFAULT 'CLP',
  "from_bank" text NOT NULL,
  "from_number" text,
  "from_product" text,
  "from_account_id" text REFERENCES "accounts"("id") ON DELETE SET NULL,
  "to_bank" text NOT NULL,
  "to_number" text,
  "to_product" text,
  "to_account_id" text REFERENCES "accounts"("id") ON DELETE SET NULL,
  "transfer_id" text REFERENCES "transfers"("id") ON DELETE SET NULL,
  "status" text NOT NULL CHECK ("status" IN ('linked', 'pending_accounts')),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "own_bank_transfer_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "own_bank_transfer_currency" CHECK ("currency" = 'CLP')
);
CREATE UNIQUE INDEX "idx_own_bank_transfer_operation" ON "own_bank_transfer_imports" ("created_by_user_id", "operation_key");
CREATE TABLE "own_bank_transfer_receipts" (
  "id" text PRIMARY KEY,
  "import_id" text NOT NULL REFERENCES "own_bank_transfer_imports"("id") ON DELETE CASCADE,
  "created_by_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "email_id" text NOT NULL,
  "reference" text
);
CREATE UNIQUE INDEX "idx_own_bank_transfer_receipt" ON "own_bank_transfer_receipts" ("created_by_user_id", "provider", "email_id");
