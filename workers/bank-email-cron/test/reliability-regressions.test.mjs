import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runWorker } from '../src/lib/worker-runner.mjs';
import { createEmailProcessor, sourceIdentity } from '../src/lib/process-email.mjs';
import { getProviderFromEmail, verifyGmailAuthentication } from '../src/lib/sender-auth.mjs';
import { ImapClient, parseRawMessage } from '../src/lib/imap.mjs';
import { createImportClient } from '../src/lib/import-client.mjs';
import { config } from '../src/config/index.mjs';
import { parseEmailDate } from '../src/lib/date-utils.mjs';
const logger = { log() {}, warn() {}, error() {} };
function fakeDeps(overrides = {}) {
  const calls = []; let cursor = { lastUid: 100, uidvalidity: 77 };
  const deps = { acquireAdvisoryLock: async () => { calls.push('lock'); return true; },
    releaseAdvisoryLock: async () => { calls.push('unlock'); }, closeDatabase: async () => { calls.push('close'); },
    createProcessingLog: async () => { calls.push('schema'); }, getCursor: async () => cursor,
    fetchNewEmails: async () => ({ uidvalidity: 77, messages: [{ uid: 101 }, { uid: 102 }] }),
    processEmail: async email => { calls.push(`process:${email.uid}`); return { success: true, advance: true }; },
    updateCursor: async (validity, uid) => { calls.push(`cursor:${uid}`); cursor = { lastUid: uid, uidvalidity: validity }; }, ...overrides };
  return { deps, calls, cursor: () => cursor };
}
test('runner sorts, persists confirmed UIDs and always unlocks/closes before return', async () => {
  const f = fakeDeps({ fetchNewEmails: async () => ({ uidvalidity: 77, messages: [{ uid: 102 }, { uid: 101 }] }) });
  assert.equal((await runWorker(f.deps, { logger })).exitCode, 0);
  assert.deepEqual(f.calls, ['lock', 'schema', 'process:101', 'cursor:101', 'process:102', 'cursor:102', 'unlock', 'close']);
});
test('blocked/poison email returns nonzero, later mail remains unprocessed, retry same UID', async () => {
  const f = fakeDeps({ processEmail: async () => ({ success: false, advance: false }) });
  const result = await runWorker(f.deps, { logger });
  assert.equal(result.exitCode, 1); assert.equal(result.blockedUid, 101); assert.equal(f.cursor().lastUid, 100);
  assert.deepEqual(f.calls, ['lock', 'schema', 'unlock', 'close']);
});
test('UIDVALIDITY changes never reset/replay even when old movements were deleted', async () => {
  const f = fakeDeps({ fetchNewEmails: async () => ({ uidvalidity: 99, messages: [{ uid: 101 }] }) });
  const result = await runWorker(f.deps, { logger });
  assert.equal(result.reason, 'uidvalidity_changed'); assert.equal(result.exitCode, 1);
  assert.equal(f.cursor().lastUid, 100); assert.ok(!f.calls.some(c => c.startsWith('process:') || c.startsWith('cursor:')));
});
test('lock-busy and failures close DB; empty batch initializes epoch without cursor reset', async () => {
  const busy = fakeDeps({ acquireAdvisoryLock: async () => false });
  assert.equal((await runWorker(busy.deps, { logger })).reason, 'lock_busy'); assert.deepEqual(busy.calls, ['close']);
  const failed = fakeDeps({ getCursor: async () => { throw new Error('private data must not be logged'); } });
  assert.equal((await runWorker(failed.deps, { logger })).exitCode, 1); assert.deepEqual(failed.calls.slice(-2), ['unlock', 'close']);
  const initial = fakeDeps({ getCursor: async () => ({ lastUid: 100, uidvalidity: null }), fetchNewEmails: async () => ({ uidvalidity: 77, messages: [] }) });
  assert.equal((await runWorker(initial.deps, { logger })).exitCode, 0); assert.ok(initial.calls.includes('cursor:100'));
});
test('budget defers subsequent work without losing the next UID; cleanup failure is nonzero', async () => {
  const f = fakeDeps(); assert.equal((await runWorker(f.deps, { logger, now: () => 10, budgetMs: 0 })).reason, 'budget_reached');
  assert.equal(f.cursor().lastUid, 100);
  const cleanup = fakeDeps({ releaseAdvisoryLock: async () => { throw new Error('failed'); } });
  assert.equal((await runWorker(cleanup.deps, { logger })).exitCode, 1);
});
test('sender allowlist cannot be spoofed through display names, suffix domains or multiple mailboxes', () => {
  for (const from of ['contacto@bci.cl.attacker.test', '"contacto@bci.cl" <evil@example.com>',
    'contacto@bci.cl, evil@example.com', 'Contact <contacto@bci.cl> <evil@example.com>', 'contacto@bci.cl\nInjected: value']) {
    assert.equal(getProviderFromEmail(from), null);
  }
  assert.equal(getProviderFromEmail('BCI <CONTACTO@BCI.CL>'), 'bci');
});
function headers(auth) { return [{ key: 'received', line: 'Received: by mx.google.com with ESMTPS id synthetic' },
  { key: 'authentication-results', line: `Authentication-Results: ${auth}` }]; }
