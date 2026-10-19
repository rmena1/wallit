-- Additive, deliberately separate from historical logs that may contain PII.
CREATE TABLE bank_email_runs (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text NOT NULL DEFAULT 'running',
  last_successful_uid bigint
);
CREATE INDEX bank_email_runs_user_started ON bank_email_runs (user_id, started_at DESC);
CREATE TABLE bank_email_decisions (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL REFERENCES bank_email_runs(id),
  uid bigint NOT NULL,
  message_id_hash text NOT NULL,
  email_date timestamptz,
  sender text,
  decision text NOT NULL,
  reason text NOT NULL,
  alert boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bank_email_decisions_run ON bank_email_decisions(run_id, id);
CREATE INDEX bank_email_decisions_message ON bank_email_decisions(message_id_hash);
