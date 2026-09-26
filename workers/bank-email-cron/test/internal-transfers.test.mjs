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

// Synthetic layout regressions: exercise the parser, resolver and processor
// together so a lost field cannot silently re-enable the credit marker.
import { parseCardPayment } from '../src/parsers/card-payment.mjs';
import { resolveAccount, resolveTransferAccount, resolveTransferDestination } from '../src/lib/account-resolver.mjs';

function cardNotice(destination, source = '****0146') {
  return { uid: 47, messageId: 'card-layout-regression', from: 'no-reply@tenpo.cl',
    subject: 'Recibimos con éxito el pago de tu Tarjeta de Crédito',
    textBody: `Monto pagado: $25.000\nFecha: 26/09/2026\nBanco de origen: Tenpo\nCuenta de origen: ${source}${destination === undefined ? '' : `\n${destination}`}` };
}

const unresolvedCardFields = [
  ['Tarjeta de crédito terminada en: 9999', '9999'],
  ['Número de tarjeta: ****9999', '****9999'],
  ['Tarjeta de crédito: 7648 1234 5678 9999', '7648 1234 5678 9999'],
  ['Tarjeta de crédito: 7648-1234-5678-9999', '7648-1234-5678-9999'],
  ['Numero de tarjeta de credito: xxxx9999', 'xxxx9999'],
  ['Tarjeta de crédito pagada: ••••9999', '••••9999'],
  ['Número tarjeta crédito: ****9999', '****9999'],
  ['Tarjeta de crédito:', ''],
  ['Número de tarjeta:   ', ''],
  ['Tarjeta de crédito terminada en:', ''],
  ['Tarjeta de crédito: desconocida', 'desconocida'],
  ['Tarjeta de crédito: 7648-', '7648-'],
  ['Tarjeta de crédito: ****--7648', '****--7648'],
  ['Tarjeta de crédito: ****7648oops', '****7648oops'],
  ['Tarjeta de crédito: 7648-1234-invalid', '7648-1234-invalid'],
  ['Tarjeta de crédito: 7648 / 9999', '7648 / 9999'],
  ['Tarjeta de crédito: ****7648\nNúmero de tarjeta: ****9999', ['****7648', '****9999']],
  ['Número de tarjeta: ****9999\nTarjeta de crédito: ****7648', ['****9999', '****7648']],
  ['Tarjeta de crédito: ****7648\nNúmero de tarjeta:', ['****7648', '']],
  ['Tarjeta de crédito: ****7648\nNúmero de tarjeta: malformed', ['****7648', 'malformed']],
  ['Tarjeta de crédito: ****7648 Número de tarjeta: ****9999', ['****7648', '****9999']],
];
for (const [field, expected] of unresolvedCardFields) {
  test(`explicit unresolved card remains an expense: ${JSON.stringify(field)}`, async () => {
    const email = cardNotice(field);
    const parsed = parseCardPayment(email, 'tenpo', email.textBody);
    assert.deepEqual(parsed.beneficiaryAccount, expected);
    assert.equal(resolveTransferDestination({ ...parsed, accountId: resolveAccount(parsed) }), null);
    const { payload, result } = await process(email);
    assert.equal(payload.kind, 'movement');
    assert.equal(payload.type, 'expense');
    assert.equal(payload.needsReview, false);
    assert.equal(result.advance, true);
  });
}

test('only absent identifiers allow a default credit marker', () => {
  assert.equal(resolveTransferAccount('Tenpo', 'CLP', undefined, 'credit'), config.accounts.tenpoCredit);
  for (const value of ['', null, false, 0, ' ', 'bad', '****9999', [], [''], ['****7648', '']]) {
    assert.equal(resolveTransferAccount('Tenpo', 'CLP', value, 'credit'), null);
  }
});

test('known complete identifiers and absent identifier preserve legitimate transfers', async () => {
  for (const field of [undefined, 'Tarjeta de crédito terminada en: 7648',
    'Número de tarjeta: ****7648', 'Tarjeta de crédito: 9999 1234 5678 7648',
    'Tarjeta de crédito: 9999-1234-5678-7648',
    'Tarjeta de crédito: ****7648\nNúmero de tarjeta: ****7648']) {
    const email = cardNotice(field);
    const parsed = parseCardPayment(email, 'tenpo', email.textBody);
    if (field === undefined) assert.equal(parsed.beneficiaryAccount, undefined);
    assert.equal(resolveTransferDestination({ ...parsed, accountId: resolveAccount(parsed) }), config.accounts.tenpoCredit);
    const { payload, result } = await process(email);
    assert.equal(payload.kind, 'transfer');
    assert.equal(payload.toAccountId, config.accounts.tenpoCredit);
    assert.equal(result.advance, true);
  }
});

test('source captures complete grouped tokens and rejects unresolved or conflicting fields', async () => {
  for (const source of ['9999 1234 5678 0146', '9999-1234-5678-0146',
    '0146 1234 5678 9999', '0146-1234-5678-9999', '', '****0146oops',
    '****0146\nCuenta de cargo: ****9999']) {
    const email = cardNotice('Número de tarjeta: ****7648', source);
    const parsed = parseCardPayment(email, 'tenpo', email.textBody);
    assert.deepEqual(parsed.sourceAccount, source.includes('\n') ? ['****0146', '****9999'] : source);
    const known = source.endsWith('0146');
    if (known) assert.equal(resolveAccount(parsed), config.accounts.tenpoVista);
    else assert.throws(() => resolveAccount(parsed), /unresolved source/);
    const { payload, result } = await process(email);
    assert.equal(result.advance, known);
    if (known) assert.equal(payload.fromAccountId, config.accounts.tenpoVista);
    else assert.equal(payload, undefined);
  }
});

test('body notice prose does not count as an explicit destination field', async () => {
  const email = cardNotice(undefined);
  email.textBody = `${email.subject}\n${email.textBody}`;
  assert.equal((await process(email)).payload.kind, 'transfer');
});

test('conflicting suffixes cannot agree through custom account aliases', () => {
  config.transferAccountMap['tenpo:CLP:9999'] = config.accounts.tenpoCredit;
  try {
    assert.equal(resolveTransferAccount('Tenpo', 'CLP', ['7648', '9999'], 'credit'), null);
    assert.equal(resolveTransferAccount('Tenpo', 'CLP', ['****7648', '9999 1234 5678 7648']), config.accounts.tenpoCredit);
  } finally {
    delete config.transferAccountMap['tenpo:CLP:9999'];
  }
});
