// Every value is synthetic. No real Gmail body/metadata is stored in Git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRawMessage } from '../src/lib/imap.mjs';
import { parseBci } from '../src/parsers/bci.mjs';
import { createEmailProcessor } from '../src/lib/process-email.mjs';
import { config } from '../src/config/index.mjs';
const logger = { log() {}, warn() {}, error() {} };
async function run(from, textBody, subject = '') {
  let payload;
  const email = { uid: 1, uidvalidity: 7, messageId: 'synthetic@example.test', from, textBody, subject,
    date: '2026-01-01T15:00:00-03:00', authentication: { verified: true } };
  const result = await createEmailProcessor({ isTransaction: async () => true, chooseCategory: async () => null,
    importToWallit: async value => { payload = value; return { success: true }; }, logProcessing: async () => {}, logger })(email);
  return { result, payload };
}
test('BCI international purchase allows HTML-generated line breaks without changing USD cents', () => {
  const result = parseBci({ from: 'contacto@bci.cl', textBody: 'Realizaste\nuna compra en comercio\ninternacional con tu tarjeta de crédito.\nMonto USD 33,29\nComercio Example Merchant\nFecha 01/01/2026\nHora 12:00 horas\nNúmero tarjeta crédito ****1164' });
  assert.equal(result.amountUsd, 3329); assert.equal(result.currency, 'USD');
});
test('Tenpo incoming bank transfer routes income to Vista, using origin as counterparty', async () => {
  const { payload } = await run('no-reply@tenpo.cl', 'Comprobante de recibo transferencia\nLa transferencia de Example Person por 1.234 a tu cuenta Tenpo fue exitosa\nMonto transferencia: $1.234\nOrigen transferencia: Example Person\nBanco de origen: Example Bank\nNº cuenta de origen: ****0000\nFecha: 01/01/2026\nHora: 12:00:00');
  assert.equal(payload.type, 'income'); assert.equal(payload.accountId, config.accounts.tenpoVista); assert.equal(payload.amount, 123400);
});
test('Tenpo peer payment Enviado a is outgoing expense, never incoming', async () => {
  const { payload } = await run('no-reply@tenpo.cl', 'Comprobante de pago exitoso\nEl pago por $1.234 a Example Person desde tu cuenta Tenpo fue exitoso\nEnviado a: Example Person\nMonto pagado: $1.234\nFecha: 01/01/2026\nHora: 12:00');
  assert.equal(payload.type, 'expense'); assert.equal(payload.accountId, config.accounts.tenpoVista);
});
test('Tenpo Cuenta Vista card repayment creates transfer; type label and heading are not identifiers', async () => {
  const { payload } = await run('no-reply@tenpo.cl', 'Tarjeta de crédito\nComprobante pago de tarjeta de crédito\nMonto transacción: $1.234\nTipo de tarjeta: Crédito\nMedio de pago: Cuenta Vista Tenpo\nFecha: 01/01/2026\nHora: 12:00:00', 'Recibimos con éxito el pago de tu Tarjeta de Crédito');
  assert.equal(payload.kind, 'transfer'); assert.equal(payload.fromAccountId, config.accounts.tenpoVista); assert.equal(payload.toAccountId, config.accounts.tenpoCredit);
});
test('MercadoPago named BCI card payment routes to BCI and repeated headings do not enter merchant', async () => {
  const { payload } = await run('info@mercadopago.com', 'Le compraste a Example MerchantLe compraste a Example Merchant Tu pago fue aprobado Pagaste $1.234 BCI Crédito **** 1164 1 cuota de $1.234');
  assert.equal(payload.accountId, config.accounts.bciClp); assert.equal(payload.originalName, 'Example Merchant'); assert.equal(payload.amount, 123400);
});
test('MercadoPago external unknown funding cards and contradictory Tenpo receipt do not default to wallet', async () => {
  const unknown = await run('info@mercadopago.com', 'Pagaste $1234.00 con Mastercard terminada en 0000 a Example Merchant.');
  assert.equal(unknown.result.advance, false); assert.equal(unknown.payload, undefined);
  const odd = await run('no-reply@tenpo.cl', 'La transferencia de Example Person a tu cuenta fue exitosa\nMonto transferencia: $1.234\nNombre del destinatario: Example Person\nBanco de destino: Mercado Pago\nNº cuenta de destino: ****0000\nFecha: 01/01/2026\nHora: 12:00');
  assert.equal(odd.result.advance, false); assert.equal(odd.payload, undefined);
});
test('multipart HTML with empty plain body still decodes transfer field labels and does not mark read', async () => {
  const html = await readFile(new URL('./fixtures/mercadopago-transfer.synthetic.html', import.meta.url), 'utf8');
  const raw = ['From: Mercado Pago <info@mercadopago.com>', 'Message-ID: <mixed@example.test>', 'Date: Thu, 1 Jan 2026 15:00:00 -0300',
    'Received: by mx.google.com with ESMTPS id synthetic', 'Authentication-Results: mx.google.com; dmarc=pass header.from=mercadopago.com',
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="synthetic"', '', '--synthetic', 'Content-Type: text/plain; charset=utf-8', '', ' ',
    '--synthetic', 'Content-Type: text/html; charset=utf-8', '', html, '--synthetic--', ''].join('\r\n');
  const email = await parseRawMessage({ uid: 1, raw: Buffer.from(raw) }, 7);
  assert.ok(email.textBody.includes('transferencia')); assert.equal(email.authentication.verified, true);
  let payload;
  const result = await createEmailProcessor({ isTransaction: async () => true, chooseCategory: async () => null,
    importToWallit: async value => { payload = value; return { success: true }; }, logProcessing: async () => {}, logger })(email);
  assert.equal(result.advance, true); assert.equal(payload.accountId, config.accounts.mercadopago); assert.equal(payload.amount, 123400);
});

