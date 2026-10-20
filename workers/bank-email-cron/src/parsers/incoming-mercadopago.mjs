import { senderAddress, getProviderFromEmail } from '../lib/sender-auth.mjs';
import { isOwnerName } from '../lib/owner-identity.mjs';
const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Destination fields only: a payer's name/account must never establish ownership.
export function parseIncomingMercadoPago(email) {
  const sender = senderAddress(email.from);
  const text = String(email.textBody || '').replace(/\s+/g, ' ').trim();
  let owner, account, bank, payer, amount, bodyDate, operationTime;
  if (sender === 'transferencias@bci.cl' && /Has recibido una transferencia de fondos/i.test(text)) {
    owner = text.match(/\bHola\s+(.+?)\s+Has recibido/i)?.[1];
    const notice = text.match(/Has recibido una transferencia de fondos de (.+?) hacia tu cuenta del (.+?) Datos de la transferencia/i);
    payer = notice?.[1]; bank = notice?.[2];
    amount = text.match(/Monto recibido\s*\$\s*([\d.]+)(?=\s|$)/i)?.[1];
    bodyDate = text.match(/Fecha de la transferencia\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  } else if (sender === 'mensajeria@santander.cl' && /realizó una transferencia a tu cuenta/i.test(text)) {
    payer = text.match(/nuestro cliente (.+?) realizó una transferencia/i)?.[1];
    const dest = text.match(/Datos de destino Nombre (.+?) RUT .+? Banco (.+?) Nº de cuenta\s*([\d*-]+)\s*Comentario/i);
    owner = dest?.[1]?.replace(/\s+Prepago$/i, ''); bank = dest?.[2]; account = dest?.[3];
    amount = text.match(/Monto transferido\s*\$\s*([\d.]+)(?=\s|$)/i)?.[1];
    bodyDate = text.match(/con fecha (\d{2})\/(\d{2})\/(\d{4})/i);
  } else if (sender === 'serviciodetransferencias@bancochile.cl' && /ha efectuado una transferencia de fondos a tu cuenta/i.test(text)) {
    payer = text.match(/cliente (.+?) ha efectuado/i)?.[1];
    const dest = text.match(/Datos de destinatario Nombre y Apellido (.+?) Rut .+? Email \S+ Banco (.+?) Cuenta destino Cuenta Vista\s+([\d*-]+)/i);
    owner = dest?.[1]; bank = dest?.[2]; account = dest?.[3];
    amount = text.match(/\bMonto\s*\$\s*([\d.]+)(?=\s|$)/i)?.[1];
    bodyDate = text.match(/Datos de cuenta Fecha (\d{2})\/(\d{2})\/(\d{4})/i);
    const operation = text.match(/Fecha y Hora:\s*\S+ (\d{1,2}) de ([a-z]+) de (\d{4}) (\d{2}:\d{2})/i);
    if (operation) {
      const month = String(months.indexOf(operation[2].toLowerCase().slice(0, 3)) + 1).padStart(2, '0');
      if (bodyDate && (bodyDate[1] !== operation[1].padStart(2, '0') || bodyDate[2] !== month || bodyDate[3] !== operation[3])) throw new Error('parser_ambiguous_date');
      operationTime = operation[4];
    }
  } else if (sender === 'reply@info.bice.cl' && /Recibiste una transferencia por:/i.test(text)) {
    payer = text.match(/Cuenta de origen Nombre (.+?) Banco /i)?.[1];
    const dest = text.match(/Cuenta de destino Banco (.+?) Tipo de cuenta CUENTA VISTA Número de cuenta\s+([\d*-]+)/i);
    bank = dest?.[1]; account = dest?.[2];
    const operation = text.match(/\b(\d{1,2}) (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic) (\d{4}) - (\d{2}:\d{2}) h\b/i);
    if (operation) {
      bodyDate = [operation[0], operation[1].padStart(2, '0'), String(months.indexOf(operation[2].toLowerCase()) + 1).padStart(2, '0'), operation[3]];
      operationTime = operation[4];
    }
    amount = text.match(/\bMonto\s*\$\s*([\d.]+)(?=\s|$)/i)?.[1];
  } else return null;
  const digits = account?.replace(/-/g, '');
  // Contradictory evidence is a skip even if another ownership signal matches.
  if (!/^Mercado\s*Pago$/i.test(bank || '') || (owner && !isOwnerName(owner))
    || (digits && !/6991$/.test(digits)) || (!owner && !digits)) {
    return { skipReason: 'incoming_destination_not_owner' };
  }
  if (!payer || !amount || !/^\d+(?:\.\d{3})*$/.test(amount)) return { skipReason: 'parser_no_match' };
  // Header timestamps describe notification delivery, never the bank operation.
  if (!bodyDate) return { skipReason: 'parser_no_match' };
  return { incomingBankTransfer: true, provider: getProviderFromEmail(email.from),
    type: 'income', currency: 'CLP', amount: Number(amount.replaceAll('.', '')) * 100,
    name: payer, originalName: `Transferencia de ${payer}`, last4: '6991',
    date: `${bodyDate[3]}-${bodyDate[2]}-${bodyDate[1]}`, time: operationTime };
}
