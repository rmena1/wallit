import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRawMessage, ImapClient } from '../src/lib/imap.mjs';
import { createEmailProcessor } from '../src/lib/process-email.mjs';
import { config } from '../src/config/index.mjs';
import { runWorker } from '../src/lib/worker-runner.mjs';
config.ownerNames = ['Titular De Prueba'];
const cases = [ ['bci_in', 'transferencias@bci.cl', 1500000], ['santander1', 'mensajeria@santander.cl', 1498000],
  ['santander2', 'mensajeria@santander.cl', 583000], ['bice', 'reply@info.bice.cl', 1597000], ['bchile', 'serviciodetransferencias@bancochile.cl', 1487000] ];
const logger = { log() {}, error() {} };
async function email(file, sender, transform = s => s, auth = 'pass', domain = sender.split('@')[1]) {
  const html = transform(await readFile(new URL(`./fixtures/incoming-${file}.anonymized.html`, import.meta.url), 'utf8'));
  return parseRawMessage({ uid: 19266, raw: Buffer.from([
    `From: ${sender}`, 'Subject: Aviso de transferencia de fondos', `Message-ID: <${file}@example.test>`,
    'Date: Mon, 19 Oct 2026 19:51:50 +0000', 'Received: by mx.google.com with ESMTPS id fixture',
    `Authentication-Results: mx.google.com; dmarc=${auth} header.from=${domain}`,
    'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', html,
  ].join('\r\n')) }, 1);
}
function processor(logs, payloads) {
  return createEmailProcessor({ logger, isTransaction: async () => { throw new Error('AI must not decide deterministic income'); },
    chooseCategory: async () => { throw new Error('Income starts unclassified'); },
    logProcessing: async e => logs.push(e), importToWallit: async p => { payloads.push(p); return { success: true }; } });
}
for (const [file, sender, amount] of cases) {
  test(`${file}: authenticated incoming fixture imports pending-review income into MP`, async () => {
    const logs = [], payloads = [];
    const result = await processor(logs, payloads)(await email(file, sender));
    assert.equal(result.advance, true); assert.equal(payloads.length, 1, JSON.stringify(logs));
    assert.equal(payloads[0].kind, 'incoming-bank-transfer'); assert.equal(payloads[0].type, 'income');
    assert.equal(payloads[0].accountId, config.accounts.mercadopago); assert.equal(payloads[0].categoryId, null);
    assert.equal(payloads[0].amount, amount); assert.equal(payloads[0].date, '2026-10-19');
    assert.equal(logs[0].decision, 'imported');
  });
  test(`${file}: failed/unaligned DMARC skips without import`, async () => {
    for (const [auth, domain] of [['fail', sender.split('@')[1]], ['pass', 'attacker.invalid']]) {
      const logs = [], payloads = [];
      await processor(logs, payloads)(await email(file, sender, s => s, auth, domain));
      assert.equal(payloads.length, 0); assert.equal(logs[0].decision, 'authentication_failed');
    }
  });
  test(`${file}: non-owner or other destination is a visible skip`, async () => {
    const logs = [], payloads = [];
    await processor(logs, payloads)(await email(file, sender, s => s.replaceAll('Titular De Prueba', 'Otra Persona').replaceAll('6991', '1234')));
    assert.equal(payloads.length, 0); assert.equal(logs[0].decision, 'incoming_destination_not_owner');
  });
}
test('owner name does not override an explicitly different account', async () => {
  for (const [file, sender] of cases.filter(([f]) => f !== 'bci_in')) {
    const logs = [], payloads = [];
    const message = await email(file, sender);
    message.textBody = message.textBody.replace(/0-000-00-00699-1|00-000-00069-91|9999996991/g, '9999991234');
    await processor(logs, payloads)(message);
    assert.equal(payloads.length, 0); assert.equal(logs[0].decision, 'incoming_destination_not_owner');
  }
});
test('bounded search counts only new UIDs, and zero matches still records a search', async () => {
  const client = new ImapClient({ logger });
  client.searchBySenderSince = async (senders, since, minUid) => {
    assert.ok(senders.includes('mensajeria@santander.cl')); assert.equal(since, null); assert.equal(minUid, 19266);
    return [19265, 19266, 19266, 19267];
  };
  client.fetchMessagesByUid = async uids => uids.map(uid => ({ uid }));
  assert.deepEqual(await client.fetchMessagesSince(19265, 0, 30), [{ uid: 19266 }, { uid: 19267 }]);
  assert.equal(client.searchMatchCount, 2);
  client.searchBySenderSince = async () => [];
  assert.deepEqual(await client.fetchMessagesSince(19265, 0, 30), []); assert.equal(client.searchMatchCount, 0);
});
test('new mail advances existing cursor; empty run reports zero and retains cursor; parser_no_match visible', async () => {
  const logs = [], payloads = [], finishes = [];
  let lastUid = 19265;
  const deps = { acquireAdvisoryLock: async () => true, createProcessingLog: async () => {}, startRun: async () => 'run',
    getCursor: async () => ({ lastUid, uidvalidity: 1 }), updateCursor: async (_, uid) => { lastUid = uid; },
    finishRun: async (_, outcome) => finishes.push({ ...outcome }), releaseAdvisoryLock: async () => {}, closeDatabase: async () => {},
    processEmail: processor(logs, payloads),
  };
  deps.fetchNewEmails = async () => ({ uidvalidity: 1, searchMatchCount: 2, fetchedCount: 2, messages: [await email(cases[0][0], cases[0][1]),
    { ...await email(cases[0][0], cases[0][1]), uid: 19267, textBody: 'Aviso informativo', subject: 'Información' }] });
  assert.equal((await runWorker(deps, { logger })).reason, 'completed'); assert.equal(lastUid, 19267);
  assert.equal(logs.at(-1).decision, 'parser_no_match');
  deps.fetchNewEmails = async () => ({ uidvalidity: 1, searchMatchCount: 0, fetchedCount: 0, messages: [] });
  await runWorker(deps, { logger });
  assert.equal(lastUid, 19267); assert.equal(finishes.at(-1).searchMatchCount, 0); assert.equal(finishes.at(-1).fetchedCount, 0);
});

