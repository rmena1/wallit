ALTER TABLE bank_email_runs ADD COLUMN search_match_count integer CHECK (search_match_count >= 0);
ALTER TABLE bank_email_runs ADD COLUMN fetched_count integer CHECK (fetched_count >= 0);
CREATE TABLE incoming_bank_receipts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  email_id text NOT NULL,
  movement_id text NOT NULL REFERENCES movements(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX incoming_bank_receipts_identity ON incoming_bank_receipts(user_id, provider, email_id);
CREATE UNIQUE INDEX incoming_bank_receipts_movement ON incoming_bank_receipts(movement_id);
