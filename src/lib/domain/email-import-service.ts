import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { accounts, categories, db, movements, spaces, spaceMemberships, transfers } from '@/lib/db'
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

export type EmailImportInput = EmailMovementImport | EmailTransferImport

type ImportResult = {
  success: boolean
  error?: string
  duplicate?: boolean
  movementId?: string
  transferId?: string
  sourceMovementId?: string
  destinationMovementId?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const PROVIDERS = new Set(['bci', 'tenpo', 'mercadopago'])
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

async function getImportAccount(userId: string, accountId: string) {
  const [account] = await db.select({
    id: accounts.id,
    spaceId: accounts.spaceId,
    currency: accounts.currency,
    bankName: accounts.bankName,
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
  const account = await getImportAccount(identity.userId, String(input.accountId ?? ''))
  if (!account) return fail('Account is not accessible by user')
  if (!(await categoryBelongsToSpace(input.categoryId, account.spaceId))) return fail('Category does not belong to account Space')

  let money: ReturnType<typeof normalizeMoney>
  try { money = normalizeMoney(input) } catch (error) { return fail(error instanceof Error ? error.message : 'Invalid money') }

  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(movements).values({
      id: generateId(),
      spaceId: account.spaceId,
      createdByUserId: identity.userId,
      categoryId: input.categoryId || null,
      accountId: account.id,
      name,
      date,
      amount: money.amount,
      type: input.type,
      needsReview: true,
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

async function importTransfer(input: EmailTransferImport): Promise<ImportResult> {
  const identity = normalizeIdentity(input)
  const date = normalizeDate(input.date)
  const [fromAccount, toAccount] = await Promise.all([
    getImportAccount(identity.userId, String(input.fromAccountId ?? '')),
    getImportAccount(identity.userId, String(input.toAccountId ?? '')),
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

  return db.transaction(async (tx) => {
    const sourceMovementId = generateId()
    const [insertedSource] = await tx.insert(movements).values({
      id: sourceMovementId,
      spaceId: fromAccount.spaceId,
      createdByUserId: identity.userId,
      accountId: fromAccount.id,
      name: sourceName,
      date,
      amount: sourceMoney.amount,
      type: 'expense',
      needsReview: true,
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
    await tx.insert(movements).values({
      id: destinationMovementId,
      spaceId: toAccount.spaceId,
      createdByUserId: identity.userId,
      accountId: toAccount.id,
      name: destinationName,
      date,
      amount: destinationMoney.amount,
      type: 'income',
      needsReview: true,
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

export async function importEmailTransaction(input: EmailImportInput): Promise<ImportResult> {
  try {
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
