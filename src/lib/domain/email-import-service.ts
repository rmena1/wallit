import { insertLedgerMovements } from '@/lib/domain/ledger-insert'
import { normalizeBankEndpoint, bankOperationKey, type BankEndpoint } from './own-bank-transfer'
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { accounts, categories, db, movements, spaces, spaceMemberships, transfers, ownBankTransferImports, ownBankTransferReceipts } from '@/lib/db'
import { expectedClpCents } from '@/lib/domain/money'
import { generateId } from '@/lib/utils'

type Currency = 'CLP' | 'USD'
type MovementType = 'income' | 'expense'

type MoneyFacts = {
  currency?: Currency
  amount?: number
  amountUsd?: number
  exchangeRate?: number
}

type SourceIdentity = {
  userId: string
  sourceEmailProvider: string
  sourceEmailId: string
}

export type EmailMovementImport = SourceIdentity & MoneyFacts & {
  kind: 'movement'
  needsReview?: boolean
  accountId: string
  categoryId?: string | null
  name: string
  date: string
  type: MovementType
  time?: string | null
  originalName?: string | null
}

export type EmailTransferImport = SourceIdentity & MoneyFacts & {
  kind: 'transfer'
  fromAccountId: string
  toAccountId: string
  toCurrency?: Currency
  toAmount?: number
  toAmountUsd?: number
  toExchangeRate?: number
  date: string
  time?: string | null
  originalName?: string | null
  sourceName?: string
  destinationName?: string
}

export type OwnBankTransferImport = SourceIdentity & {
  kind: 'own-bank-transfer'
  currency: 'CLP'
  amount: number
  date: string
  time?: string | null
  originalName?: string | null
  from: BankEndpoint
  to: BankEndpoint
  operationTime: string | null
  reference: string | null
}
export type EmailImportInput = EmailMovementImport | EmailTransferImport | OwnBankTransferImport

