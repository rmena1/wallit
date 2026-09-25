/** Parse Mercado Pago outgoing transfer and subscription/prose payment notices. */

const MP_TRANSFER = /Ya enviamos tu transferencia de\s*\$\s*([0-9.]+(?:,[0-9]{1,2})?)/i;
const MP_BENEFICIARY = /Nombre y apellido:\s*(.+?)(?=\s+(?:Entidad|N[uú]mero de cuenta|Si |Segu[ií]|Recibiste|$))/i;
const MP_ENTITY = /Entidad:\s*(.+?)(?=\s+(?:N[uú]mero de cuenta|Si |Segu[ií]|Recibiste|$))/i;
const MP_ACCOUNT = /N[uú]mero de cuenta:\s*(\d+)/i;
const MP_PAGASTE = /Pagaste\s*\$\s*([0-9]+[.,][0-9]{2}|[0-9.]+(?:,[0-9]{1,2})?)\s+con\s+(\w+)\s+terminada\s+en\s+(\d{4})\s+a\s+([^.]+?)(?:\.|$)/i;
const MP_SUSCRIBISTE = /Te suscribiste a\s+(.+?)\s+de\s+(.+?)\s+por\s*\$\s*([0-9]+[.,][0-9]{2}|[0-9.]+(?:,[0-9]{1,2})?)(?:\s+al mes)?(?:\s+con\s+(\w+)\s+terminada\s+en\s+(\d{4}))?/i;

function bodyText(email) {
  let text = String(email?.textBody ?? '').replace(/\r\n?/g, '\n');
  text = text.replace(/=\r?\n/g, '').replace(/=\s+/g, '');
  text = text
    .replace(/cr(?:�|Ã©)dito/gi, 'crédito')
    .replace(/d(?:�|Ã©)bito/gi, 'débito')
    .replace(/N(?:�|Ãº)mero/gi, 'Número')
    .replace(/transacci(?:�|Ã³)n/gi, 'transacción')
    .replace(/suscripci(?:�|Ã³)n/gi, 'suscripción')
    .replace(/Operaci(?:�|Ã³)n/gi, 'Operación');
  return text.split('\n').map((line) => line.trimEnd()).join('\n');
}

function clpAmount(value) {
  const normalized = String(value).replace(/\s/g, '');
  if (!/^[0-9]+(?:\.[0-9]{3})*(?:,00)?$/.test(normalized) && !/^[0-9]+$/.test(normalized)) {
    throw new Error(`invalid CLP amount: ${value}`);
  }
  return Number(normalized.replace(/\./g, '').replace(/,00$/, '')) * 100;
}

function moneyToCentavos(value) {
  const normalized = String(value).replace(/\s/g, '');
  if (/^\d+[.,]\d{2}$/.test(normalized)) {
    const [whole, fraction] = normalized.split(/[.,]/);
    return Number(whole) * 100 + Number(fraction);
  }
  return clpAmount(normalized);
}

const SPANISH_MONTHS = new Map([
  ['enero', 1], ['febrero', 2], ['marzo', 3], ['abril', 4], ['mayo', 5], ['junio', 6],
  ['julio', 7], ['agosto', 8], ['septiembre', 9], ['octubre', 10], ['noviembre', 11], ['diciembre', 12],
]);

function envelopeDateTime(value) {
  const raw = String(value ?? '').trim();
  const spanish = raw.match(/^(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})\s+a\s+las\s+(\d{1,2}):(\d{2})$/i);
  if (spanish) {
    const month = SPANISH_MONTHS.get(spanish[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
    if (month) return {
      date: `${spanish[3]}-${String(month).padStart(2, '0')}-${String(spanish[1]).padStart(2, '0')}`,
      time: `${String(spanish[4]).padStart(2, '0')}:${spanish[5]}`,
    };
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return iso ? { date: iso[1] + '-' + iso[2] + '-' + iso[3], time: iso[4] + ':' + iso[5] } : {};
}

function parseOutgoingTransfer(text, email) {
  if (!/Ya enviamos tu transferencia de/i.test(text)) return null;
  const amountMatch = text.match(MP_TRANSFER);
  const beneficiaryMatch = text.match(MP_BENEFICIARY);
  const entityMatch = text.match(MP_ENTITY);
  if (!amountMatch || !beneficiaryMatch || !entityMatch) return null;

  const beneficiary = beneficiaryMatch[1].trim();
  const entity = entityMatch[1].trim();
  const dateTime = envelopeDateTime(email?.date);
  const accountMatch = text.match(MP_ACCOUNT);
  return {
    provider: 'mercadopago',
    type: 'expense',
    currency: 'CLP',
    amount: clpAmount(amountMatch[1]),
    originalName: `Transferencia ${beneficiary} ${entity}`,
    name: beneficiary,
    beneficiary,
    entity,
    beneficiaryAccount: accountMatch?.[1],
    date: dateTime.date,
    time: dateTime.time,
    last4: undefined,
  };
}

function parseSubscriptionProse(text, email) {
  const pagaste = text.match(MP_PAGASTE);
  if (pagaste) {
    const merchant = pagaste[4].trim();
    const dateTime = envelopeDateTime(email?.date);
    return {
      provider: 'mercadopago',
      type: 'expense',
      currency: 'CLP',
      amount: moneyToCentavos(pagaste[1]),
      originalName: merchant,
      name: merchant,
      date: dateTime.date,
      time: dateTime.time,
      last4: pagaste[3],
      cardHint: pagaste[2] ? pagaste[2].toLowerCase() : undefined,
    };
  }

  const sub = text.match(MP_SUSCRIBISTE);
  if (sub) {
    const product = sub[1].trim();
    const merchant = sub[2].trim();
    const dateTime = envelopeDateTime(email?.date);
    return {
      provider: 'mercadopago',
      type: 'expense',
      currency: 'CLP',
      amount: moneyToCentavos(sub[3]),
      originalName: merchant,
      name: `${product} - ${merchant}`,
      date: dateTime.date,
      time: dateTime.time,
      last4: sub[5] || undefined,
      cardHint: sub[4] ? sub[4].toLowerCase() : undefined,
    };
  }

  return null;
}

/** @returns {object|null} normalized parser result, or null when unrecognized */
export function parseMercadoPago(email) {
  const provider = String(email?._source_email_provider ?? '').toLowerCase();
  const sender = String(email?.from ?? '').toLowerCase();
  if (provider !== 'mercadopago' && !sender.includes('mercadopago')) return null;

  const text = bodyText(email);
  return parseOutgoingTransfer(text, email) ?? parseSubscriptionProse(text, email);
}

export default parseMercadoPago;
