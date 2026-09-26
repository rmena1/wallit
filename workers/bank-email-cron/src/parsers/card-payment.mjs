// Undefined means absent; an empty string means an explicit unresolved field.
// Retain whole values (including malformed suffixes), never a numeric prefix.
function accountFields(text, label) {
  const fields = [...text.matchAll(new RegExp(
    `(?:(?:^|\\n)[ \\t]*(?:${label})(?=[: \\t\\r\\n]|$)[ \\t]*:?|\\s(?:${label})[ \\t]*:)[ \\t]*`, 'gi',
  ))].map(match => {
    const rest = text.slice(match.index + match[0].length);
    // Bound inline fields as well as line-oriented templates. Unknown text is
    // retained so malformed values cannot become a confidently resolved prefix.
    return rest.split(new RegExp(
      `\\r?\\n|\\s+(?:(?:${CARD_LABEL})|(?:${SOURCE_LABEL})|Banco (?:de origen|de cargo)|Monto(?: pagado| del pago)?|Fecha|Hora)[ \\t]*:`, 'i',
    ), 1)[0].trim();
  });
  return fields.length > 1 ? fields : fields[0];
}

const CARD_LABEL = String.raw`(?:N[uú]mero(?: de)? tarjeta(?:(?: de)? cr[eé]dito)?|Tarjeta(?: de cr[eé]dito)?)(?: pagada| terminada en| terminado en)?`;
const SOURCE_LABEL = String.raw`Cuenta (?:de origen|de cargo|cargo|origen)`;

/** Own-card payment notices. Source must still be resolved from a labeled account. */
export function parseCardPayment(email, provider, text) {
  const notice = `${email.subject || ''}\n${text}`;
  if (!/(?:comprobante (?:de )?pago (?:de )?(?:tu )?tarjeta de cr[eé]dito|recibimos con [eé]xito el pago de tu tarjeta de cr[eé]dito)/i.test(notice)) return null;
  const amount = text.match(/Monto(?: pagado| del pago)?:?\s*\$\s*([\d.]+(?:,00)?)(?=\s|$)/i);
  const date = text.match(/Fecha:?\s*(\d{2})[-/](\d{2})[-/](\d{4})/i);
  if (!amount || !date) return null;
  const value = amount[1];
  if (!/^\d+(?:\.\d{3})*(?:,00)?$/.test(value)) throw new Error('Invalid card payment amount');
  return {
    provider, type: 'expense', currency: 'CLP', ownCardPayment: true,
    amount: Number(value.replace(/\./g, '').replace(/,00$/, '')) * 100,
    date: `${date[3]}-${date[2]}-${date[1]}`,
    time: text.match(/Hora:?\s*(\d{2}:\d{2})/i)?.[1],
    name: 'Pago tarjeta de crédito', originalName: 'Pago tarjeta de crédito',
    entity: provider,
    beneficiaryAccount: accountFields(text, CARD_LABEL),
    sourceAccount: accountFields(text, SOURCE_LABEL),
    sourceBank: text.match(/Banco (?:de origen|de cargo):?\s*([^\n]+)/i)?.[1]?.trim(),
  };
}
