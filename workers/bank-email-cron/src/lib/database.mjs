import postgres from 'postgres';
import { config } from '../config/index.mjs';
import { createSocketTracker, withDatabaseDeadline } from './database-deadline.mjs';
import { createLockSessionGuard } from './lock-session-guard.mjs';

const guard = createLockSessionGuard();
const tracker = createSocketTracker();
const pool = postgres(config.database.url, { socket: options => tracker.connect(options), max: 1, connect_timeout: 10, idle_timeout: 0, max_lifetime: null, onclose: () => guard.connectionClosed() });
let activeSql = pool;
const execute = operation => withDatabaseDeadline(operation, { timeoutMs: config.database.timeoutMs, onTimeout: () => {
  guard.invalidate(); tracker.destroy(); void pool.end({ timeout: 0 }).catch(() => {});
} });
export const sql = (strings, ...args) => execute(() => activeSql(strings, ...args));
let lockSession = null;

const ADVISORY_LOCK_KEY = 837462918;

export async function acquireAdvisoryLock() {
  lockSession = await execute(() => pool.reserve());
  activeSql = lockSession;
  await sql`SET statement_timeout = 15000`;
  const result = await sql`SELECT pg_backend_pid() as pid, pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) as acquired`;
  if (result[0].acquired) guard.acquired(result[0].pid);
  if (!result[0].acquired) { lockSession.release(); lockSession = null; activeSql = pool; }
  return result[0].acquired;
}

export async function releaseAdvisoryLock() {
  if (!lockSession) return;
  try { if (!guard.lost) await execute(() => lockSession`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`); }
  finally { guard.released(); lockSession.release(); lockSession = null; activeSql = pool; }
}

export async function assertAdvisoryLock() {
  guard.assertActive();
  const [state] = await sql`SELECT pg_backend_pid() as pid,
    EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
      AND classid = 0::oid AND objid = ${ADVISORY_LOCK_KEY}::oid AND objsubid = 1 AND granted) as held`;
  guard.verify(state.pid, state.held);
}

export async function closeDatabase() { try { await pool.end({ timeout: 5 }); } finally { tracker.destroy(); } }

export async function getCursor() {
  await assertAdvisoryLock();
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
    ON CONFLICT (id) DO UPDATE SET id = bank_email_cursor.id
    RETURNING folder, uidvalidity, last_uid
  `;
  
  if (cursor.folder !== folder) throw new Error('cursor_folder_changed');
  return {
    uidvalidity: cursor.uidvalidity ? Number(cursor.uidvalidity) : null,
    lastUid: Number(cursor.last_uid),
  };
}

export async function updateCursor(uidvalidity, lastUid) {
  await assertAdvisoryLock();
  const changed = await sql`
    UPDATE bank_email_cursor
    SET uidvalidity = ${uidvalidity},
        last_uid = ${lastUid},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1 AND last_uid <= ${lastUid}
    RETURNING last_uid
  `;
  if (changed.length !== 1 || Number(changed[0].last_uid) !== lastUid) throw new Error('cursor_update_rejected');
}

export async function createProcessingLog() {
  await assertAdvisoryLock();
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
  await assertAdvisoryLock();
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
