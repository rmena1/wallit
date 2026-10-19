// Explicitly opt in with a disposable, local worker-test database. Never IMAP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const databaseUrl = process.env.WORKER_TEST_DATABASE_URL;
const url = new URL(databaseUrl || 'postgresql://invalid/invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^wallit_worker_test(?:_[a-z0-9_]+)?$/.test(url.pathname.slice(1))) {
  throw new Error('Requires WORKER_TEST_DATABASE_URL pointing to a disposable local wallit_worker_test database');
}
// Supply only inert configuration. All processing effects except local SQL are injected.
Object.assign(process.env, { DATABASE_URL: databaseUrl, GMAIL_USER: 'fixture@example.test', GMAIL_APP_PASSWORD: 'fixture',
  WALLIT_BASE_URL: 'http://127.0.0.1:1', WALLIT_IMPORT_TOKEN: 'fixture', WALLIT_USER_ID: 'worker-fixture', TYPESAFE_API_KEY: 'fixture',
  ACCOUNT_BCI_CHECKING_ID: 'fixture-checking', ACCOUNT_BCI_CLP_ID: 'fixture-clp', ACCOUNT_BCI_USD_ID: 'fixture-usd',
  ACCOUNT_TENPO_CREDIT_ID: 'fixture-credit', ACCOUNT_TENPO_VISTA_ID: 'fixture-vista', ACCOUNT_MERCADOPAGO_ID: 'fixture-mp',
  USD_CLP_EXCHANGE_RATE_X100: '95000', BANK_ACCOUNT_OWNER_NAMES: '["Titular Prueba"]', GMAIL_INITIAL_UID: '0', GMAIL_IMAP_FOLDER: 'INBOX' });
const database = await import('../src/lib/database.mjs');
const { runWorker } = await import('../src/lib/worker-runner.mjs');
const { createEmailProcessor } = await import('../src/lib/process-email.mjs');
const logger = { log() {}, error() {} };
test('real local SQL persists runs, unresolved alert, skip, import and monotonic cursor', async () => {
  const suffix = randomUUID();
  let imports = 0;
  const processEmail = createEmailProcessor({ logger, logProcessing: database.logProcessing, assertRunActive: database.assertAdvisoryLock,
    isTransaction: async () => true, chooseCategory: async () => null,
    importToWallit: async () => { imports++; return { success: true }; } });
  const base = { uidvalidity: 7, date: '2026-10-19T14:28:21Z', authentication: { verified: true } };
  const messages = [
    { ...base, uid: 1, messageId: `${suffix}-unknown`, from: 'contacto@bci.cl',
      textBody: 'Realizaste una compra con tu tarjeta de crédito. Número tarjeta crédito ****0000 Monto $42.390 Fecha 14/10/2026 Hora 17:43 horas Comercio FIXTURE Cuotas 0' },
    { ...base, uid: 2, messageId: `${suffix}-skip`, from: 'other@example.test', textBody: '' },
    { ...base, uid: 3, messageId: `${suffix}-import`, from: 'info@mercadopago.cl', subject: '¡Enviamos tu transferencia!',
      textBody: 'Ya enviamos tu transferencia de $360.000 Nombre y apellido: TITULAR PRUEBA Entidad: Banco BCI/MACH Número de cuenta: 99998080' },
  ];
  // Dedicated disposable fixture: no production or application financial records.
  await database.sql`DROP TABLE IF EXISTS bank_email_cursor`;
  const result = await runWorker({ ...database, processEmail, closeDatabase: async () => {},
    fetchNewEmails: async () => ({ uidvalidity: 7, messages }) }, { logger });
  try {
    assert.equal(result.exitCode, 0); assert.equal(result.lastSuccessfulUid, 3); assert.equal(imports, 1);
    const runs = await database.sql`SELECT id, outcome, finished_at FROM bank_email_runs WHERE user_id = 'worker-fixture' ORDER BY started_at DESC LIMIT 1`;
    assert.equal(runs[0].outcome, 'completed'); assert.ok(runs[0].finished_at);
    const decisions = await database.sql`SELECT decision, reason, alert, message_id_hash, sender FROM bank_email_decisions WHERE run_id = ${runs[0].id} ORDER BY uid`;
    assert.deepEqual(decisions.map(d => d.decision), ['unresolved', 'skipped', 'imported']);
    assert.equal(decisions[0].alert, true); assert.equal(decisions[1].sender, null);
    assert.ok(decisions.every(d => /^[a-f0-9]{64}$/.test(d.message_id_hash)));
    assert.equal(Number((await database.sql`SELECT last_uid FROM bank_email_cursor`)[0].last_uid), 3);
    // Staggered rollout: start, per-email telemetry and finish may each be unavailable.
    for (const missing of ['runs', 'decisions', 'finish']) {
      const nextUid = Number((await database.sql`SELECT last_uid FROM bank_email_cursor`)[0].last_uid) + 1;
      if (missing === 'runs') await database.sql`ALTER TABLE bank_email_runs RENAME TO fixture_hidden_runs`;
      if (missing === 'decisions') await database.sql`ALTER TABLE bank_email_decisions RENAME TO fixture_hidden_decisions`;
      try {
        const degraded = await runWorker({ ...database, processEmail, closeDatabase: async () => {},
          fetchNewEmails: async () => ({ uidvalidity: 7, messages: [{ ...messages[0], uid: nextUid, messageId: `${suffix}-${missing}` }] }),
          finishRun: missing !== 'finish' ? database.finishRun : async (id, outcome) => {
            await database.sql`ALTER TABLE bank_email_runs RENAME TO fixture_hidden_runs`;
            try { await database.finishRun(id, outcome); }
            finally { await database.sql`ALTER TABLE fixture_hidden_runs RENAME TO bank_email_runs`; }
          },
        }, { logger });
        assert.equal(degraded.exitCode, 0); assert.equal(degraded.lastSuccessfulUid, nextUid);
        assert.equal(Number((await database.sql`SELECT last_uid FROM bank_email_cursor`)[0].last_uid), nextUid);
        const [legacy] = await database.sql`SELECT decision FROM bank_email_processing_log WHERE uid = ${nextUid} ORDER BY id DESC LIMIT 1`;
        assert.equal(legacy.decision, 'account_unresolved');
      } finally {
        if (missing === 'runs') await database.sql`ALTER TABLE fixture_hidden_runs RENAME TO bank_email_runs`;
        if (missing === 'decisions') await database.sql`ALTER TABLE fixture_hidden_decisions RENAME TO bank_email_decisions`;
      }
    }
    // Best-effort telemetry never weakens the mandatory processing audit.
    const cursorBefore = Number((await database.sql`SELECT last_uid FROM bank_email_cursor`)[0].last_uid);
    const blocked = await runWorker({ ...database, processEmail, closeDatabase: async () => {},
      fetchNewEmails: async () => {
        await database.sql`ALTER TABLE bank_email_processing_log RENAME TO fixture_hidden_log`;
        return { uidvalidity: 7, messages: [{ ...messages[0], uid: cursorBefore + 1 }] };
      },
    }, { logger });
    await database.sql`ALTER TABLE fixture_hidden_log RENAME TO bank_email_processing_log`;
    assert.equal(blocked.exitCode, 1);
    assert.equal(Number((await database.sql`SELECT last_uid FROM bank_email_cursor`)[0].last_uid), cursorBefore);
    await database.sql`DELETE FROM bank_email_decisions WHERE run_id = ${runs[0].id}`;
    await database.sql`DELETE FROM bank_email_runs WHERE id = ${runs[0].id}`;
  } finally { await database.closeDatabase(); }
});
