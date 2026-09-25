import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseEmailDate, extractEmailDate } from '../src/lib/date-utils.mjs';

describe('parseEmailDate', () => {
  test('handles Date objects', () => {
    const date = new Date('2026-08-26T15:24:17Z');
    const result = parseEmailDate(date);
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '15:24');
  });

  test('handles RFC2822 date strings', () => {
    const result = parseEmailDate('Wed, 26 Aug 2026 15:24:17 +0000 (UTC)');
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '15:24');
  });

  test('handles Date.toString() format', () => {
    const result = parseEmailDate('Wed Aug 26 2026 15:24:17 GMT+0000');
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '15:24');
  });

  test('handles Spanish prose dates', () => {
    const result = parseEmailDate('26 de agosto de 2026 a las 15:24');
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '15:24');
  });

  test('handles Spanish prose with single-digit day and hour', () => {
    const result = parseEmailDate('5 de enero de 2026 a las 9:05');
    assert.strictEqual(result.date, '2026-01-05');
    assert.strictEqual(result.time, '09:05');
  });

  test('handles ISO date strings with T separator', () => {
    const result = parseEmailDate('2026-08-26T15:24:17');
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '15:24');
  });

  test('handles ISO date strings with space separator', () => {
    const result = parseEmailDate('2026-08-26 15:24:17');
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '15:24');
  });

  test('returns empty object for undefined', () => {
    const result = parseEmailDate(undefined);
    assert.deepStrictEqual(result, {});
  });

  test('returns empty object for null', () => {
    const result = parseEmailDate(null);
    assert.deepStrictEqual(result, {});
  });

  test('returns empty object for invalid date string', () => {
    const result = parseEmailDate('not a date');
    assert.deepStrictEqual(result, {});
  });

  test('returns empty object for invalid Date object', () => {
    const result = parseEmailDate(new Date('invalid'));
    assert.deepStrictEqual(result, {});
  });

  test('handles Spanish months with accents', () => {
    const result = parseEmailDate('15 de febrero de 2026 a las 10:30');
    assert.strictEqual(result.date, '2026-02-15');
    assert.strictEqual(result.time, '10:30');
  });

  test('handles all Spanish months', () => {
    const months = [
      ['enero', '01'], ['febrero', '02'], ['marzo', '03'], ['abril', '04'],
      ['mayo', '05'], ['junio', '06'], ['julio', '07'], ['agosto', '08'],
      ['septiembre', '09'], ['octubre', '10'], ['noviembre', '11'], ['diciembre', '12'],
    ];
    
    for (const [month, expected] of months) {
      const result = parseEmailDate(`15 de ${month} de 2026 a las 12:00`);
      assert.strictEqual(result.date, `2026-${expected}-15`, `Failed for month: ${month}`);
    }
  });

  test('normalizes accented Spanish month names', () => {
    const result = parseEmailDate('15 de septiembre de 2026 a las 14:20');
    assert.strictEqual(result.date, '2026-09-15');
  });
});

describe('extractEmailDate', () => {
  test('extracts date from email object with Date field', () => {
    const email = {
      date: new Date('2026-08-26T15:24:17Z'),
      textBody: 'Some text',
    };
    const result = extractEmailDate(email);
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '15:24');
  });

  test('extracts date from email object with string date field', () => {
    const email = {
      date: 'Wed, 26 Aug 2026 15:24:17 +0000',
      textBody: 'Some text',
    };
    const result = extractEmailDate(email);
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '15:24');
  });

  test('returns empty object when no date available', () => {
    const email = { textBody: 'Some text' };
    const result = extractEmailDate(email);
    assert.deepStrictEqual(result, {});
  });

  test('prefers envelope date over body pattern', () => {
    const email = {
      date: new Date('2026-08-26T15:24:17Z'),
      textBody: 'Fecha: 2026-01-01',
    };
    const result = extractEmailDate(email, /Fecha:\s*(\S+)/);
    assert.strictEqual(result.date, '2026-08-26');
  });

  test('falls back to body pattern when envelope date unavailable', () => {
    const email = {
      textBody: 'Fecha: 2026-08-26T10:30:00',
    };
    const result = extractEmailDate(email, /Fecha:\s*(\S+)/);
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '10:30');
  });
});

describe('Date handling edge cases', () => {
  test('handles timezone offsets correctly', () => {
    const result = parseEmailDate('Wed, 26 Aug 2026 15:24:17 -0300');
    assert.strictEqual(result.date, '2026-08-26');
    assert.ok(result.time);
  });

  test('handles leap year dates', () => {
    const result = parseEmailDate('29 de febrero de 2024 a las 12:00');
    assert.strictEqual(result.date, '2024-02-29');
  });

  test('handles year boundary', () => {
    const result = parseEmailDate('31 de diciembre de 2025 a las 23:59');
    assert.strictEqual(result.date, '2025-12-31');
    assert.strictEqual(result.time, '23:59');
  });

  test('handles midnight time', () => {
    const result = parseEmailDate('2026-08-26T00:00:00Z');
    assert.strictEqual(result.date, '2026-08-26');
    assert.strictEqual(result.time, '00:00');
  });
});
