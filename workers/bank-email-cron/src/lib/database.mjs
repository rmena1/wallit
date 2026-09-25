import postgres from 'postgres';
import { config } from '../config/index.mjs';

export const sql = postgres(config.database.url);

const ADVISORY_LOCK_KEY = 837462918;

export async function acquireAdvisoryLock() {
  const result = await sql`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) as acquired`;
  return result[0].acquired;
}

export async function releaseAdvisoryLock() {
  await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
}

export async function getCursor() {
  await sql`
    CREATE TABLE IF NOT EXISTS bank_email_cursor (
      id INTEGER PRIMARY KEY DEFAULT 1,
      folder TEXT NOT NULL,
      uidvalidity BIGINT,
      last_uid BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT single_cursor CHECK (id = 1)
    )
  `;
  
  const folder = config.gmail.folder;
  const [cursor] = await sql`
    INSERT INTO bank_email_cursor (id, folder, last_uid)
    VALUES (1, ${folder}, ${config.gmail.initialUid})
    ON CONFLICT (id) DO UPDATE SET folder = ${folder}
    RETURNING uidvalidity, last_uid
  `;
  
  return {
    uidvalidity: cursor.uidvalidity ? Number(cursor.uidvalidity) : null,
    lastUid: Number(cursor.last_uid),
  };
}

export async function updateCursor(uidvalidity, lastUid) {
  await sql`
    UPDATE bank_email_cursor
    SET uidvalidity = ${uidvalidity},
        last_uid = ${lastUid},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `;
}

export async function resetCursorForNewUidvalidity(newUidvalidity) {
  console.warn('UIDVALIDITY changed, resetting cursor', { newUidvalidity });
  await sql`
    UPDATE bank_email_cursor
    SET uidvalidity = ${newUidvalidity},
        last_uid = ${config.gmail.initialUid},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `;
}

export async function createProcessingLog() {
  await sql`
    CREATE TABLE IF NOT EXISTS bank_email_processing_log (
      id SERIAL PRIMARY KEY,
      uid BIGINT NOT NULL,
      message_id TEXT NOT NULL,
      from_address TEXT NOT NULL,
      subject TEXT NOT NULL,
      decision TEXT NOT NULL,
      provider TEXT,
      parser_succeeded BOOLEAN,
      account_id TEXT,
      category_id TEXT,
      import_success BOOLEAN,
      import_duplicate BOOLEAN,
      error_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_processing_log_message_id 
    ON bank_email_processing_log(message_id)
  `;
  
  await sql`
    DO $$ 
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'bank_email_processing_log' 
        AND column_name = 'account_id'
      ) THEN
        ALTER TABLE bank_email_processing_log ADD COLUMN account_id TEXT;
      END IF;
    END $$;
  `;
}

export async function logProcessing(entry) {
  await sql`
    INSERT INTO bank_email_processing_log (
      uid, message_id, from_address, subject, decision, 
      provider, parser_succeeded, account_id, category_id, 
      import_success, import_duplicate, error_message
    ) VALUES (
      ${entry.uid}, ${entry.messageId}, ${entry.from}, ${entry.subject},
      ${entry.decision}, ${entry.provider || null}, ${entry.parserSucceeded || false},
      ${entry.accountId || null}, ${entry.categoryId || null}, ${entry.importSuccess || false},
      ${entry.importDuplicate || false}, ${entry.errorMessage || null}
    )
  `;
}
