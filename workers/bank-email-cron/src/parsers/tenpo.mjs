/** Parse Tenpo purchase, bill-payment, and transfer notices. */

const TENPO_PURCHASE_AMOUNT = /Monto transacci[oó]n:\s*\$\s*([0-9.]+(?:,[0-9]{1,2})?)/i;
const TENPO_PURCHASE_MERCHANT = /Comercio:\s*(.+?)(?=\s+(?:Cuotas|Fecha|Hora|C[oó]digo)\b|$)/i;
const TENPO_BILL_AMOUNT = /Monto:\s*\$\s*([0-9.]+(?:,[0-9]{1,2})?)/i;
const TENPO_BILL_SERVICE = /Servicio:\s*(.+?)(?=\s+(?:Monto|Fecha|Hora|C[oó]digo|M[eé]todo)\b|$)/i;
const TENPO_TRANSFER_AMOUNT = /Monto transferencia:\s*\$\s*([0-9.]+(?:,[0-9]{1,2})?)/i;
const TENPO_PAID_AMOUNT = /Monto pagado:\s*\$\s*([0-9.]+(?:,[0-9]{1,2})?)/i;
const TENPO_DESTINATARIO = /Nombre del destinatario:\s*(.+?)(?=\s+(?:Banco de destino|N[ºo°.]\s*cuenta|RUT|Fecha|Hora|Mensaje)\b|$)/i;
const TENPO_BANCO = /Banco de destino:\s*(.+?)(?=\s+(?:N[ºo°.]\s*cuenta|RUT|Fecha|Hora|Mensaje)\b|$)/i;
const TENPO_CUENTA = /N[ºo°.]\s*cuenta de destino:\s*(\S+)/i;
const TENPO_ENVIADO_POR = /Enviado por:\s*(.+?)(?=\s+(?:Monto pagado|Mensaje|Fecha|Hora|C[oó]digo)\b|$)/i;
const TENPO_DATE = /Fecha:\s*(\d{2})[-\/](\d{2})[-\/](\d{4})/i;
const TENPO_TIME = /Hora:\s*(\d{2}:\d{2})(?::\d{2})?/i;
const TENPO_CARD = /tarjeta de\s+(cr[eé]dito|d[eé]bito)\b/i;
const TENPO_PAY_METHOD_CREDIT = /M[eé]todo de pago:\s*Tarjeta de Cr[eé]dito Tenpo/i;

function bodyText(email) {
  let text = String(email?.textBody ?? '').replace(/\r\n?/g, '\n');
  text = text.replace(/=\r?\n/g, '').replace(/=\s+/g, '');
  text = text
    .replace(/cr(?:�|Ã©)dito/gi, 'crédito')
    .replace(/d(?:�|Ã©)bito/gi, 'débito')
    .replace(/transacci(?:�|Ã³)n/gi, 'transacción')
    .replace(/N(?:�|Âº)/g, 'Nº')
    .replace(/C(?:�|Ã³)digo/gi, 'Código')
    .replace(/electr(?:�|Ã³)nicos/gi, 'electrónicos')
    .replace(/N(?:�|Ãº)mero/gi, 'Número')
    .replace(/M(?:�|Ã©)todo/gi, 'Método')
    .replace(/Cr(?:�|Ã©)dito/g, 'Crédito');
  return text.split('\n').map((line) => line.trimEnd()).join('\n');
}

function clpAmount(value) {
  const normalized = String(value).replace(/\s/g, '');
  if (!/^[0-9]+(?:\.[0-9]{3})*(?:,00)?$/.test(normalized) && !/^[0-9]+$/.test(normalized)) {
    throw new Error(`invalid CLP amount: ${value}`);
  }
  return Number(normalized.replace(/\./g, '').replace(/,00$/, '')) * 100;
}

function isoDate(match) {
  return match ? `${match[3]}-${match[2]}-${match[1]}` : undefined;
}

function baseFields(text) {
  const dateMatch = text.match(TENPO_DATE);
  const timeMatch = text.match(TENPO_TIME);
  return {
    date: isoDate(dateMatch),
    time: timeMatch?.[1],
  };
}

