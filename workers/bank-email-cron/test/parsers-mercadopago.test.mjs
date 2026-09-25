import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseMercadoPago } from '../src/parsers/mercadopago.mjs';

describe('Mercado Pago parser - Date handling', () => {
  test('handles Date object from mailparser', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      subject: 'Tu transferencia fue enviada',
      date: new Date('2026-08-26T15:24:17Z'),
      textBody: `Ya enviamos tu transferencia de $ 50.000

Nombre y apellido: Juan Pérez
Entidad: Banco Estado
Número de cuenta: 12345678`,
    };

    const result = parseMercadoPago(email);
    assert.ok(result);
    assert.strictEqual(result.provider, 'mercadopago');
    assert.strictEqual(result.type, 'expense');
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '15:24');
    assert.strictEqual(result.amount, 5000000);
    assert.strictEqual(result.beneficiary, 'Juan Pérez');
    assert.strictEqual(result.entity, 'Banco Estado');
  });

  test('handles RFC2822 date string', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      subject: 'Tu transferencia fue enviada',
      date: 'Wed, 26 Aug 2026 15:24:17 +0000 (UTC)',
      textBody: `Ya enviamos tu transferencia de $ 50.000

Nombre y apellido: María González
Entidad: Banco Chile`,
    };

    const result = parseMercadoPago(email);
    assert.ok(result);
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '15:24');
    assert.strictEqual(result.beneficiary, 'María González');
  });

  test('handles Spanish prose date', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      subject: 'Tu transferencia fue enviada',
      date: '26 de agosto de 2026 a las 15:24',
      textBody: `Ya enviamos tu transferencia de $ 100.000

Nombre y apellido: Carlos López
Entidad: Banco Santander`,
    };

    const result = parseMercadoPago(email);
    assert.ok(result);
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '15:24');
  });

  test('handles ISO date string', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      subject: 'Tu transferencia fue enviada',
      date: '2026-08-26T15:24:17',
      textBody: `Ya enviamos tu transferencia de $ 75.000

Nombre y apellido: Ana Silva
Entidad: BCI`,
    };

    const result = parseMercadoPago(email);
    assert.ok(result);
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '15:24');
  });

  test('handles missing date gracefully', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      subject: 'Tu transferencia fue enviada',
      textBody: `Ya enviamos tu transferencia de $ 50.000

Nombre y apellido: Juan Pérez
Entidad: Banco Estado`,
    };

    const result = parseMercadoPago(email);
    assert.ok(result);
    assert.strictEqual(result.date, undefined);
    assert.strictEqual(result.time, undefined);
  });

  test('handles invalid Date object', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      subject: 'Tu transferencia fue enviada',
      date: new Date('invalid'),
      textBody: `Ya enviamos tu transferencia de $ 50.000

Nombre y apellido: Juan Pérez
Entidad: Banco Estado`,
    };

    const result = parseMercadoPago(email);
    assert.ok(result);
    assert.strictEqual(result.date, undefined);
  });

  test('parses "Pagaste" transaction with Date object', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      subject: 'Comprobante de pago',
      date: new Date('2026-08-26T15:24:17Z'),
      textBody: 'Pagaste $ 5.000 con dÃ©bito terminada en 1234 a Netflix.',
    };

    const result = parseMercadoPago(email);
    assert.ok(result);
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '15:24');
    assert.strictEqual(result.name, 'Netflix');
    assert.strictEqual(result.last4, '1234');
  });

  test('parses subscription with Date object', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      subject: 'Suscripción confirmada',
      date: new Date('2026-08-26T10:30:00Z'),
      textBody: 'Te suscribiste a Plan Premium de Spotify por $ 7.990 al mes con crÃ©dito terminada en 5678.',
    };

    const result = parseMercadoPago(email);
    assert.ok(result);
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '10:30');
    assert.strictEqual(result.name, 'Plan Premium - Spotify');
    assert.strictEqual(result.last4, '5678');
  });
});

describe('Mercado Pago parser - Transfer parsing', () => {
  test('parses outgoing transfer with all fields', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      subject: 'Tu transferencia fue enviada',
      date: new Date('2026-08-26T15:24:17Z'),
      textBody: `Ya enviamos tu transferencia de $ 50.000

Nombre y apellido: Juan Pérez
Entidad: Banco Estado
Número de cuenta: 12345678`,
    };

    const result = parseMercadoPago(email);
    assert.ok(result);
    assert.strictEqual(result.provider, 'mercadopago');
    assert.strictEqual(result.type, 'expense');
    assert.strictEqual(result.currency, 'CLP');
    assert.strictEqual(result.amount, 5000000);
    assert.strictEqual(result.beneficiary, 'Juan Pérez');
    assert.strictEqual(result.entity, 'Banco Estado');
    assert.strictEqual(result.beneficiaryAccount, '12345678');
    assert.strictEqual(result.originalName, 'Transferencia Juan Pérez Banco Estado');
    assert.strictEqual(result.name, 'Juan Pérez');
  });

  test('parses transfer without account number', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      date: new Date('2026-08-26T15:24:17Z'),
      textBody: `Ya enviamos tu transferencia de $ 100.000

Nombre y apellido: María González
Entidad: Banco Chile`,
    };

    const result = parseMercadoPago(email);
    assert.ok(result);
    assert.strictEqual(result.beneficiary, 'María González');
    assert.strictEqual(result.entity, 'Banco Chile');
    assert.strictEqual(result.beneficiaryAccount, undefined);
  });

  test('ignores non-transfer emails', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      date: new Date('2026-08-26T15:24:17Z'),
      textBody: 'Tu cuenta fue actualizada.',
    };

    const result = parseMercadoPago(email);
    assert.strictEqual(result, null);
  });
});

describe('Mercado Pago parser - Amount parsing', () => {
  test('handles CLP amounts with thousands separator', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      date: new Date('2026-08-26T15:24:17Z'),
      textBody: `Ya enviamos tu transferencia de $ 1.500.000

Nombre y apellido: Test User
Entidad: Test Bank`,
    };

    const result = parseMercadoPago(email);
    assert.ok(result);
    assert.strictEqual(result.amount, 150000000);
  });

  test('handles amounts without decimals', () => {
    const email = {
      _source_email_provider: 'mercadopago',
      from: 'info@mercadopago.com',
      date: new Date('2026-08-26T15:24:17Z'),
      textBody: `Ya enviamos tu transferencia de $ 50000

Nombre y apellido: Test User
Entidad: Test Bank`,
    };

    const result = parseMercadoPago(email);
    assert.ok(result);
    assert.strictEqual(result.amount, 5000000);
  });
});
