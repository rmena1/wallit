export function validateParsed(result) {
  if (!result) return result;
  if (result.routingAmbiguous) throw new Error('parser_ambiguous_routing');
  const date = String(result.date || '');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime())
      || parsed.toISOString().slice(0, 10) !== date) throw new Error('parser_invalid_date');
  if (result.time !== undefined && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result.time)) throw new Error('parser_invalid_time');
  if (!['CLP', 'USD'].includes(result.currency)) throw new Error('parser_invalid_currency');
  const amount = result.currency === 'USD' ? result.amountUsd : result.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0 || (result.currency === 'USD' && amount > 2_147_483_647)) throw new Error('parser_invalid_amount');
  if (!['income', 'expense'].includes(result.type) || typeof result.name !== 'string'
    || !result.name.trim() || result.name.length > 200) throw new Error('parser_invalid_fields');
  return result;
}
export function looksLikeTransactionNotice(email) {
  const text = `${email.subject || ''}\n${email.textBody || ''}`.replace(/\s+/g, ' ');
  return /Realizaste\s+una\s+compra|compra\s+exitosa|la compra por .+? fue exitosa|comprobante (?:de )?(?:compra|pago|transferencia)|Monto transacci[oó]n:|Monto transferencia:|Monto pagado:|Ya enviamos tu transferencia|Pagaste\s*\$|Te suscribiste a|Has realizado una transferencia|Pago recibido|Comprobante de recibo transferencia|a tu cuenta Tenpo fue exitosa|pago de tu Tarjeta de Cr[eé]dito/i.test(text);
}
