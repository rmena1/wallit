/**
 * Shared date normalization utilities for email parsers.
 * Handles Date objects, RFC2822 strings, Spanish prose dates, and ISO formats.
 */

const SPANISH_MONTHS = new Map([
  ['enero', 1], ['febrero', 2], ['marzo', 3], ['abril', 4], ['mayo', 5], ['junio', 6],
  ['julio', 7], ['agosto', 8], ['septiembre', 9], ['octubre', 10], ['noviembre', 11], ['diciembre', 12],
]);

/**
 * Parse date from email envelope or body text.
 * Returns { date: 'YYYY-MM-DD', time?: 'HH:MM' } or empty object if unparseable.
 * 
 * @param {Date|string|undefined} value - Date object, RFC2822, Spanish prose, or ISO string
 * @returns {{ date?: string, time?: string }}
 */
export function parseEmailDate(value) {
  if (!value) return {};
  
  // Handle Date objects (from mailparser)
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return {};
    const iso = value.toISOString();
    return {
      date: iso.slice(0, 10),
      time: iso.slice(11, 16),
    };
  }

  const raw = String(value).trim();
  
  // Spanish prose: "26 de agosto de 2026 a las 15:24"
  const spanish = raw.match(/^(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})\s+a\s+las\s+(\d{1,2}):(\d{2})$/i);
  if (spanish) {
    const month = SPANISH_MONTHS.get(spanish[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
    if (month) {
      return {
        date: `${spanish[3]}-${String(month).padStart(2, '0')}-${String(spanish[1]).padStart(2, '0')}`,
        time: `${String(spanish[4]).padStart(2, '0')}:${spanish[5]}`,
      };
    }
  }

  // ISO-like formats: "2026-08-26T15:24:17" or "2026-08-26 15:24"
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (iso) {
    return {
      date: `${iso[1]}-${iso[2]}-${iso[3]}`,
      time: `${iso[4]}:${iso[5]}`,
    };
  }

  // RFC2822 / Date.toString() format: "Wed, 26 Aug 2026 15:24:17 +0000" or "Wed Aug 26 2026 15:24:17 GMT+0000"
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const iso = parsed.toISOString();
    return {
      date: iso.slice(0, 10),
      time: iso.slice(11, 16),
    };
  }

  return {};
}

/**
 * Extract date from email object, trying date field first, then body text patterns.
 * Returns { date?: string, time?: string }.
 * 
 * @param {object} email - Email with date field and/or textBody
 * @param {string} [bodyDatePattern] - Optional regex to extract date from body
 * @returns {{ date?: string, time?: string }}
 */
export function extractEmailDate(email, bodyDatePattern) {
  // Try envelope date first
  const envelopeDate = parseEmailDate(email?.date);
  if (envelopeDate.date) return envelopeDate;

  // Optionally try body text
  if (bodyDatePattern && email?.textBody) {
    const match = String(email.textBody).match(bodyDatePattern);
    if (match && match[1]) {
      const bodyDate = parseEmailDate(match[1]);
      if (bodyDate.date) return bodyDate;
    }
  }

  return {};
}
