import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateRate, run } from '../src/worker.mjs';

// No driver is imported. Every transport is a fake; accidental fetches fail.
globalThis.fetch = () => { throw new Error('Network forbidden in tests'); };

test('calculates CLP per USD times 100 with rounding', () => {
  assert.equal(calculateRate({ rates: { CLP: 946.50 } }), 94650);
  assert.equal(calculateRate({ rates: { CLP: 946.567 } }), 94657);
  assert.equal(calculateRate({ rates: { CLP: 0.001 } }), 0);
});

test('rejects missing, nonnumeric, nonpositive and nonfinite rates', () => {
  for (const body of [null, {}, { rates: null }, ...[undefined, null, '950', 0, -1, true, NaN, Infinity].map(CLP => ({ rates: { CLP } }))]) {
    assert.throws(() => calculateRate(body), /Invalid rates.CLP/);
  }
});

function fixture({ ok = true, body = { rates: { CLP: 946.567 } }, failQuery = false } = {}) {
  const calls = [];
  let closed = false;
  const sql = async (strings, ...values) => {
    calls.push({ query: strings.join('?').replace(/\s+/g, ' ').trim(), values });
    if (failQuery) throw new Error('Database failure');
  };
  sql.end = async () => { closed = true; };
  return {
    calls,
    get closed() { return closed; },
    options: {
      databaseUrl: 'postgres://fake.invalid/test',
      postgres: () => sql,
      now: () => 120001,
      fetchRate: async (url, options) => {
        assert.equal(url, 'https://open.er-api.com/v6/latest/USD');
        assert.equal(options.method, 'GET');
        assert.ok(options.signal instanceof AbortSignal);
        return { ok, json: async () => body };
      },
    },
  };
}

test('upserts the minute ID and rate and closes the database', async () => {
  const f = fixture();
  assert.equal(await run(f.options), 94657);
  assert.deepEqual(f.calls, [{
    query: "INSERT INTO exchange_rates (id, from_currency, to_currency, rate, source, fetched_at) VALUES (?, 'USD', 'CLP', ?, 'open.er-api.com', NOW()) ON CONFLICT (id) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at",
    values: ['USD_CLP_2', 94657],
  }]);
  assert.equal(f.closed, true);
});

test('missing environment, bad HTTP and bad rates fail before database access', async () => {
  for (const variant of [{ ok: false }, { body: { rates: { CLP: '950' } } }, {}]) {
    const f = fixture(variant);
    f.options.postgres = () => assert.fail('Unexpected database access');
    if (!Object.keys(variant).length) {
      f.options.databaseUrl = '';
      f.options.fetchRate = () => assert.fail('Unexpected fetch');
    }
    await assert.rejects(run(f.options));
  }
});

test('database failure propagates after cleanup', async () => {
  const f = fixture({ failQuery: true });
  await assert.rejects(run(f.options), /Database failure/);
  assert.equal(f.closed, true);
});

test('fetch timeout propagates without database access', async () => {
  const f = fixture();
  f.options.fetchRate = async () => { throw new DOMException('Timed out', 'TimeoutError'); };
  f.options.postgres = () => assert.fail('Unexpected database access');
  await assert.rejects(run(f.options), { name: 'TimeoutError' });
});
