import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseBci } from '../src/parsers/bci.mjs';
import { parseTenpo } from '../src/parsers/tenpo.mjs';
import { parseMercadoPago } from '../src/parsers/mercadopago.mjs';
import { resolveAccount, getProviderFromEmail } from '../src/lib/account-resolver.mjs';
import { buildImportPayload } from '../src/lib/import-client.mjs';

describe('BCI Parser', () => {
  test('parses CLP purchase with colon layout', () => {
    const email = {
      _source_email_provider: 'bci',
      from: 'contacto@bci.cl',
      textBody: `Realizaste una compra con tu tarjeta de crédito.

Monto: $20.980
Comercio: UBER *TRIP
Fecha: 15/09/2026
Hora: 14:30 horas
Número tarjeta crédito: ****1164`,
    };

    const result = parseBci(email);
    assert.ok(result, 'Parser should recognize BCI purchase');
    assert.strictEqual(result.provider, 'bci');
    assert.strictEqual(result.currency, 'CLP');
    assert.strictEqual(result.amount, 2098000);
    assert.strictEqual(result.originalName, 'UBER *TRIP');
    assert.strictEqual(result.date, '2026-09-15');
    assert.strictEqual(result.time, '14:30');
    assert.strictEqual(result.last4, '1164');
  });

  test('parses USD purchase with international flag', () => {
    const email = {
      _source_email_provider: 'bci',
      from: 'contacto@bci.cl',
      textBody: `Realizaste una compra en comercio internacional con tu tarjeta de crédito.

Monto USD 33,29
Comercio OPENAI *CHATGPT
Fecha 20/09/2026
Hora 10:15 horas
Número tarjeta crédito ****1164`,
    };

    const result = parseBci(email);
    assert.ok(result);
    assert.strictEqual(result.currency, 'USD');
    assert.strictEqual(result.amountUsd, 3329);
    assert.strictEqual(result.originalName, 'OPENAI *CHATGPT');
  });

  test('returns null for non-BCI email', () => {
    const email = {
      from: 'other@example.com',
      textBody: 'Some random email',
    };
    assert.strictEqual(parseBci(email), null);
  });
});

describe('Tenpo Parser', () => {
  test('parses purchase', () => {
    const email = {
      _source_email_provider: 'tenpo',
      from: 'no-reply@tenpo.cl',
      textBody: `¡Compra exitosa!

Monto transacción: $5.990
Comercio: WHOOSH
Fecha: 18/09/2026
Hora: 16:45
Código: ABC123`,
    };

    const result = parseTenpo(email);
    assert.ok(result);
    assert.strictEqual(result.provider, 'tenpo');
    assert.strictEqual(result.type, 'expense');
    assert.strictEqual(result.amount, 599000);
    assert.strictEqual(result.originalName, 'WHOOSH');
  });

  test('parses outgoing transfer', () => {
    const email = {
      _source_email_provider: 'tenpo',
      from: 'no-reply@tenpo.cl',
      textBody: `Has realizado una transferencia

Monto transferencia: $50.000
Nombre del destinatario: Juan Pérez
Banco de destino: Banco Estado
Nº cuenta de destino: 1234567890
Fecha: 19/09/2026
Hora: 09:30`,
    };

    const result = parseTenpo(email);
    assert.ok(result);
    assert.strictEqual(result.type, 'expense');
    assert.strictEqual(result.amount, 5000000);
    assert.strictEqual(result.beneficiary, 'Juan Pérez');
    assert.strictEqual(result.entity, 'Banco Estado');
  });

  test('parses incoming payment', () => {
    const email = {
      _source_email_provider: 'tenpo',
      from: 'no-reply@tenpo.cl',
      textBody: `¡Pago recibido!

Monto pagado: $10.000
Enviado por: María González
Fecha: 20/09/2026
Hora: 11:00`,
    };

    const result = parseTenpo(email);
    assert.ok(result);
    assert.strictEqual(result.type, 'income');
    assert.strictEqual(result.amount, 1000000);
    assert.strictEqual(result.beneficiary, 'María González');
  });
});

describe('Mercado Pago Parser', () => {
  test('parses outgoing transfer', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      date: '25 de septiembre de 2026 a las 14:30',
      textBody: `Ya enviamos tu transferencia de $100.000

Nombre y apellido: Pedro Silva
Entidad: Banco de Chile
Número de cuenta: 9876543210`,
    };

    const result = parseMercadoPago(email);
    assert.ok(result);
    assert.strictEqual(result.provider, 'mercadopago');
    assert.strictEqual(result.amount, 10000000);
    assert.strictEqual(result.beneficiary, 'Pedro Silva');
    assert.strictEqual(result.entity, 'Banco de Chile');
  });

  test('parses subscription prose', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      date: '2026-09-25T10:00:00',
      textBody: `Pagaste $990.00 con Mastercard terminada en 1164 a SaveMoney.`,
    };

    const result = parseMercadoPago(email);
    assert.ok(result);
    assert.strictEqual(result.amount, 99000);
    assert.strictEqual(result.name, 'SaveMoney');
    assert.strictEqual(result.last4, '1164');
  });
});