test('known card suffix alone never proves issuer or product; own repayment ambiguity never becomes consumption', async () => {
  const brandOnly = await run('info@mercadopago.com', 'Pagaste $1234.00 con Mastercard terminada en 1164 a Example Merchant.');
  assert.equal(brandOnly.result.advance, false); assert.equal(brandOnly.payload, undefined);
  for (const card of ['****9999', '****1164oops', '']) {
    const repayment = await run('contacto@bci.cl', `Monto pagado: $1.234\nFecha: 01/01/2026\nCuenta de origen: 8080\nNúmero tarjeta crédito: ${card}`, 'Comprobante pago tarjeta de crédito');
    assert.equal(repayment.result.advance, false); assert.equal(repayment.payload, undefined);
  }
});
test('incomplete successful incoming transfer retains UID rather than silently skipping it', async () => {
  const incoming = await run('no-reply@tenpo.cl', 'Comprobante de recibo transferencia\nLa transferencia de Example Person por $1.234 a tu cuenta Tenpo fue exitosa\nOrigen transferencia: Example Person\nFecha: 01/01/2026\nHora: 12:00', 'Comprobante de transferencia - Tenpo');
  assert.equal(incoming.result.advance, false); assert.equal(incoming.payload, undefined);
});

test('explicit USD decimal dot is cents; international label alone cannot guess currency', () => {
  const base = 'Realizaste una compra en comercio internacional con tu tarjeta de crédito.\nMonto USD 20.00\nComercio Example Merchant\nFecha 01/01/2026\nHora 12:00 horas\nNúmero tarjeta crédito ****1164';
  assert.equal(parseBci({ from: 'contacto@bci.cl', textBody: base }).amountUsd, 2000);
  assert.throws(() => parseBci({ from: 'contacto@bci.cl', textBody: base.replace('USD 20.00', '$20.000') }), /parser_ambiguous_currency/);
});
