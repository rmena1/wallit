CREATE TABLE incoming_bank_unresolved (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  email_id text NOT NULL,
  payload jsonb NOT NULL,
  reason text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX incoming_bank_unresolved_identity ON incoming_bank_unresolved(user_id, provider, email_id);