describe('Account Resolver', () => {
  test('resolves BCI CLP account', () => {
    const parsed = {
      provider: 'bci',
      currency: 'CLP',
      last4: '1164',
    };
    const accountId = resolveAccount(parsed);
    assert.ok(accountId);
  });

  test('resolves BCI USD account', () => {
    const parsed = {
      provider: 'bci',
      currency: 'USD',
      last4: '1164',
    };
    const accountId = resolveAccount(parsed);
    assert.ok(accountId);
  });

  test('resolves Tenpo credit card', () => {
    const parsed = {
      provider: 'tenpo',
      currency: 'CLP',
      cardHint: 'crédito',
    };
    const accountId = resolveAccount(parsed);
    assert.ok(accountId);
  });

  test('resolves Tenpo Vista for transfer', () => {
    const parsed = {
      provider: 'tenpo',
      currency: 'CLP',
      type: 'expense',
      beneficiary: 'Juan Pérez',
      entity: 'Banco Estado',
    };
    const accountId = resolveAccount(parsed);
    assert.ok(accountId);
  });

  test('resolves Mercado Pago account', () => {
    const parsed = {
      provider: 'mercadopago',
      currency: 'CLP',
    };
    const accountId = resolveAccount(parsed);
    assert.ok(accountId);
  });

  test('throws for unresolved BCI card', () => {
    const parsed = {
      provider: 'bci',
      currency: 'CLP',
      last4: '9999',
    };
    assert.throws(() => resolveAccount(parsed), /unresolved account/);
  });
});

describe('Provider Detection', () => {
  test('detects BCI from email', () => {
    assert.strictEqual(getProviderFromEmail('contacto@bci.cl'), 'bci');
    assert.strictEqual(getProviderFromEmail('Contacto <contacto@bci.cl>'), 'bci');
  });

  test('detects Tenpo from email', () => {
    assert.strictEqual(getProviderFromEmail('no-reply@tenpo.cl'), 'tenpo');
  });

  test('detects Mercado Pago from email', () => {
    assert.strictEqual(getProviderFromEmail('info@mercadopago.com'), 'mercadopago');
  });

  test('returns null for unknown sender', () => {
    assert.strictEqual(getProviderFromEmail('unknown@example.com'), null);
  });
});

describe('Import Payload Builder', () => {
  test('builds CLP movement payload', () => {
    const parsed = {
      provider: 'bci',
      accountId: 'test-account-id',
      name: 'UBER *TRIP',
      originalName: 'UBER *TRIP',
      date: '2026-09-15',
      time: '14:30',
      type: 'expense',
      currency: 'CLP',
      amount: 2098000,
    };

    const payload = buildImportPayload(parsed, 'test-category-id', 'msg-123@gmail.com');
    
    assert.strictEqual(payload.kind, 'movement');
    assert.strictEqual(payload.accountId, 'test-account-id');
    assert.strictEqual(payload.categoryId, 'test-category-id');
    assert.strictEqual(payload.name, 'UBER *TRIP');
    assert.strictEqual(payload.currency, 'CLP');
    assert.strictEqual(payload.amount, 2098000);
    assert.strictEqual(payload.sourceEmailProvider, 'bci');
    assert.strictEqual(payload.sourceEmailId, 'msg-123@gmail.com');
    assert.strictEqual(payload.amountUsd, undefined);
  });

  test('builds USD movement payload with exchange rate', () => {
    const parsed = {
      provider: 'bci',
      accountId: 'test-usd-account-id',
      name: 'OPENAI *CHATGPT',
      originalName: 'OPENAI *CHATGPT',
      date: '2026-09-20',
      time: '10:15',
      type: 'expense',
      currency: 'USD',
      amountUsd: 3329,
    };

    const payload = buildImportPayload(parsed, null, 'msg-456@gmail.com');
    
    assert.strictEqual(payload.currency, 'USD');
    assert.strictEqual(payload.amountUsd, 3329);
    assert.ok(payload.exchangeRate > 0);
    assert.strictEqual(payload.amount, undefined);
  });

  test('sets categoryId to null when not provided', () => {
    const parsed = {
      provider: 'tenpo',
      accountId: 'test-account',
      name: 'Test',
      originalName: 'Test',
      date: '2026-09-25',
      type: 'expense',
      currency: 'CLP',
      amount: 100000,
    };

    const payload = buildImportPayload(parsed, null, 'msg-789@gmail.com');
    assert.strictEqual(payload.categoryId, null);
  });
});

describe('Money Conversion', () => {
  test('CLP major units to centavos', () => {
    const email = {
      _source_email_provider: 'bci',
      from: 'contacto@bci.cl',
      textBody: `Realizaste una compra con tu tarjeta de crédito.

Monto: $1.234.567
Comercio: TEST
Fecha: 01/01/2026
Hora: 12:00 horas
Número tarjeta crédito: ****1164`,
    };

    const result = parseBci(email);
    assert.strictEqual(result.amount, 123456700);
  });

  test('USD decimal to cents', () => {
    const email = {
      _source_email_provider: 'bci',
      from: 'contacto@bci.cl',
      textBody: `Realizaste una compra en comercio internacional con tu tarjeta de crédito.

Monto USD 99,99
Comercio TEST USD
Fecha 01/01/2026
Hora 12:00 horas
Número tarjeta crédito ****1164`,
    };

    const result = parseBci(email);
    assert.strictEqual(result.amountUsd, 9999);
  });
});