test('Gmail aligned DMARC accepted including forwarded SPF gmail.com; arbitrary/later headers rejected', () => {
  assert.equal(verifyGmailAuthentication(headers('mx.google.com; spf=pass smtp.mailfrom=gmail.com; dmarc=pass header.from=tenpo.cl'), 'no-reply@tenpo.cl').verified, true);
  for (const auth of ['evil.example; dmarc=pass header.from=tenpo.cl', 'mx.google.com; dmarc=fail header.from=tenpo.cl',
    'mx.google.com; dmarc=pass header.from=evil.example']) assert.equal(verifyGmailAuthentication(headers(auth), 'no-reply@tenpo.cl').verified, false);
  const forged = [{ key: 'authentication-results', line: 'Authentication-Results: evil.example; dmarc=pass header.from=tenpo.cl' }, ...headers('mx.google.com; dmarc=pass header.from=tenpo.cl')];
  assert.equal(verifyGmailAuthentication(forged, 'no-reply@tenpo.cl').verified, false);
});
const notice = { uid: 101, uidvalidity: 77, messageId: 'synthetic@example.test', from: 'contacto@bci.cl', authentication: { verified: true },
  textBody: 'Realizaste una compra con tu tarjeta de crédito.\nMonto: $1.234\nComercio: Example Merchant\nFecha: 01/01/2026\nHora: 12:00 horas\nNúmero tarjeta crédito: ****1164' };
