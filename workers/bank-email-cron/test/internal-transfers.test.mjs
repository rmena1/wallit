import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmailProcessor } from '../src/lib/process-email.mjs';
import { config } from '../src/config/index.mjs';

function outgoing(recipient = 'Raimundo Mena', account = '****1164') {
  return { uid: 42, messageId: 'synthetic-transfer', from: 'no-reply@tenpo.cl', textBody: `Has realizado una transferencia
Monto transferencia: $10.000
Nombre del destinatario: ${recipient}
Banco de destino: BCI
Nº cuenta de destino: ${account}
Fecha: 26/09/2026
Hora: 12:00` };
}
async function process(email, overrides = {}) {
  let payload;
  const run = createEmailProcessor({
    isTransaction: async () => true, chooseCategory: async () => null,
    logProcessing: async () => {},
    importToWallit: async (value) => { payload = value; return { success: true }; },
    ...overrides,
  });
  return { result: await run(email), payload };
}
test('confident Raimundo destination imports two legs and advances', async () => {
  const { result, payload } = await process(outgoing());
  assert.equal(payload.kind, 'transfer');
  assert.equal(payload.fromAccountId, config.accounts.tenpoVista);
  assert.equal(payload.toAccountId, config.accounts.bciClp);
  assert.equal(result.advance, true);
});
test('ambiguous candidate imports expense without review and advances, including duplicate', async () => {
  for (const account of ['****9999', 'unknown', '']) {
    const { result, payload } = await process(outgoing('Raimundo Mena', account));
    assert.equal(payload.kind, 'movement');
    assert.equal(payload.type, 'expense');
    assert.equal(payload.needsReview, false);
    assert.equal(payload.categoryId, null);
    assert.equal(result.advance, true);
  }
  const { result } = await process(outgoing(), { importToWallit: async () => ({ success: true, duplicate: true }) });
  assert.equal(result.advance, true);
});
test('external P2P and similarly named recipients remain one-leg expenses', async () => {
  for (const name of ['Ana Perez', 'Raimundo Menard']) {
    const { payload } = await process(outgoing(name));
    assert.equal(payload.kind, 'movement');
    assert.equal(payload.type, 'expense');
    assert.notEqual(payload.needsReview, false);
  }
});
test('real API and classifier failures never advance candidate UID', async () => {
  for (const overrides of [
    { importToWallit: async () => { throw new Error('API unavailable'); } },
    { importToWallit: async () => ({ success: false }) },
    { isTransaction: async () => { throw new Error('Classifier unavailable'); } },
  ]) assert.equal((await process(outgoing('Raimundo Mena', '9999'), overrides)).result.advance, false);
});
test('BCI and Tenpo own card payment notices resolve labeled source and destination', async () => {
  for (const provider of ['bci', 'tenpo']) {
    const email = { uid: 43, messageId: `card-${provider}`, from: provider === 'bci' ? 'contacto@bci.cl' : 'no-reply@tenpo.cl',
      subject: provider === 'bci' ? 'Comprobante pago tarjeta de crédito' : 'Recibimos con éxito el pago de tu Tarjeta de Crédito',
      textBody: `Monto pagado: $25.000\nFecha: 26/09/2026\nBanco de origen: Tenpo\nCuenta de origen: ****0146\nNúmero tarjeta crédito: ****${provider === 'bci' ? '1164' : '7648'}` };
    const { payload, result } = await process(email);
    assert.equal(payload.kind, 'transfer');
    assert.equal(payload.toAccountId, provider === 'bci' ? config.accounts.bciClp : config.accounts.tenpoCredit);
    assert.equal(result.advance, true);
    email.textBody = email.textBody.replace(/\*{4}(1164|7648)/, '****9999');
    assert.equal((await process(email)).payload.needsReview, false);
    email.textBody = email.textBody.replace('Cuenta de origen: ****0146', '');
    assert.equal((await process(email)).result.advance, false);
  }
});
test('Mercado Pago destination account and explicit env mapping', async () => {
  config.transferAccountMap['bci:CLP:9015'] = 'casa-bci';
  const { payload } = await process({ uid: 44, messageId: 'mp-transfer', from: 'info@mercadopago.com', date: '2026-09-26T15:00:00Z', textBody: 'Ya enviamos tu transferencia de $10.000 Nombre y apellido: Raimundo Mena Entidad: BCI Número de cuenta: ****9015' });
  assert.equal(payload.kind, 'transfer');
  assert.equal(payload.toAccountId, 'casa-bci');
  delete config.transferAccountMap['bci:CLP:9015'];
});

test('incoming Raimundo payment is not an outgoing internal transfer', async () => {
  const { payload } = await process({ uid: 45, messageId: 'incoming', from: 'no-reply@tenpo.cl',
    textBody: 'Enviado por: Raimundo Mena\nMonto pagado: $10.000\nFecha: 26/09/2026\nHora: 12:00' });
  assert.equal(payload.kind, 'movement');
  assert.equal(payload.type, 'income');
});
test('destination equal to source cannot manufacture a transfer', async () => {
  const email = outgoing();
  email.textBody = email.textBody.replace('BCI', 'Tenpo').replace('1164', '0146');
  const { payload, result } = await process(email);
  assert.equal(payload.kind, 'movement');
  assert.equal(payload.needsReview, false);
  assert.equal(result.advance, true);
});

test('explicit own Tenpo card marker resolves, but BCI without card marker mapping stays ambiguous', async () => {
  for (const provider of ['tenpo', 'bci']) {
    const { payload } = await process({ uid: 46, messageId: `marker-${provider}`,
      from: provider === 'tenpo' ? 'no-reply@tenpo.cl' : 'contacto@bci.cl',
      subject: 'Comprobante pago tarjeta de crédito',
      textBody: 'Monto: $10.000\nFecha: 26/09/2026\nBanco de origen: Tenpo\nCuenta de origen: ****0146' });
    assert.equal(payload.kind, provider === 'tenpo' ? 'transfer' : 'movement');
    if (provider === 'bci') assert.equal(payload.needsReview, false);
  }
});
