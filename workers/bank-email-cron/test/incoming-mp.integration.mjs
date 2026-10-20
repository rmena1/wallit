// Local SQL + real anonymized MIME/parser/import service. Never opens HTTP or IMAP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import postgres from 'postgres';
const databaseUrl = process.env.WORKER_TEST_DATABASE_URL;
const url = new URL(databaseUrl || 'postgresql://invalid/invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^wallit_worker_test(?:_[a-z0-9_]+)?$/.test(url.pathname.slice(1))) throw new Error('Disposable local wallit_worker_test required');
const id = randomUUID(), user = `incoming-${id}`, creator = `creator-${id}`, space = `space-${id}`, account = `mp-${id}`;
Object.assign(process.env, { DATABASE_URL: databaseUrl, GMAIL_USER: 'fixture@example.test', GMAIL_APP_PASSWORD: 'fixture',
  WALLIT_BASE_URL: 'http://127.0.0.1:1', WALLIT_IMPORT_TOKEN: 'fixture', WALLIT_USER_ID: user, TYPESAFE_API_KEY: 'fixture',
  ACCOUNT_BCI_CHECKING_ID: 'fixture-checking', ACCOUNT_BCI_CLP_ID: 'fixture-clp', ACCOUNT_BCI_USD_ID: 'fixture-usd',
  ACCOUNT_TENPO_CREDIT_ID: 'fixture-credit', ACCOUNT_TENPO_VISTA_ID: 'fixture-vista', ACCOUNT_MERCADOPAGO_ID: account,
  USD_CLP_EXCHANGE_RATE_X100: '95000', BANK_ACCOUNT_OWNER_NAMES: '["Titular De Prueba"]' });
const root = new URL('../../../', import.meta.url);
const out = new URL('node_modules/.cache/incoming-bank-tests/service.mjs', root);
await mkdir(new URL('.', out), { recursive: true });
await build({ entryPoints: [new URL('src/lib/domain/email-import-service.ts', root).pathname], outfile: out.pathname,
  bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const { importWorkerEmailTransaction: importEmailTransaction, importEmailTransaction: untrustedImport } = await import(out.href);
const { parseRawMessage } = await import('../src/lib/imap.mjs');
const { runWorker } = await import('../src/lib/worker-runner.mjs');
const { createEmailProcessor } = await import('../src/lib/process-email.mjs');
const sql = postgres(databaseUrl, { max: 2 });
const cases = [['bci_in', 'transferencias@bci.cl', 1500000], ['santander1', 'mensajeria@santander.cl', 1498000],
  ['santander2', 'mensajeria@santander.cl', 583000], ['bice', 'reply@info.bice.cl', 1597000], ['bchile', 'serviciodetransferencias@bancochile.cl', 1487000]];
test('real fixture parsers + SQL importer preserve manual income and safely create new income', async () => {
  const logs = [], payloads = [];
  const processEmail = createEmailProcessor({ logger: { log() {}, error() {} }, logProcessing: async e => logs.push(e),
    isTransaction: async () => { throw new Error('unexpected classifier'); }, chooseCategory: async () => null,
    importToWallit: async p => { payloads.push(p); const r = await importEmailTransaction(p); if (!r.success) throw new Error(r.error); return r; } });
  try {
    for (const uid of [user, creator]) await sql`INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (${uid}, ${uid + '@example.test'}, 'unusable-fixture', now(), now())`;
    await sql`INSERT INTO spaces (id, name, normalized_name, emoji, created_by_user_id, created_at, updated_at) VALUES (${space}, 'Fixture', 'fixture', '🧪', ${user}, now(), now())`;
    for (const [uid, role] of [[user, 'owner'], [creator, 'member']]) await sql`INSERT INTO space_memberships (id, space_id, user_id, role, created_at) VALUES (${randomUUID()}, ${space}, ${uid}, ${role}, now())`;
    await sql`INSERT INTO accounts (id, space_id, created_by_user_id, bank_name, account_type, last_four_digits, currency, created_at, updated_at) VALUES (${account}, ${space}, ${user}, 'Mercado Pago', 'Vista', '6991', 'CLP', now(), now())`;
    for (const [file, , amount] of cases) await sql`INSERT INTO movements (id, space_id, created_by_user_id, account_id, name, date, amount, type, currency, needs_review, created_at, updated_at)
      VALUES (${id + file}, ${space}, ${creator}, ${account}, 'Manual fixture', '2026-10-19', ${amount}, 'income', 'CLP', false, now(), now())`;
    await sql`UPDATE movements SET time = '16:51' WHERE id = ${id + 'bice'}`;
    await sql`UPDATE movements SET time = '16:50' WHERE id = ${id + 'bchile'}`;
    for (const [file, amount] of [['bice', 1597000], ['bchile', 1487000]]) await sql`INSERT INTO movements (id, space_id, created_by_user_id, account_id, name, date, time, amount, type, currency, needs_review, created_at, updated_at)
      VALUES (${id + file + '-later'}, ${space}, ${creator}, ${account}, 'Separate manual notice', '2026-10-19', '17:51', ${amount}, 'income', 'CLP', false, now(), now())`;
    const before = await sql`SELECT * FROM movements WHERE account_id = ${account} ORDER BY id`;
    let uid = 19266;
    for (const [file, sender] of cases) {
      const html = await readFile(new URL(`./fixtures/incoming-${file}.anonymized.html`, import.meta.url), 'utf8');
      const message = await parseRawMessage({ uid: uid++, raw: Buffer.from([
        `From: ${sender}`, `Message-ID: <${id}-${file}@example.test>`, 'Date: Tue, 20 Oct 2026 20:51:50 +0000',
        'Received: by mx.google.com with ESMTPS id fixture', `Authentication-Results: mx.google.com; dmarc=pass header.from=${sender.split('@')[1]}`,
        'Content-Type: text/html; charset=utf-8', '', html,
      ].join('\r\n')) }, 1);
      for (let retry = 0; retry < 2; retry++) {
        assert.equal((await processEmail(message)).advance, true); assert.equal(logs.at(-1).decision, 'duplicate_success');
        assert.equal((await sql`SELECT movement_id FROM incoming_bank_receipts WHERE user_id = ${user} AND email_id = ${id + '-' + file + '@example.test'}`)[0].movement_id, id + file);
      }
    }
    assert.deepEqual(await sql`SELECT * FROM movements WHERE account_id = ${account} ORDER BY id`, before);
    assert.equal(Number((await sql`SELECT count(*) AS n FROM incoming_bank_receipts WHERE user_id = ${user}`)[0].n), 5);
    const fresh = { ...payloads[0], sourceEmailId: `${id}-fresh`, amount: 765400, needsReview: false };
    assert.equal((await untrustedImport({ ...fresh, trustedWorker: true })).success, false);
    const concurrent = await Promise.all([importEmailTransaction(fresh), importEmailTransaction(fresh)]);
    assert.ok(concurrent.every(r => r.success)); assert.equal(concurrent[0].movementId, concurrent[1].movementId);
    assert.deepEqual((await sql`SELECT needs_review, type FROM movements WHERE id = ${concurrent[0].movementId}`)[0], { needs_review: true, type: 'income' });
    const distinct = await importEmailTransaction({ ...fresh, sourceEmailId: `${id}-distinct` });
    assert.equal(distinct.success, true); assert.notEqual(distinct.movementId, concurrent[0].movementId);
    // Date-only notices cannot use a notification timestamp to break a tie.
    for (const clock of ['12:00', '13:00']) await sql`INSERT INTO movements (id, space_id, created_by_user_id, account_id, name, date, time, amount, type, currency, needs_review, created_at, updated_at)
      VALUES (${id + clock}, ${space}, ${creator}, ${account}, 'Ambiguous manual', '2026-10-19', ${clock}, 90000, 'income', 'CLP', false, now(), now())`;
    const ambiguousInput = { ...fresh, sourceEmailId: `${id}-ambiguous`, amount: 90000, time: '12:00', operationTime: null };
    const pending = await importEmailTransaction(ambiguousInput);
    assert.deepEqual(pending, { success: true, unresolved: true, reason: 'incoming_manual_ambiguous' });
    const [saved] = await sql`SELECT payload, resolved_at FROM incoming_bank_unresolved WHERE email_id = ${ambiguousInput.sourceEmailId}`;
    assert.equal(saved.payload.amount, 90000); assert.equal(saved.resolved_at, null);
    // Real service unresolved success lets the worker process the next email.
    let cursor = 19265;
    const queueProcessor = createEmailProcessor({ logger: { log() {}, error() {} }, logProcessing: async e => logs.push(e),
      isTransaction: async () => true, chooseCategory: async () => null,
      importToWallit: async p => importEmailTransaction(p.sourceEmailId === 'ambiguous@fixture.test' ? ambiguousInput : { ...fresh, sourceEmailId: `${id}-following`, amount: 90100 }) });
    const base = { uidvalidity: 1, from: 'transferencias@bci.cl', date: '2026-10-20T20:51:00Z', authentication: { verified: true },
      textBody: 'Hola Titular De Prueba Has recibido una transferencia de fondos de Pagador Prueba hacia tu cuenta del Mercado Pago Datos de la transferencia Monto recibido$900 Banco de origenBanco Bci / Mach Fecha de la transferencia 19/10/2026' };
    const run = await runWorker({ acquireAdvisoryLock: async () => true, createProcessingLog: async () => {},
      getCursor: async () => ({ lastUid: cursor, uidvalidity: 1 }), updateCursor: async (_, uid) => { cursor = uid; },
      fetchNewEmails: async () => ({ uidvalidity: 1, messages: [{ ...base, uid: 19266, messageId: 'ambiguous@fixture.test' }, { ...base, uid: 19267, messageId: 'following@fixture.test' }] }),
      processEmail: queueProcessor, releaseAdvisoryLock: async () => {}, closeDatabase: async () => {} }, { logger: { log() {}, error() {} } });
    assert.equal(run.reason, 'completed'); assert.equal(cursor, 19267);
    assert.deepEqual(logs.slice(-2).map(e => e.decision), ['incoming_manual_ambiguous', 'imported']);
    // Explicit later reconciliation uses retained parsed evidence; no mailbox replay.
    await sql`DELETE FROM movements WHERE id = ${id + '13:00'}`;
    assert.equal((await importEmailTransaction(saved.payload)).movementId, id + '12:00');
    assert.ok((await sql`SELECT resolved_at FROM incoming_bank_unresolved WHERE email_id = ${ambiguousInput.sourceEmailId}`)[0].resolved_at);
    // Required evidence storage failure must not masquerade as durable unresolved.
    await sql`ALTER TABLE incoming_bank_unresolved RENAME TO fixture_hidden_unresolved`;
    try {
      assert.equal((await importEmailTransaction({ ...ambiguousInput, sourceEmailId: `${id}-missing-unresolved` })).success, false);
    } finally { await sql`ALTER TABLE fixture_hidden_unresolved RENAME TO incoming_bank_unresolved`; }
    // Missing migration must fail closed before a financial insertion.
    const count = Number((await sql`SELECT count(*) AS n FROM movements WHERE account_id = ${account}`)[0].n);
    await sql`ALTER TABLE incoming_bank_receipts RENAME TO fixture_hidden_incoming_receipts`;
    try {
      assert.equal((await importEmailTransaction({ ...fresh, sourceEmailId: `${id}-old-schema` })).success, false);
      assert.equal(Number((await sql`SELECT count(*) AS n FROM movements WHERE account_id = ${account}`)[0].n), count);
    } finally { await sql`ALTER TABLE fixture_hidden_incoming_receipts RENAME TO incoming_bank_receipts`; }
  } finally {
    await sql`DELETE FROM spaces WHERE id = ${space}`;
    await sql`DELETE FROM users WHERE id IN (${user}, ${creator})`;
    await sql.end();
  }
});