type ImportResult = {
  success: boolean
  error?: string
  duplicate?: boolean
  movementId?: string
  pendingAccounts?: boolean
  bankTransferImportId?: string
  transferId?: string
  sourceMovementId?: string
  destinationMovementId?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const PROVIDERS = new Set(['bci', 'tenpo', 'mercadopago', 'mach'])
const PG_INTEGER_MAX = 2_147_483_647

function fail(error: string): ImportResult {
  return { success: false, error }
}

function positiveSafeInteger(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer`)
  if ((value as number) > max) throw new Error(`${label} is outside the database integer range`)
  return value as number
}

function normalizeIdentity(input: SourceIdentity) {
  const userId = String(input.userId ?? '').trim()
  const provider = String(input.sourceEmailProvider ?? '').trim().toLowerCase()
  const emailId = String(input.sourceEmailId ?? '').trim().replace(/^<|>$/g, '')
  if (!userId) throw new Error('userId is required')
  if (!PROVIDERS.has(provider)) throw new Error('Unsupported source email provider')
  if (!emailId) throw new Error('sourceEmailId is required')
  return { userId, provider, emailId }
}

function normalizeDate(value: unknown): string {
  const date = String(value ?? '')
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!DATE_RE.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('date must be a valid YYYY-MM-DD')
  }
  return date
}

function normalizeMoney(input: MoneyFacts) {
  const currency = input.currency ?? 'CLP'
  if (currency === 'USD') {
    const amountUsd = positiveSafeInteger(input.amountUsd, 'amountUsd', PG_INTEGER_MAX)
    const exchangeRate = positiveSafeInteger(input.exchangeRate, 'exchangeRate', PG_INTEGER_MAX)
    return { currency, amount: expectedClpCents(amountUsd, exchangeRate), amountUsd, exchangeRate }
  }
  if (currency !== 'CLP') throw new Error('Unsupported currency')
  return { currency, amount: positiveSafeInteger(input.amount, 'amount'), amountUsd: null, exchangeRate: null }
}

async function getImportAccount(userId: string, accountId: string, executor: Pick<typeof db, 'select'> = db) {
  const [account] = await executor.select({
    id: accounts.id,
    spaceId: accounts.spaceId,
    currency: accounts.currency,
    bankName: accounts.bankName,
    lastFourDigits: accounts.lastFourDigits,
  }).from(accounts)
    .innerJoin(spaces, and(eq(spaces.id, accounts.spaceId), sql`${spaces.archivedAt} IS NULL`))
    .innerJoin(spaceMemberships, and(eq(spaceMemberships.spaceId, accounts.spaceId), eq(spaceMemberships.userId, userId)))
    .where(eq(accounts.id, accountId))
    .limit(1)
  return account ?? null
}

async function categoryBelongsToSpace(categoryId: string | null | undefined, spaceId: string): Promise<boolean> {
  if (!categoryId) return true
  const [category] = await db.select({ id: categories.id }).from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.spaceId, spaceId)))
    .limit(1)
  return Boolean(category)
}

async function importMovement(input: EmailMovementImport): Promise<ImportResult> {
  const identity = normalizeIdentity(input)
  const date = normalizeDate(input.date)
  const name = String(input.name ?? '').trim()
  if (!name) return fail('name is required')
  if (!['income', 'expense'].includes(input.type)) return fail('type must be income or expense')
  if (input.needsReview !== undefined && typeof input.needsReview !== 'boolean') return fail('needsReview must be a boolean')
  const account = await getImportAccount(identity.userId, String(input.accountId ?? ''))
  if (!account) return fail('Account is not accessible by user')
  if (!(await categoryBelongsToSpace(input.categoryId, account.spaceId))) {
    // Email history is account-wide. A foreign category is valid only when
    // this user's exact raw name already carries it (excluding this import).
    const [historical] = input.type === 'expense' && input.originalName && input.categoryId
      ? await db.select({ id: movements.id }).from(movements)
        .where(and(
          eq(movements.createdByUserId, identity.userId),
          eq(movements.originalName, input.originalName),
          eq(movements.categoryId, input.categoryId),
          sql`NOT (${movements.sourceEmailProvider} IS NOT DISTINCT FROM ${identity.provider}
            AND ${movements.sourceEmailId} IS NOT DISTINCT FROM ${identity.emailId})`,
        )).limit(1)
      : []
    if (!historical) return fail('Category does not belong to account Space')
  }

  let money: ReturnType<typeof normalizeMoney>
  try { money = normalizeMoney(input) } catch (error) { return fail(error instanceof Error ? error.message : 'Invalid money') }

  return db.transaction(async (tx) => {
    const [inserted] = await insertLedgerMovements(tx).values({
      id: generateId(),
      spaceId: account.spaceId,
      createdByUserId: identity.userId,
      categoryId: input.categoryId || null,
      accountId: account.id,
      name,
      date,
      amount: money.amount,
      type: input.type,
      needsReview: input.needsReview ?? true,
      currency: money.currency,
      amountUsd: money.amountUsd,
      exchangeRate: money.exchangeRate,
      time: input.time || null,
      originalName: input.originalName || null,
      sourceEmailProvider: identity.provider,
      sourceEmailId: identity.emailId,
    }).onConflictDoNothing({
      target: [movements.createdByUserId, movements.sourceEmailProvider, movements.sourceEmailId],
      where: isNotNull(movements.sourceEmailId),
    }).returning({ id: movements.id })

    if (inserted) return { success: true, duplicate: false, movementId: inserted.id }
    const [existing] = await tx.select({ id: movements.id }).from(movements)
      .where(and(
        eq(movements.createdByUserId, identity.userId),
        eq(movements.sourceEmailProvider, identity.provider),
        eq(movements.sourceEmailId, identity.emailId),
      )).limit(1)
    if (!existing) return fail('Import identity conflict could not be resolved')
    const [transfer] = await tx.select({ id: transfers.id }).from(transfers)
      .where(eq(transfers.sourceMovementId, existing.id)).limit(1)
    if (transfer) return fail('Email was already imported as a transfer')
    return { success: true, duplicate: true, movementId: existing.id }
  })
}

async function importTransfer(input: EmailTransferImport, executor: Pick<typeof db, 'transaction' | 'select'> = db): Promise<ImportResult> {
  const identity = normalizeIdentity(input)
  const date = normalizeDate(input.date)
  const [fromAccount, toAccount] = await Promise.all([
    getImportAccount(identity.userId, String(input.fromAccountId ?? ''), executor),
    getImportAccount(identity.userId, String(input.toAccountId ?? ''), executor),
  ])
  if (!fromAccount || !toAccount) return fail('Transfer account is not accessible by user')
  if (fromAccount.id === toAccount.id) return fail('Transfer accounts must be different')

  let sourceMoney: ReturnType<typeof normalizeMoney>
  let destinationMoney: ReturnType<typeof normalizeMoney>
  try {
    sourceMoney = normalizeMoney(input)
    const toCurrency = input.toCurrency ?? sourceMoney.currency
    destinationMoney = normalizeMoney({
      currency: toCurrency,
      amount: input.toAmount ?? sourceMoney.amount,
      amountUsd: input.toAmountUsd ?? (toCurrency === sourceMoney.currency ? sourceMoney.amountUsd ?? undefined : undefined),
      exchangeRate: input.toExchangeRate ?? (toCurrency === sourceMoney.currency ? sourceMoney.exchangeRate ?? undefined : undefined),
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Invalid transfer money')
  }

  const sourceName = String(input.sourceName ?? `Transferencia a ${toAccount.bankName}`).trim()
  const destinationName = String(input.destinationName ?? `Transferencia desde ${fromAccount.bankName}`).trim()

  return executor.transaction(async (tx) => {
    const sourceMovementId = generateId()
    const [insertedSource] = await insertLedgerMovements(tx).values({
      id: sourceMovementId,
      spaceId: fromAccount.spaceId,
      createdByUserId: identity.userId,
      accountId: fromAccount.id,
      name: sourceName,
      date,
      amount: sourceMoney.amount,
      type: 'expense',
      needsReview: fromAccount.spaceId !== toAccount.spaceId,
      reportable: fromAccount.spaceId !== toAccount.spaceId,
      currency: sourceMoney.currency,
      amountUsd: sourceMoney.amountUsd,
      exchangeRate: sourceMoney.exchangeRate,
      time: input.time || null,
      originalName: input.originalName || null,
      sourceEmailProvider: identity.provider,
      sourceEmailId: identity.emailId,
    }).onConflictDoNothing({
      target: [movements.createdByUserId, movements.sourceEmailProvider, movements.sourceEmailId],
      where: isNotNull(movements.sourceEmailId),
    }).returning({ id: movements.id })

    if (!insertedSource) {
      const [existing] = await tx.select({
        transferId: transfers.id,
        sourceMovementId: transfers.sourceMovementId,
        destinationMovementId: transfers.destinationMovementId,
      }).from(movements)
        .innerJoin(transfers, eq(transfers.sourceMovementId, movements.id))
        .where(and(
          eq(movements.createdByUserId, identity.userId),
          eq(movements.sourceEmailProvider, identity.provider),
          eq(movements.sourceEmailId, identity.emailId),
        )).limit(1)
      if (!existing) return fail('Email was already imported as a non-transfer movement')
      return { success: true, duplicate: true, ...existing }
    }

    const destinationMovementId = generateId()
    const transferId = generateId()
    await insertLedgerMovements(tx).values({
      id: destinationMovementId,
      spaceId: toAccount.spaceId,
      createdByUserId: identity.userId,
      accountId: toAccount.id,
      name: destinationName,
      date,
      amount: destinationMoney.amount,
      type: 'income',
      needsReview: fromAccount.spaceId !== toAccount.spaceId,
      reportable: fromAccount.spaceId !== toAccount.spaceId,
      currency: destinationMoney.currency,
      amountUsd: destinationMoney.amountUsd,
      exchangeRate: destinationMoney.exchangeRate,
      time: input.time || null,
      originalName: input.originalName || null,
    })
    await tx.insert(transfers).values({
      id: transferId,
      sourceSpaceId: fromAccount.spaceId,
      destinationSpaceId: toAccount.spaceId,
      sourceMovementId,
      destinationMovementId,
      createdByUserId: identity.userId,
    })
    return { success: true, duplicate: false, transferId, sourceMovementId, destinationMovementId }
  })
}

async function importOwnBankTransfer(input: OwnBankTransferImport): Promise<ImportResult> {
  const identity = normalizeIdentity(input)
  const date = normalizeDate(input.date)
  if (input.currency !== 'CLP') return fail('Unsupported bank transfer currency')
  const money = normalizeMoney(input)
  const from = normalizeBankEndpoint(input.from)
  const to = normalizeBankEndpoint(input.to)
  if (from.bank === to.bank && from.number && from.number === to.number) return fail('Transfer accounts must be different')
  if (input.reference !== null && (typeof input.reference !== 'string' || !/^\d{1,64}$/.test(input.reference))) return fail('Invalid transfer reference')
  for (const endpoint of [from, to]) {
    if (!endpoint.accountId) continue
    const account = await getImportAccount(identity.userId, endpoint.accountId)
    if (!account) return fail('Transfer account is not accessible by user')
    const bank = normalizeBankEndpoint({ ...endpoint, bank: account.bankName }).bank
    if (bank !== endpoint.bank || account.currency !== 'CLP' || account.lastFourDigits !== endpoint.number?.slice(-4)) {
      return fail('Mapped bank account does not match email evidence')
    }
  }
  const operationKey = bankOperationKey({ ...input, from, to, date, amount: money.amount,
    sourceEmailProvider: identity.provider, sourceEmailId: identity.emailId })
  return db.transaction(async tx => {
    // Serialize imports for one user, including retries with different email IDs.
    // The ledger pair and evidence are committed together or rolled back together.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${identity.userId}, 19019))`)
    const [receipt] = await tx.select({ record: ownBankTransferImports }).from(ownBankTransferReceipts)
      .innerJoin(ownBankTransferImports, eq(ownBankTransferImports.id, ownBankTransferReceipts.importId))
      .where(and(eq(ownBankTransferReceipts.createdByUserId, identity.userId),
        eq(ownBankTransferReceipts.provider, identity.provider), eq(ownBankTransferReceipts.emailId, identity.emailId))).limit(1)
    const [operation] = await tx.select().from(ownBankTransferImports).where(and(
      eq(ownBankTransferImports.createdByUserId, identity.userId), eq(ownBankTransferImports.operationKey, operationKey))).limit(1)
    let record = receipt?.record ?? operation
    const duplicate = Boolean(record)
    if (receipt && receipt.record.operationKey !== operationKey) throw new Error('Conflicting bank transfer retry')
    if (record && !receipt) {
      const [sameProvider] = await tx.select().from(ownBankTransferReceipts).where(and(
        eq(ownBankTransferReceipts.importId, record.id), eq(ownBankTransferReceipts.provider, identity.provider))).limit(1)
      if (sameProvider && sameProvider.reference !== input.reference) throw new Error('Ambiguous bank transfer match')
    }
    // An operation match is not enough: this particular bank notice may already
    // have an ordinary movement from the old importer. Never acknowledge it as
    // a duplicate while leaving that separate debit/credit in the ledger.
    const [previousMovement] = await tx.select({ id: movements.id, transferId: transfers.id }).from(movements)
      .leftJoin(transfers, or(eq(transfers.sourceMovementId, movements.id), eq(transfers.destinationMovementId, movements.id)))
      .where(and(eq(movements.createdByUserId, identity.userId), eq(movements.sourceEmailProvider, identity.provider),
        eq(movements.sourceEmailId, identity.emailId))).limit(1)
    if (previousMovement && (!previousMovement.transferId
      || (record && previousMovement.transferId !== record.transferId)
      || !from.accountId || !to.accountId)) {
      throw new Error('Email was already imported as a separate movement; reconciliation required')
    }
    if (!record) {
      // Also stop before creating either side when a prior bank movement could
      // be the counterpart. Minute precision is only a conflict warning here,
      // never evidence to merge or reclassify an existing movement automatically.
      const time = input.operationTime?.slice(0, 5) || input.time
      if (time && from.accountId && to.accountId) {
        const [legacyCounterpart] = await tx.select({ id: movements.id }).from(movements)
          .leftJoin(transfers, or(eq(transfers.sourceMovementId, movements.id), eq(transfers.destinationMovementId, movements.id)))
          .where(and(eq(movements.createdByUserId, identity.userId), eq(movements.date, date),
            eq(movements.amount, money.amount), eq(movements.currency, 'CLP'), eq(movements.time, time),
            isNotNull(movements.sourceEmailId), isNull(transfers.id),
            or(and(eq(movements.accountId, from.accountId), eq(movements.type, 'expense'), eq(movements.sourceEmailProvider, from.bank)),
              and(eq(movements.accountId, to.accountId), eq(movements.type, 'income'), eq(movements.sourceEmailProvider, to.bank))),
          )).limit(1)
        if (legacyCounterpart) throw new Error('Possible previously imported bank counterpart; reconciliation required')
      }
      let transferId: string | null = null
      if (from.accountId && to.accountId) {
        const linked = await importTransfer({ ...input, kind: 'transfer', fromAccountId: from.accountId,
          toAccountId: to.accountId }, tx)
        if (!linked.success || !linked.transferId) throw new Error(linked.error || 'Bank transfer import failed')
        transferId = linked.transferId
      }
      const [insertedRecord] = await tx.insert(ownBankTransferImports).values({
        id: generateId(), createdByUserId: identity.userId, operationKey, date, time: input.operationTime || input.time || null,
        amount: money.amount, currency: 'CLP', fromBank: from.bank, fromNumber: from.number, fromProduct: from.product,
        fromAccountId: from.accountId, toBank: to.bank, toNumber: to.number, toProduct: to.product,
        toAccountId: to.accountId, transferId, status: transferId ? 'linked' : 'pending_accounts',
      }).returning()
      record = insertedRecord
    }
    if (!receipt) await tx.insert(ownBankTransferReceipts).values({ id: generateId(), importId: record.id,
      createdByUserId: identity.userId, provider: identity.provider, emailId: identity.emailId, reference: input.reference })
    return { success: true, duplicate, bankTransferImportId: record.id,
      pendingAccounts: record.status === 'pending_accounts', ...(record.transferId ? { transferId: record.transferId } : {}) }
  })
}

export async function importEmailTransaction(input: EmailImportInput): Promise<ImportResult> {
  try {
    if (input?.kind === 'own-bank-transfer') return await importOwnBankTransfer(input)
    if (input?.kind === 'movement') return await importMovement(input)
    if (input?.kind === 'transfer') return await importTransfer(input)
    return fail('Unsupported import kind')
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown error'
    console.error('Email import service failed', errorMessage)
    
    // Return specific validation errors to help with debugging
    if (error instanceof Error && (
      errorMessage.includes('is required') ||
      errorMessage.includes('must be') ||
      errorMessage.includes('Unsupported') ||
      errorMessage.includes('is outside') ||
      errorMessage.includes('does not belong')
    )) {
      return fail(errorMessage)
    }
    
    // Generic error for unexpected failures
    return fail('Import failed')
  }
}
