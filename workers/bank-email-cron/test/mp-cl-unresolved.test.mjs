import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRawMessage } from '../src/lib/imap.mjs';
import { createEmailProcessor } from '../src/lib/process-email.mjs';
import { runWorker } from '../src/lib/worker-runner.mjs';
import { verifyGmailAuthentication } from '../src/lib/sender-auth.mjs';
import { config } from '../src/config/index.mjs';
// This file runs in its own Node test process; production owner defaults are unchanged.
config.ownerNames = ['Titular Prueba'];
const logger = { log() {}, error() {} };
async function fixture(file, from, subject, date = '2026-10-19T14:28:21Z', transform = x => x) {
  const html = transform(await readFile(new URL(`./fixtures/${file}.anonymized.html`, import.meta.url), 'utf8'));
  return parseRawMessage({ uid: 2, raw: Buffer.from([
    `From: ${from}`, `Subject: ${subject}`, 'Message-ID: <fixture@example.test>', `Date: ${new Date(date).toUTCString()}`,
    'Received: by mx.google.com with ESMTPS id fixture',
    `Authentication-Results: mx.google.com; dmarc=pass header.from=${from.split('@')[1]}`,
    'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', html,
  ].join('\r\n')) }, 7);
}
function processor(logs, payloads) {
  return createEmailProcessor({ logger, isTransaction: async () => true, chooseCategory: async () => null,
    logProcessing: async e => logs.push(e), importToWallit: async p => { payloads.push(p); return { success: true }; } });
}
for (const [day, amount, date] of [['19', 36000000, '2026-10-19T14:28:21Z'], ['17', 50000000, '2026-10-17T21:31:07Z']]) {
  test(`MP .cl anonymized ${day}: own transfer with mapped accounts and evidence`, async () => {
    const email = await fixture(`mp-cl-${day}`, 'info@mercadopago.cl', '¡Enviamos tu transferencia!', date);
    assert.equal(email.authentication.verified, true);
    const logs = [], payloads = [];
    const result = await processor(logs, payloads)(email, { runId: 'fixture-run' });
    assert.equal(result.advance, true);
    assert.equal(payloads[0].kind, 'own-bank-transfer');
    assert.equal(payloads[0].amount, amount);
    assert.equal(payloads[0].from.accountId, config.accounts.mercadopago);
    assert.equal(payloads[0].to.accountId, config.accounts.bciChecking);
    assert.equal(payloads[0].to.number, '99998080');
    assert.equal(logs[0].messageId.length, 64);
    email.authentication = { verified: false, reason: 'authentication_failed' };
    await processor(logs, payloads)(email);
    assert.equal(payloads.length, 1);
    assert.equal(logs.at(-1).decision, 'authentication_failed');
  });
}
test('BCI 9015 anonymized fixture routes CLP and USD to Casa', async () => {
  for (const usd of [false, true]) {
    const email = await fixture('bci-lider', 'contacto@bci.cl', 'Notificación de uso de tu tarjeta de crédito', undefined,
      html => usd ? html.replace('$42.390', 'USD 42,39') : html);
    const logs = [], payloads = [];
    assert.equal((await processor(logs, payloads)(email)).advance, true);
    assert.equal(payloads[0].accountId, usd ? 'ufnvw57od9onrnnswx463' : 'h2xgdiuw0tra0ern89y1f');
    assert.equal(payloads[0].currency, usd ? 'USD' : 'CLP');
    assert.equal(usd ? payloads[0].amountUsd : payloads[0].amount, usd ? 4239 : 4239000);
  }
});
test('unmapped BCI is durably unresolved with alert and queue/cursor continue; log failure blocks', async () => {
  const unknown = await fixture('bci-lider', 'contacto@bci.cl', 'Notificación de uso de tu tarjeta de crédito', undefined, s => s.replaceAll('9015', '0000'));
  const known = { ...await fixture('mp-cl-19', 'info@mercadopago.cl', '¡Enviamos tu transferencia!'), uid: 3 };
  const logs = [], payloads = [], cursors = [], finishes = [];
  const result = await runWorker({ acquireAdvisoryLock: async () => true, createProcessingLog: async () => {},
    startRun: async () => 'run', finishRun: async (...args) => finishes.push(args),
    getCursor: async () => ({ lastUid: 1, uidvalidity: 7 }), fetchNewEmails: async () => ({ uidvalidity: 7, messages: [unknown, known] }),
    processEmail: processor(logs, payloads), updateCursor: async (_, uid) => cursors.push(uid),
    releaseAdvisoryLock: async () => {}, closeDatabase: async () => {},
  }, { logger });
  assert.equal(result.reason, 'completed'); assert.deepEqual(cursors, [2, 3]);
  assert.equal(logs[0].decision, 'account_unresolved'); assert.equal(payloads.length, 1);
  assert.equal(finishes[0][1].lastSuccessfulUid, 3);
  const broken = createEmailProcessor({ logger, logProcessing: async () => { throw new Error('fixture failure'); } });
  await assert.rejects(broken(unknown));
});

