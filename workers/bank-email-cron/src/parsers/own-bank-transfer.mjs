import { parseTenpo } from './tenpo.mjs';
import { parseMercadoPago } from './mercadopago.mjs';
import { getProviderFromEmail, resolveTransferAccount } from '../lib/account-resolver.mjs';
import { parseEmailDate } from '../lib/date-utils.mjs';

// Only explicit bank-transfer templates may enter this path. A person's name
// in a purchase, repayment, salary or peer-payment notice is not sufficient.
const owner = name => /^(?:raimundomena|raimundomenaaguirre)$/.test(String(name).toLowerCase().replace(/\s+/g, ''));
const endpoint = (bank, number, product) => ({ bank, number: number || null, product: product || null,
  accountId: number ? resolveTransferAccount(bank, 'CLP', number) : null });
const amount = value => Number(value.replace(/\./g, '')) * 100;
const date = match => match && `${match[3]}-${match[2]}-${match[1]}`;

export function parseOwnBankTransfer(email) {
  const provider = getProviderFromEmail(email.from);
  const subjects = { tenpo: /^Comprobante de transferencia(?: exitoso)? - Tenpo$/i,
    bci: /^Aviso de Transferencia de Fondos\.$/i, mercadopago: /^Tu transferencia fue enviada$/i,
    mach: /^Realizaste una transferencia a /i };
  if (!subjects[provider]?.test(email.subject || '')) return null;
  const text = String(email.textBody || '').replace(/NÂº/g, 'Nº');
  let parsed, from, to, operationTime, reference;
  if (provider === 'tenpo' && /Monto transferencia:/i.test(text)) {
    parsed = parseTenpo(email);
    if (!parsed || parsed.routingAmbiguous || !owner(parsed.beneficiary)) return null;
    const tenpo = endpoint('tenpo', '0146', 'vista'); // verified mapping for “tu cuenta Tenpo”
    if (parsed.type === 'income' && parsed.sourceAccount && parsed.entity) {
      from = endpoint(parsed.entity, parsed.sourceAccount); to = tenpo;
    } else if (parsed.type === 'expense' && parsed.beneficiaryAccount && parsed.entity) {
      from = tenpo; to = endpoint(parsed.entity, parsed.beneficiaryAccount);
    } else return null;
    operationTime = text.match(/Hora:\s*(\d{2}:\d{2}:\d{2})/)?.[1];
    reference = text.match(/(?:Código|CÃ³digo) de transferencia:\s*(\d+)/)?.[1];
  } else if (provider === 'mercadopago' && /Ya enviamos tu transferencia de/i.test(text)) {
    parsed = parseMercadoPago(email);
    if (!parsed || !owner(parsed.beneficiary) || !parsed.beneficiaryAccount) return null;
    // The receipt omits the origin number; Rai confirmed this wallet is 1058236991.
    from = endpoint('mercadopago', '1058236991', 'wallet');
    to = endpoint(parsed.entity, parsed.beneficiaryAccount);
  } else if (provider === 'bci' && /Realizaste una transferencia de fondos desde tu cuenta N[°º]/i.test(text)) {
    const name = text.match(/Nombre del destinatario\s*(.+?)\s+Banco de destino/i)?.[1];
    if (!owner(name)) return null;
    const source = text.match(/desde tu cuenta N[°º]\s*(\d+)/i)?.[1];
    const bank = text.match(/Banco de destino\s*(.+?)\s+Cuenta de destino/i)?.[1];
    const target = text.match(/Cuenta de destino\s*(\d+)/i)?.[1];
    const value = text.match(/Monto transferido\s*\$\s*([\d.]+)/i)?.[1];
    if (!source || !bank || !target || !value) return null;
    const dt = parseEmailDate(email.date);
    const instant = new Date(email.date);
    operationTime = dt.time && !Number.isNaN(instant.getTime()) ? `${dt.time}:${String(instant.getUTCSeconds()).padStart(2, '0')}` : undefined;
    parsed = { provider, type: 'expense', currency: 'CLP', name, originalName: name,
      amount: amount(value), date: date(text.match(/Fecha de abono\s*(\d{2})\/(\d{2})\/(\d{4})/i)), time: dt.time };
    from = endpoint('bci', source); to = endpoint(bank, target);
    reference = text.match(/Número de comprobante\s*(\d+)/i)?.[1];
  } else if (provider === 'mach' && /desde tu cuenta\s+principal MACHBANK/i.test(text)) {
    const name = text.match(/Nombre destinatario\s+(.+?)\s+RUT/i)?.[1];
    if (!owner(name)) return null;
    const bank = text.match(/Banco destino\s+(.+?)\s+Cuenta destino/i)?.[1];
    const target = text.match(/Cuenta destino\s+(\d+)/i)?.[1];
    const value = text.match(/Monto\s+\$([\d.]+)/i)?.[1];
    if (!bank || !target || !value) return null;
    operationTime = text.match(/Fecha\s+\d{2}\/\d{2}\/\d{4}\s*-\s*(\d{2}:\d{2}:\d{2})/)?.[1];
    parsed = { provider, type: 'expense', currency: 'CLP', name, originalName: name,
      amount: amount(value), date: date(text.match(/Fecha\s+(\d{2})\/(\d{2})\/(\d{4})/)), time: operationTime?.slice(0, 5) };
    from = endpoint('mach', null, 'principal'); to = endpoint(bank, target);
    reference = text.match(/Código de confirmación\s+(\d+)/)?.[1];
  } else return null;
  return { ...parsed, ownBankTransfer: { from, to, operationTime: operationTime || null, reference: reference || null } };
}