async function processCase(email, overrides = {}) {
  const imports = [], logs = [];
  const processor = createEmailProcessor({ isTransaction: async () => true, chooseCategory: async () => null,
    importToWallit: async payload => { imports.push(payload); return { success: true }; }, logProcessing: async entry => logs.push(entry), logger, ...overrides });
  return { result: await processor(email), imports, logs };
}
test('authentication missing blocks, failed auth rejects without imports, malformed MIME never skips', async () => {
  assert.equal((await processCase({ ...notice, authentication: undefined })).result.advance, false);
  const invalid = await processCase({ ...notice, authentication: { verified: false, reason: 'authentication_failed' } });
  assert.equal(invalid.result.advance, true); assert.equal(invalid.imports.length, 0);
  assert.equal((await processCase({ uid: 101, decodeError: 'mime_parse_failed' })).result.advance, false);
});
test('transaction-shaped parser no-match cannot silently advance; nontransaction can skip', async () => {
  assert.equal((await processCase({ ...notice, textBody: notice.textBody.replace('Hora: 12:00 horas', '') })).result.advance, false);
  const marketing = await processCase({ ...notice, textBody: 'Conoce nuestras novedades' });
  assert.equal(marketing.result.advance, true); assert.equal(marketing.imports.length, 0);
});
test('invalid date, time, zero, overflow and classifier response never import', async () => {
  for (const body of [notice.textBody.replace('01/01/2026', '31/02/2026'), notice.textBody.replace('12:00', '25:61'),
    notice.textBody.replace('1.234', '0'), notice.textBody.replace('1.234', '999999999999999999')]) {
    const r = await processCase({ ...notice, textBody: body }); assert.equal(r.result.advance, false); assert.equal(r.imports.length, 0);
  }
  assert.equal((await processCase(notice, { isTransaction: async () => 'unknown' })).result.advance, false);
});
test('stable message identity fallback is epoch-scoped; existing Message-ID unchanged; logs are redacted', async () => {
  const e = { ...notice, messageId: null }; assert.match(sourceIdentity(e), /^imap:[a-f0-9]{64}$/);
  assert.equal(sourceIdentity(e), sourceIdentity(e)); assert.notEqual(sourceIdentity(e), sourceIdentity({ ...e, uidvalidity: 78 }));
  assert.equal(sourceIdentity(notice), notice.messageId);
  const r = await processCase(e); assert.equal(r.imports[0].sourceEmailId, sourceIdentity(e));
  assert.equal(r.logs[0].subject, ''); assert.equal(r.logs[0].from, 'bci'); assert.match(r.logs[0].messageId, /^[a-f0-9]{64}$/);
  const failure = await processCase(notice, { importToWallit: async () => { throw new Error('secret-token and private body'); } });
  assert.equal(failure.result.error, 'processing_failed'); assert.ok(!JSON.stringify(failure.logs).includes('secret-token'));
});
test('IMAP close/errors/timeouts reject pending operations and retain read-only folder semantics', async () => {
  const previous = config.gmail.operationTimeoutMs; config.gmail.operationTimeoutMs = 20;
  try {
    for (const event of ['error', 'close', 'end', 'timeout']) {
      const c = new ImapClient({ logger }); c.imap = new EventEmitter();
      c.imap.openBox = (folder, readOnly) => { assert.equal(readOnly, true); if (event !== 'timeout') queueMicrotask(() => c.imap.emit(event, new Error('private'))); };
      await assert.rejects(c.openFolder('INBOX'), /imap_open_failed/);
    }
  } finally { config.gmail.operationTimeoutMs = previous; }
});
test('IMAP bounded UID search uses cursor server-side and prevents historical fetch', async () => {
  const c = new ImapClient({ logger }); let criteria, fetched;
  c.imap = new EventEmitter(); c.imap.search = (query, callback) => { criteria = query; callback(null, [99, 101, 101, 102, ...Array.from({ length: 80 }, (_, i) => i + 103)]); };
  c.fetchMessagesByUid = async uids => { fetched = uids; return []; };
  await c.fetchMessagesSince(100, 0, 30); assert.deepEqual(criteria.at(-1), ['UID', '101:*']);
  assert.equal(fetched.length, 50); assert.equal(fetched[0], 101); assert.equal(fetched.at(-1), 150);
});
test('HTML-only MIME and split UTF8 fields decode without carrying raw bodies forward', async () => {
  const raw = Buffer.from('From: BCI <contacto@bci.cl>\r\nMessage-ID: <html@test.example>\r\nDate: Thu, 1 Jan 2026 15:00:00 -0300\r\nReceived: by mx.google.com with ESMTPS id test\r\nAuthentication-Results: mx.google.com; dmarc=pass header.from=bci.cl\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Realizaste una compra con tu tarjeta de crédito.</p><p>Monto: $1.234</p><p>Comercio: Example Merchant</p><p>Fecha: 01/01/2026</p><p>Hora: 12:00 horas</p><p>Número tarjeta crédito: ****1164</p>');
  const email = await parseRawMessage({ uid: 101, raw }, 77);
  assert.equal(email.authentication.verified, true); assert.ok(!('_raw' in email));
  assert.equal((await processCase(email)).imports.length, 1);
});
test('import retry preserves exact identity+body, retries HTTP500 and stops validation errors', async () => {
  const bodies = []; let count = 0;
  const client = createImportClient({ logger, sleep: async () => {}, fetchImpl: async (url, options) => {
    bodies.push(options.body); return ++count === 1 ? { ok: false, status: 500 } : { ok: true, status: 200, json: async () => ({ success: true, duplicate: true }) };
  } });
  assert.equal((await client({ sourceEmailId: 'stable', amount: 123400 })).duplicate, true); assert.equal(bodies[0], bodies[1]);
  let attempts = 0; const invalid = createImportClient({ logger, sleep: async () => {}, fetchImpl: async () => { attempts++; return { ok: false, status: 400 }; } });
  await assert.rejects(invalid({}), /HTTP 400/); assert.equal(attempts, 1);
});
test('import deadline covers slow response body; timeout retry is bounded', async () => {
  let attempts = 0;
  const client = createImportClient({ logger, timeoutMs: 15, sleep: async () => {}, fetchImpl: async (url, options) => {
    attempts++; return { ok: true, status: 200, json: () => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('private server body'), { name: 'AbortError' })))) };
  } });
  await assert.rejects(client({ sourceEmailId: 'stable' }), /after 3 attempt/); assert.equal(attempts, 3);
});
test('Chile local header dates preserve midnight and DST boundaries; invalid prose dates reject', () => {
  assert.deepEqual(parseEmailDate('2026-09-25T01:30:00Z'), { date: '2026-09-24', time: '22:30' });
  assert.deepEqual(parseEmailDate('2026-08-26T01:30:00Z'), { date: '2026-08-25', time: '21:30' });
  assert.deepEqual(parseEmailDate('31 de febrero de 2026 a las 25:70'), {});
});

import { createLockSessionGuard } from '../src/lib/lock-session-guard.mjs';
test('session disconnect is sticky, and a transparent reconnect cannot inherit advisory ownership', () => {
  const guard = createLockSessionGuard(); guard.acquired(123);
  guard.verify(123, true); guard.connectionClosed();
  assert.throws(() => guard.assertActive(), /database_session_lost/);
  assert.throws(() => guard.verify(456, true), /database_session_lost/);
  assert.throws(() => guard.acquired(456), /database_session_lost/);
  const changed = createLockSessionGuard(); changed.acquired(123);
  assert.throws(() => changed.verify(456, true), /database_session_lost/);
  const missing = createLockSessionGuard(); missing.acquired(123);
  assert.throws(() => missing.verify(123, false), /database_session_lost/);
});
test('session loss during classification prevents import and cursor advancement', async () => {
  const guard = createLockSessionGuard(); guard.acquired(123);
  const r = await processCase(notice, { chooseCategory: async () => { guard.connectionClosed(); return null; }, assertRunActive: async () => guard.assertActive() });
  assert.equal(r.result.advance, false); assert.equal(r.imports.length, 0); assert.equal(r.result.error, 'database_session_lost');
});

