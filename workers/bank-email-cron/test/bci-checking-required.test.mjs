import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { config } from '../src/config/index.mjs';
import { resolveTransferAccount } from '../src/lib/account-resolver.mjs';
import { createEmailProcessor } from '../src/lib/process-email.mjs';

for (const value of [undefined, '']) {
  test(`config import fails when BCI checking ID is ${value === undefined ? 'unset' : 'empty'}`, () => {
    const env = { ...process.env };
    delete env.ACCOUNT_BCI_CHECKING_ID;
    if (value !== undefined) env.ACCOUNT_BCI_CHECKING_ID = value;
    const configUrl = new URL('../src/config/index.mjs', import.meta.url).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(configUrl)})`], {
      env, encoding: 'utf8',
    });
    assert.ifError(child.error);
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Missing required environment variable: ACCOUNT_BCI_CHECKING_ID/);
    assert.equal(process.env.ACCOUNT_BCI_CHECKING_ID, config.accounts.bciChecking);
  });
}

test('BCI checking map override takes precedence over required default', () => {
  const previous = config.transferAccountMap;
  try {
    config.transferAccountMap = { ...previous, 'bci:CLP:8080': 'test-checking-override' };
    assert.equal(resolveTransferAccount('BCI', 'CLP', '32608080'), 'test-checking-override');
  } finally {
    config.transferAccountMap = previous;
  }
});

test('unresolved own-card source logs bank, currency and only account last4', async (t) => {
  let logged;
  const stderr = t.mock.method(console, 'error', () => {});
  const run = createEmailProcessor({
    isTransaction: async () => true,
    logProcessing: async entry => { logged = entry; },
    importToWallit: async () => assert.fail('unresolved source must not import'),
  });
  const result = await run({
    authentication: { verified: true }, uid: 49, messageId: 'unknown-bci-source', from: 'contacto@bci.cl',
    subject: 'Comprobante pago tarjeta de crédito',
    textBody: 'Monto pagado: $280.000\nFecha: 26/09/26\nCuenta de origen: 32609999\nNúmero tarjeta crédito: ****1164',
  });
  const expected = 'Credit card payment: unresolved source account (bank=bci currency=CLP last4=9999)';
  assert.equal(result.advance, false);
  assert.equal(result.error, expected);
  assert.equal(logged.decision, 'account_unresolved');
  assert.equal(logged.errorMessage, expected);
  assert.ok(stderr.mock.calls.some(({ arguments: args }) => args.some(value => String(value).includes('account_unresolved'))));
  assert.ok(stderr.mock.calls.every(({ arguments: args }) => args.every(value => !String(value).includes('32609999'))));
});