test('MP .cl requires aligned Gmail DMARC, never the .com verdict or a forged later header', () => {
  const received = { key: 'received', line: 'Received: by mx.google.com' };
  const auth = domain => ({ key: 'authentication-results', line: `Authentication-Results: mx.google.com; dmarc=pass header.from=${domain}` });
  assert.equal(verifyGmailAuthentication([received, auth('mercadopago.cl')], 'info@mercadopago.cl').verified, true);
  assert.equal(verifyGmailAuthentication([received, auth('mercadopago.com')], 'info@mercadopago.cl').verified, false);
  assert.equal(verifyGmailAuthentication([received, auth('attacker.test'), auth('mercadopago.cl')], 'info@mercadopago.cl').verified, false);
});

test('MP last-four collision with a different beneficiary never becomes an own transfer', async () => {
  for (const subject of ['¡Enviamos tu transferencia!', 'Tu transferencia fue enviada']) {
    const email = await fixture('mp-cl-19', 'info@mercadopago.cl', subject, undefined,
      html => html.replace(/titular prueba/gi, 'PERSONA DISTINTA'));
    assert.match(email.textBody, /PERSONA DISTINTA/);
    const logs = [], payloads = [];
    assert.equal((await processor(logs, payloads)(email)).advance, true);
    assert.equal(payloads[0].kind, 'movement');
    assert.equal(payloads[0].type, 'expense');
    assert.equal(payloads[0].accountId, config.accounts.mercadopago);
    assert.equal(payloads[0].toAccountId, undefined);
    assert.equal(payloads[0].ownBankTransfer, undefined);
  }
});

test('unmapped BCI repayment destination is unresolved before AI and the next email imports', async () => {
  const unknown = { uid: 2, uidvalidity: 7, messageId: 'repayment@example.test', from: 'contacto@bci.cl',
    authentication: { verified: true }, subject: 'Comprobante pago tarjeta de crédito',
    textBody: 'Monto pagado: $25.000\nFecha: 26/09/2026\nCuenta de origen: 8080\nNúmero tarjeta crédito: ****0000' };
  const known = { ...await fixture('mp-cl-19', 'info@mercadopago.cl', '¡Enviamos tu transferencia!'), uid: 3 };
  const logs = [], payloads = [], cursors = [], alerts = [];
  const processEmail = createEmailProcessor({ logger: { log() {}, error: text => alerts.push(text) },
    isTransaction: async () => assert.fail('neither unresolved repayment nor own transfer needs AI'),
    logProcessing: async entry => logs.push(entry),
    importToWallit: async payload => { payloads.push(payload); return { success: true }; } });
  const result = await runWorker({ acquireAdvisoryLock: async () => true, createProcessingLog: async () => {},
    getCursor: async () => ({ lastUid: 1, uidvalidity: 7 }), fetchNewEmails: async () => ({ uidvalidity: 7, messages: [unknown, known] }),
    processEmail, updateCursor: async (_, uid) => cursors.push(uid), releaseAdvisoryLock: async () => {}, closeDatabase: async () => {},
  }, { logger });
  assert.equal(result.exitCode, 0); assert.deepEqual(cursors, [2, 3]);
  assert.equal(logs[0].decision, 'account_unresolved'); assert.match(alerts[0], /ALERT bci_account_unresolved/);
  assert.equal(payloads.length, 1); assert.equal(payloads[0].kind, 'own-bank-transfer');
});