test('corrupt cursor UID/UIDVALIDITY cannot fetch, import or mutate state', async () => {
  for (const cursor of [ { lastUid: NaN, uidvalidity: 1 }, { lastUid: -5, uidvalidity: 1 },
    { lastUid: 2 ** 32, uidvalidity: 1 }, { lastUid: 1, uidvalidity: 0 }, { lastUid: 1, uidvalidity: 2 ** 32 } ]) {
    const f = fakeDeps({ getCursor: async () => cursor, fetchNewEmails: async () => assert.fail('invalid cursor cannot fetch') });
    assert.equal((await runWorker(f.deps, { logger })).exitCode, 1);
    assert.ok(!f.calls.some(c => c.startsWith('process:') || c.startsWith('cursor:')));
  }
});
test('IMAP deadline force-destroys underlying socket rather than queuing logout forever', async () => {
  const previous = config.gmail.operationTimeoutMs; config.gmail.operationTimeoutMs = 15;
  try {
    const c = new ImapClient({ logger }); c.imap = new EventEmitter(); let destroyed = false, ended = false;
    c.imap._sock = { destroy: () => { destroyed = true; }, end: () => { ended = true; } };
    c.imap.destroy = () => c.imap._sock.end(); c.imap.openBox = () => {};
    await assert.rejects(c.openFolder('INBOX'), /imap_open_failed/);
    assert.equal(ended, true); assert.equal(destroyed, true);
  } finally { config.gmail.operationTimeoutMs = previous; }
});
test('expired network budget prevents expensive calls and mid-classification expiry prevents import', async () => {
  let clock = 10, calls = 0;
  const runtime = { deadlineMs: 11, now: () => clock };
  const client = createImportClient({ logger, fetchImpl: async () => { calls++; assert.fail('expired budget'); } });
  clock = 12; await assert.rejects(client({}, runtime), /run_budget_exhausted/); assert.equal(calls, 0);
  clock = 10;
  const imports = [];
  const processor = createEmailProcessor({ logger, isTransaction: async () => { clock = 12; return true; },
    chooseCategory: async () => null, importToWallit: async payload => { imports.push(payload); return { success: true }; }, logProcessing: async () => {} });
  const result = await processor(notice, runtime); assert.equal(result.advance, false); assert.equal(result.error, 'run_budget_exhausted'); assert.equal(imports.length, 0);
});
test('invalid source RFC/ISO calendars cannot be normalized into successful header-date imports', async () => {
  for (const date of ['2026-02-31T12:00:00Z', 'Fri, 31 Feb 2026 12:00:00 -0300', '2026-01-01T25:61:00Z']) assert.deepEqual(parseEmailDate(date), {});
  const raw = Buffer.from('From: Mercado Pago <info@mercadopago.com>\r\nMessage-ID: <bad-date@test.example>\r\nDate: Fri, 31 Feb 2026 12:00:00 -0300\r\nReceived: by mx.google.com with ESMTPS id test\r\nAuthentication-Results: mx.google.com; dmarc=pass header.from=mercadopago.com\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYa enviamos tu transferencia de $1.234 Nombre y apellido: Example Person Entidad: Example Bank Número de cuenta: 0000');
  const email = await parseRawMessage({ uid: 101, raw }, 77);
  const r = await processCase(email); assert.equal(r.result.advance, false); assert.equal(r.imports.length, 0);
});

test('month-first human timestamp validates its original calendar and date-only local fields do not shift', () => {
  assert.deepEqual(parseEmailDate('Fri Feb 31 2026 12:00:00 GMT-0300'), {});
  assert.deepEqual(parseEmailDate('2026-01-01'), { date: '2026-01-01' });
});

test('each import retry rechecks advisory ownership; first uncertain attempt retains identity and blocks retry after loss', async () => {
  const guard = createLockSessionGuard(); guard.acquired(123); let requests = 0;
  const client = createImportClient({ logger, sleep: async () => {}, fetchImpl: async () => {
    requests++; guard.connectionClosed(); return { ok: false, status: 503 };
  } });
  const result = await processCase(notice, { importToWallit: client, assertRunActive: async () => guard.assertActive() });
  assert.equal(requests, 1); assert.equal(result.result.advance, false); assert.equal(result.result.error, 'database_session_lost');
});