test('fetched messages after a block or exhausted parse budget leave deferred audit without cursor progress', async () => {
  const logs = [], payloads = [];
  const message = await email('bci_in', 'transferencias@bci.cl');
  const later = { ...message, uid: 19267, messageId: 'later@example.test' };
  const broken = { ...message, authentication: null };
  const cursors = [];
  const deps = { acquireAdvisoryLock: async () => true, createProcessingLog: async () => {},
    getCursor: async () => ({ lastUid: 19265, uidvalidity: 1 }), updateCursor: async (_, uid) => cursors.push(uid),
    releaseAdvisoryLock: async () => {}, closeDatabase: async () => {}, processEmail: processor(logs, payloads),
    fetchNewEmails: async () => ({ uidvalidity: 1, searchMatchCount: 2, fetchedCount: 2, messages: [broken, later] }) };
  assert.equal((await runWorker(deps, { logger })).reason, 'message_blocked');
  assert.deepEqual(logs.map(e => e.decision), ['error', 'processing_deferred']);
  assert.equal(payloads.length, 0); assert.deepEqual(cursors, []);
  let clock = 0;
  const client = new ImapClient({ runtime: { deadlineMs: 1, now: () => 2 } });
  const deferred = await client.parseMessages([{ uid: 19266, raw: Buffer.from('fixture') }], 1);
  logs.length = 0;
  deps.fetchNewEmails = async () => { clock = 2; return { uidvalidity: 1, messages: deferred, searchMatchCount: 1, fetchedCount: 1 }; };
  assert.equal((await runWorker(deps, { logger, now: () => clock, budgetMs: 1 })).reason, 'budget_reached');
  assert.deepEqual(logs.map(e => e.decision), ['processing_deferred']); assert.deepEqual(cursors, []);
});

test('operation date/time comes only from the body even with next-day notification headers', async () => {
  for (const [file, sender] of cases) {
    const logs = [], payloads = [];
    const notice = await email(file, sender);
    notice.date = '2026-10-20T20:51:00Z';
    await processor(logs, payloads)(notice);
    assert.equal(payloads[0].date, '2026-10-19');
    const expected = file === 'bice' ? '16:51' : file === 'bchile' ? '16:50' : null;
    assert.equal(payloads[0].time, expected);
    assert.equal(payloads[0].operationTime, expected);
  }
});

test('only durable unresolved success advances; endpoint and old-app failures retain the cursor', async () => {
  for (const durable of [true, false]) {
    let cursor = 19265;
    const logs = [];
    const processEmail = createEmailProcessor({ logger, logProcessing: async e => logs.push(e),
      isTransaction: async () => true, chooseCategory: async () => null,
      importToWallit: async () => durable ? { success: true, unresolved: true, reason: 'incoming_manual_ambiguous' } : { success: false, error: 'Import failed' } });
    const notice = await email('bci_in', 'transferencias@bci.cl');
    const outcome = await runWorker({ acquireAdvisoryLock: async () => true, createProcessingLog: async () => {},
      getCursor: async () => ({ lastUid: cursor, uidvalidity: 1 }), updateCursor: async (_, uid) => { cursor = uid; },
      fetchNewEmails: async () => ({ uidvalidity: 1, messages: [notice, { ...notice, uid: 19267 }] }), processEmail,
      releaseAdvisoryLock: async () => {}, closeDatabase: async () => {} }, { logger });
    assert.equal(cursor, durable ? 19267 : 19265);
    assert.equal(outcome.reason, durable ? 'completed' : 'message_blocked');
    assert.equal(logs[0].decision, durable ? 'incoming_manual_ambiguous' : 'error');
  }
});
