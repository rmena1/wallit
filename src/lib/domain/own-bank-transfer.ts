import { createHash } from 'node:crypto'

export type BankEndpoint = { bank: string; number: string | null; product: string | null; accountId: string | null }
export function normalizeBankEndpoint(value: BankEndpoint): BankEndpoint {
  if (!value || typeof value.bank !== 'string') throw new Error('Bank is required')
  let bank = value.bank.trim().toLowerCase()
  if (/^(?:banco\s+)?bci(?:\s*\/\s*mach)?$/.test(bank)) bank = 'bci'
  if (/^tenpo(?: banco| prepago(?: s\.a\.)?)?$/.test(bank)) bank = 'tenpo'
  if (/^mercado\s*pago$/.test(bank)) bank = 'mercadopago'
  if (!['bci', 'tenpo', 'mercadopago', 'mach'].includes(bank)) throw new Error('Unsupported transfer bank')
  const number = value.number === null ? null : String(value.number).trim()
  if (number !== null && !/^(?:[*xX•]*\d{4}|\d{5,})$/.test(number)) throw new Error('Invalid bank account number')
  const product = value.product === null ? null : String(value.product)
  if (product !== null && !['vista', 'wallet', 'principal'].includes(product)) throw new Error('Invalid bank product')
  if (!number && !product) throw new Error('Bank account or product is required')
  if (value.accountId !== null && (typeof value.accountId !== 'string' || !value.accountId.trim())) throw new Error('Invalid mapped account')
  if (value.accountId && !number) throw new Error('Mapped account number is required')
  return { bank, number, product, accountId: value.accountId }
}

// Seconds are required for cross-bank matching. Minute-only email timestamps
// must not collapse two independent transfers with the same amount on one day.
export function bankOperationKey(input: { from: BankEndpoint; to: BankEndpoint; amount: number; date: string;
  operationTime: string | null; reference: string | null; sourceEmailProvider: string; sourceEmailId: string }) {
  const { from, to, operationTime } = input
  if (operationTime !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(operationTime)) throw new Error('Invalid operation time')
  const endpoint = (value: BankEndpoint) => [value.bank, value.number?.slice(-4) || value.product]
  const facts = [input.date, input.amount, endpoint(from), endpoint(to)]
  const matching = from.number && to.number && operationTime
    ? ['bank-time', ...facts, operationTime]
    : input.reference ? ['reference', input.sourceEmailProvider, input.reference, ...facts]
      : ['email', input.sourceEmailProvider, input.sourceEmailId, ...facts]
  return createHash('sha256').update(JSON.stringify(matching)).digest('hex')
}
