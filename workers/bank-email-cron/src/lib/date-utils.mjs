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
  
  if (value instanceof Date) return instantDate(value);

  const raw = String(value).trim();
  // Validate source calendar/clock components before Date can normalize them.
  const isoSource = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (isoSource) {
    if (!validLocal(`${isoSource[1]}-${isoSource[2]}-${isoSource[3]}`, `${isoSource[4] || '00'}:${isoSource[5] || '00'}`).date
      || (isoSource[6] !== undefined && Number(isoSource[6]) > 59)) return {};
  }
  const rfcSource = raw.match(/^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (rfcSource) {
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(rfcSource[2].toLowerCase()) + 1;
    if (!month || !validLocal(`${rfcSource[3]}-${String(month).padStart(2, '0')}-${rfcSource[1].padStart(2, '0')}`, `${rfcSource[4]}:${rfcSource[5]}`).date
      || (rfcSource[6] !== undefined && Number(rfcSource[6]) > 59)) return {};
  }

  const monthFirst = raw.match(/^(?:[A-Za-z]{3}\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (monthFirst) {
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(monthFirst[1].toLowerCase()) + 1;
    if (!month || !validLocal(`${monthFirst[3]}-${String(month).padStart(2, '0')}-${monthFirst[2].padStart(2, '0')}`, `${monthFirst[4]}:${monthFirst[5]}`).date
      || (monthFirst[6] !== undefined && Number(monthFirst[6]) > 59)) return {};
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date: raw };

  
  // Spanish prose: "26 de agosto de 2026 a las 15:24"
  const spanish = raw.match(/^(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})\s+a\s+las\s+(\d{1,2}):(\d{2})$/i);
  if (spanish) {
    const month = SPANISH_MONTHS.get(spanish[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
    if (month) {
      return validLocal(`${spanish[3]}-${String(month).padStart(2, '0')}-${String(spanish[1]).padStart(2, '0')}`,
        `${String(spanish[4]).padStart(2, '0')}:${spanish[5]}`);
    }
  }

  // ISO-like formats: "2026-08-26T15:24:17" or "2026-08-26 15:24"
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (iso && !/(?:Z|[+-]\d{2}:?\d{2})(?:\s*\(.*\))?$/.test(raw)) {
    return validLocal(`${iso[1]}-${iso[2]}-${iso[3]}`, `${iso[4]}:${iso[5]}`);
  }

  // RFC2822 / Date.toString() format: "Wed, 26 Aug 2026 15:24:17 +0000" or "Wed Aug 26 2026 15:24:17 GMT+0000"
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return instantDate(parsed);

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

function validLocal(date, time) {
  const value = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== date
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? {} : { date, time };
}
function instantDate(value) {
  if (Number.isNaN(value.getTime())) return {};
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
