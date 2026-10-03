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
    assert.deepEqual(values, ['destination-account', 'rai', ' UBER *TRIP ', 'bci', 'history-test']);
    assert.match(query, /a\.space_id = m\.space_id/);
    assert.match(query, /c\.space_id = a\.space_id/);
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

test('a category Space rejection retries uncategorized and advances only after import confirmation', async () => {
  const { createImportClient } = await import('../src/lib/import-client.mjs');
  for (const retrySucceeds of [true, false]) {
    const payloads = [];
    let logged;
    const importToWallit = createImportClient({ fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      payloads.push(payload);
      if (payload.categoryId) return { ok: false, status: 400, json: async () => ({
        success: false, error: 'Category does not belong to account Space',
      }) };
      return { ok: retrySucceeds, status: retrySucceeds ? 200 : 400,
        json: async () => ({ success: retrySucceeds }) };
    } });
    const run = createEmailProcessor({
      findHistoricalCategory: async () => 'category-moved-after-lookup',
      isTransaction: async () => assert.fail('historical winner skips classifier'),
      chooseCategory: async () => assert.fail('historical winner skips classifier'),
      importToWallit, logProcessing: async entry => { logged = entry; }, logger: { log() {}, error() {} },
    });
    let cursor = 100;
    const result = await runWorker({
      acquireAdvisoryLock: async () => true, releaseAdvisoryLock: async () => {},
      createProcessingLog: async () => {}, closeDatabase: async () => {},
      getCursor: async () => ({ lastUid: cursor, uidvalidity: 1 }),
      updateCursor: async (_validity, uid) => { cursor = uid; },
      fetchNewEmails: async () => ({ uidvalidity: 1, messages: [email] }),
      processEmail: run,
    }, { logger: { log() {}, error() {} } });
    assert.equal(result.exitCode, retrySucceeds ? 0 : 1);
    assert.equal(cursor, retrySucceeds ? email.uid : 100);
    if (retrySucceeds) assert.equal(logged.categoryId, null);
    assert.equal(payloads.length, 2);
    assert.equal(payloads[1].categoryId, null);
    assert.deepEqual(payloads[1], { ...payloads[0], categoryId: null });
  }
});

test('uncategorized transport failures never retry the rejected category', async () => {
  const { createImportClient } = await import('../src/lib/import-client.mjs');
  const payloads = [];
  const send = createImportClient({ sleep: async () => {}, logger: { warn() {} },
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      payloads.push(payload);
      if (payload.categoryId) return { ok: false, status: 400, json: async () => ({
        success: false, error: 'Category does not belong to account Space',
      }) };
      throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    },
  });
  await assert.rejects(send({ kind: 'movement', type: 'expense', categoryId: 'foreign',
    sourceEmailId: 'same-identity' }), /Wallit import failed/);
  assert.deepEqual(payloads.map(payload => payload.categoryId), ['foreign', null, null, null]);
  assert.ok(payloads.every(payload => payload.sourceEmailId === 'same-identity'));
});
