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
    beneficiaryAccount: text.match(/(?:N[uú]mero (?:de )?tarjeta(?: de)? cr[eé]dito|Tarjeta de cr[eé]dito(?: pagada)?):?\s*([*xX•\d]+)/i)?.[1],
    sourceAccount: text.match(/Cuenta (?:de origen|de cargo|cargo|origen):?\s*([*xX•\d]+)/i)?.[1],
    sourceBank: text.match(/Banco (?:de origen|de cargo):?\s*([^\n]+)/i)?.[1]?.trim(),
  };
}