function parsePurchase(text) {
  if (!/(?:compra\s+exitosa|la compra por .+? fue exitosa)/i.test(text)) return null;
  const amountMatch = text.match(TENPO_PURCHASE_AMOUNT);
  const merchantMatch = text.match(TENPO_PURCHASE_MERCHANT);
  const { date, time } = baseFields(text);
  if (!amountMatch || !merchantMatch || !date || !time) return null;
  const card = text.match(TENPO_CARD);
  return {
    provider: 'tenpo',
    type: 'expense',
    currency: 'CLP',
    amount: clpAmount(amountMatch[1]),
    originalName: merchantMatch[1].trim(),
    name: merchantMatch[1].trim(),
    date,
    time,
    cardHint: card ? card[1].toLowerCase() : undefined,
    last4: undefined,
  };
}

function parseBillPayment(text) {
  if (!/comprobante de pago exitoso/i.test(text)) return null;
  if (!TENPO_PAY_METHOD_CREDIT.test(text) && !/est[aá] pagada/i.test(text)) return null;
  if (TENPO_PAID_AMOUNT.test(text) || TENPO_ENVIADO_POR.test(text)) return null;
  if (TENPO_TRANSFER_AMOUNT.test(text)) return null;

  const amountMatch = text.match(TENPO_BILL_AMOUNT);
  const serviceMatch = text.match(TENPO_BILL_SERVICE);
  const { date, time } = baseFields(text);
  if (!amountMatch || !serviceMatch || !date || !time) return null;

  const service = serviceMatch[1].trim();
  return {
    provider: 'tenpo',
    type: 'expense',
    currency: 'CLP',
    amount: clpAmount(amountMatch[1]),
    originalName: service,
    name: service,
    date,
    time,
    cardHint: TENPO_PAY_METHOD_CREDIT.test(text) ? 'crédito' : undefined,
    last4: undefined,
  };
}

function parseIncomingPayment(text) {
  const paidMatch = text.match(TENPO_PAID_AMOUNT);
  if (!paidMatch) return null;
  let sender = text.match(TENPO_ENVIADO_POR)?.[1]?.trim();
  if (!sender) {
    sender = text.match(/El pago de\s+(.+?)\s+por\s+\$/i)?.[1]?.trim();
  }
  const { date, time } = baseFields(text);
  if (!sender || !date || !time) return null;
  return {
    provider: 'tenpo',
    type: 'income',
    currency: 'CLP',
    amount: clpAmount(paidMatch[1]),
    originalName: sender,
    name: sender,
    beneficiary: sender,
    date,
    time,
    last4: undefined,
  };
}

function parseOutgoingTransfer(text) {
  const amountMatch = text.match(TENPO_TRANSFER_AMOUNT);
  const destMatch = text.match(TENPO_DESTINATARIO);
  if (!amountMatch || !destMatch) return null;
  if (TENPO_PAID_AMOUNT.test(text) || TENPO_ENVIADO_POR.test(text)) return null;

  const isExplicitOutgoing = /Has realizado una transferencia/i.test(text)
    || /desde tu cuenta Tenpo/i.test(text);
  const hasDestinationBlock = Boolean(text.match(TENPO_BANCO));
  const isOddOutgoing = /La transferencia de .+? a tu cuenta/i.test(text) && hasDestinationBlock;
  if (!isExplicitOutgoing && !isOddOutgoing && !hasDestinationBlock) return null;

  const { date, time } = baseFields(text);
  if (!date || !time) return null;
  const beneficiary = destMatch[1].trim();
  const bank = text.match(TENPO_BANCO)?.[1]?.trim();
  const account = text.match(TENPO_CUENTA)?.[1];
  return {
    provider: 'tenpo',
    type: 'expense',
    currency: 'CLP',
    amount: clpAmount(amountMatch[1]),
    originalName: beneficiary,
    name: beneficiary,
    beneficiary,
    entity: bank,
    beneficiaryAccount: account,
    date,
    time,
    last4: undefined,
  };
}

/** @returns {object|null} normalized parser result, or null when unrecognized */
export function parseTenpo(email) {
  const provider = String(email?._source_email_provider ?? '').toLowerCase();
  const sender = String(email?.from ?? '').toLowerCase();
  if (provider !== 'tenpo' && !sender.includes('tenpo.cl')) return null;

  const text = bodyText(email);
  return parsePurchase(text)
    ?? parseIncomingPayment(text)
    ?? parseOutgoingTransfer(text)
    ?? parseBillPayment(text);
}

export default parseTenpo;
