import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCategoryHistoryLookup } from '../src/lib/category-history.mjs';
import { runWorker } from '../src/lib/worker-runner.mjs';
import { config } from '../src/config/index.mjs';
import { createEmailProcessor } from '../src/lib/process-email.mjs';

const email = {
  uid: 101, messageId: '<history-test>', from: 'contacto@bci.cl',
  authentication: { verified: true },
  textBody: 'Realizaste una compra con tu tarjeta de crédito.\nMonto: $20.980\nComercio: UBER *TRIP\nFecha: 15/09/2026\nHora: 14:30 horas\nNúmero tarjeta crédito: ****1164',
};

test('history uses parameterized exact original name, owner and excludes the current email', async () => {
  const lookup = createCategoryHistoryLookup({ userId: 'rai', sql: async (strings, ...values) => {
    const query = strings.join('?');
    assert.deepEqual(values, ['rai', ' UBER *TRIP ', 'bci', 'history-test']);
    assert.doesNotMatch(query, /space_id|JOIN accounts/);
    assert.match(query, /created_by_user_id = \?/);
    assert.match(query, /original_name = \?/);
    assert.match(query, /category_id IS NOT NULL/);
    assert.match(query, /NOT \(m\.source_email_provider IS NOT DISTINCT FROM \?\s+AND m\.source_email_id IS NOT DISTINCT FROM \?\)/);
    assert.match(query, /GROUP BY m\.category_id\s+ORDER BY COUNT\(\*\) DESC, m\.category_id\s+LIMIT 1/);
    return [{ category_id: 'winner' }];
  } });
  assert.equal(await lookup({ originalName: ' UBER *TRIP ', provider: 'bci', sourceEmailId: 'history-test', accountId: 'destination-account' }), 'winner');
});

test('no categorized history returns null', async () => {
  const lookup = createCategoryHistoryLookup({ userId: 'rai', sql: async () => [] });
  assert.equal(await lookup({ originalName: 'NEW', provider: 'bci', sourceEmailId: 'new', accountId: 'destination-account' }), null);
});

test('historical winner reaches import without either classifier or static category filtering', async () => {
  let payload;
  const run = createEmailProcessor({
    findHistoricalCategory: async input => {
      assert.deepEqual(input, { originalName: 'UBER *TRIP', provider: 'bci', sourceEmailId: 'history-test', accountId: config.accounts.bciClp });
      return 'category-created-after-static-mappings';
    },
    isTransaction: async () => assert.fail('history must bypass transaction classifier'),
    chooseCategory: async () => assert.fail('history must bypass category classifier'),
    importToWallit: async value => { payload = value; return { success: true }; },
    logProcessing: async () => {}, logger: { log() {}, error() {} },
  });
  assert.equal((await run(email)).success, true);
  assert.equal(payload.categoryId, 'category-created-after-static-mappings');
});

test('missing historical category retains both existing classifier steps', async () => {
  const calls = [];
  const run = createEmailProcessor({
    findHistoricalCategory: async () => { calls.push('history'); return null; },
    isTransaction: async () => { calls.push('transaction'); return true; },
    chooseCategory: async () => { calls.push('category'); return null; },
    importToWallit: async () => { calls.push('import'); return { success: true }; },
    logProcessing: async () => {}, logger: { log() {}, error() {} },
  });
  const result = await run(email);
  assert.equal(result.success, true);
  assert.equal(result.advance, true);
  assert.deepEqual(calls, ['history', 'transaction', 'category', 'import']);
});

test('a winner from another Space is preserved and the cron advances', async () => {
  const { createImportClient } = await import('../src/lib/import-client.mjs');
  const payloads = [];
  const importToWallit = createImportClient({ fetchImpl: async (_url, options) => {
    const payload = JSON.parse(options.body);
    payloads.push(payload);
    assert.equal(payload.categoryId, 'other-space-category');
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  } });
  const processEmail = createEmailProcessor({
    findHistoricalCategory: async () => 'other-space-category',
    isTransaction: async () => assert.fail('history skips classifier'),
    chooseCategory: async () => assert.fail('history skips classifier'),
    importToWallit, logProcessing: async () => {}, logger: { log() {}, error() {} },
  });
  let cursor = 100;
  const result = await runWorker({
    acquireAdvisoryLock: async () => true, releaseAdvisoryLock: async () => {},
    createProcessingLog: async () => {}, closeDatabase: async () => {},
    getCursor: async () => ({ lastUid: cursor, uidvalidity: 1 }),
    updateCursor: async (_validity, uid) => { cursor = uid; },
    fetchNewEmails: async () => ({ uidvalidity: 1, messages: [email] }),
    processEmail,
  }, { logger: { log() {}, error() {} } });
  assert.equal(result.exitCode, 0);
  assert.equal(cursor, email.uid);
  assert.equal(payloads.length, 1);
});

test('transport retries preserve the winning category', async () => {
  const { createImportClient } = await import('../src/lib/import-client.mjs');
  const payloads = [];
  const send = createImportClient({ sleep: async () => {}, logger: { warn() {} },
    fetchImpl: async (_url, options) => {
      payloads.push(JSON.parse(options.body));
      throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    },
  });
  await assert.rejects(send({ kind: 'movement', type: 'expense', categoryId: 'foreign',
    sourceEmailId: 'same-identity' }), /Wallit import failed/);
  assert.deepEqual(payloads.map(payload => payload.categoryId), ['foreign', 'foreign', 'foreign']);
});
