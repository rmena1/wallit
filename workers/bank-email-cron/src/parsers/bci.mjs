import { parseCardPayment } from './card-payment.mjs';
/** Parse BCI credit-card purchase notices (CLP and international USD).
 *
 * Two body layouts appear in the filled corpus:
 * 1. Colon-separated fields (newer): `Monto: USD 33,29` / `Comercio: …`
 * 2. Colonless compact fields (older): `Monto USD 45,00` / `Comercio KAPSO …`
 */

const BCI_PURCHASE = /Realizaste una compra(?: en comercio internacional)?\s+con tu tarjeta de cr[eé]dito\./i;
const BCI_LAST4 = /\bN[uú]mero tarjeta cr[eé]dito:?\s*[*xX•]{4}(\d{4})/im;
const BCI_AMOUNT = /\bMonto:?\s*(?:(USD)\s+)?\$?\s*([0-9.]+(?:,[0-9]{1,2})?)(?=\s+Fecha:?\s|\s*$)/im;
const BCI_MERCHANT = /\bComercio:?\s*(.+?)(?=\s+Cuotas\b|\s+Si\b|\s*$)/m;
const BCI_DATE = /\bFecha:?\s*(\d{2})\/(\d{2})\/(\d{4})/im;
const BCI_TIME = /\bHora:?\s*(\d{2}:\d{2})\s+horas?/im;

function bodyText(email) {
  let text = String(email?.textBody ?? '').replace(/\r\n?/g, '\n');
  text = text.replace(/=\r?\n/g, '').replace(/=\s+/g, '');
  text = text
    .replace(/cr(?:�|Ã©)dito/gi, 'crédito')
    .replace(/d(?:�|Ã©)bito/gi, 'débito')
    .replace(/N(?:�|Ãº)mero/gi, 'Número')
    .replace(/transacci(?:�|Ã³)n/gi, 'transacción');
  return text.split('\n').map((line) => line.trimEnd()).join('\n');
}

function clpAmount(value) {
  const normalized = String(value).replace(/\s/g, '');
  if (!/^[0-9]+(?:\.[0-9]{3})*(?:,00)?$/.test(normalized) && !/^[0-9]+$/.test(normalized)) {
    throw new Error(`invalid CLP amount: ${value}`);
  }
  return Number(normalized.replace(/\./g, '').replace(/,00$/, '')) * 100;
}

function minorUnits(value) {
  const normalized = String(value).replace(/\s/g, '');
  const [whole, fraction = ''] = normalized.split(',');
  if (!/^\d+(?:\.\d{3})*$/.test(whole) || !/^\d{0,2}$/.test(fraction)) {
    throw new Error(`invalid decimal amount: ${value}`);
  }
  return Number(whole.replace(/\./g, '')) * 100 + Number((fraction + '00').slice(0, 2));
}

/** @returns {object|null} normalized parser result, or null when not a BCI purchase */
export function parseBci(email) {
  const provider = String(email?._source_email_provider ?? '').toLowerCase();
  const sender = String(email?.from ?? '').toLowerCase();
  if (provider !== 'bci' && !sender.includes('bci.cl')) return null;

  const text = bodyText(email);
  const payment = parseCardPayment(email, 'bci', text);
  if (payment) return payment;
  if (!BCI_PURCHASE.test(text)) return null;

  const amountMatch = text.match(BCI_AMOUNT);
  const merchantMatch = text.match(BCI_MERCHANT);
  const dateMatch = text.match(BCI_DATE);
  const timeMatch = text.match(BCI_TIME);
  if (!amountMatch || !merchantMatch || !dateMatch || !timeMatch) return null;

  const isUsd = Boolean(amountMatch[1])
    || /\bUSD\b/i.test(amountMatch[0])
    || /comercio internacional/i.test(text);
  const result = {
    provider: 'bci',
    type: 'expense',
    currency: isUsd ? 'USD' : 'CLP',
    originalName: merchantMatch[1].trim(),
    name: merchantMatch[1].trim(),
    date: `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`,
    time: timeMatch[1],
    last4: (text.match(BCI_LAST4) ?? [])[1],
    cardHint: 'crédito',
  };
  if (isUsd) result.amountUsd = minorUnits(amountMatch[2]);
  else result.amount = clpAmount(amountMatch[2]);
  return result;
}

export default parseBci;
