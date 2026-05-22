'use server'

import { revalidatePath } from 'next/cache'
import { db, movements, categories, accounts } from '@/lib/db'
import { eq, and, desc, gte, isNull, lte, sql, type SQL } from 'drizzle-orm'
import { getCurrentSpace } from '@/lib/spaces'
import { createMovementSchema } from '@/lib/validations'
import { movementLedger, type AmountInputMode, type Currency, type MovementType } from '@/lib/domain/movement-ledger'
import { reportableMovementSqlFilters } from '@/lib/domain/reporting'

export type MovementActionResult = {
  success: boolean
  error?: string
}

export interface ReportCategoryMovement {
  id: string
  date: string
  name: string
  amount: number
  time: string | null
}

function revalidateMovementPaths() {
  revalidatePath('/')
  revalidatePath('/review')
  revalidatePath('/receivables')
  revalidatePath('/emergency')
  revalidatePath('/loans')
  revalidatePath('/reports')
}

/** Record a confirmed reportable movement from the manual add flow. */
export async function recordReportableMovement(formData: FormData): Promise<MovementActionResult> {
  const { user: session, space } = await getCurrentSpace()

  const rawData = {
    name: formData.get('name'),
    date: formData.get('date'),
    amount: parseInt(formData.get('amount') as string, 10),
    type: formData.get('type'),
    currency: (formData.get('currency') as string) || 'CLP',
  }
  const parsed = createMovementSchema.safeParse(rawData)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return { success: false, error: firstError?.message || 'Invalid input' }
  }

  const result = await movementLedger.recordReportableMovement(space.id, session.id, {
    ...parsed.data,
    amountInputMode: 'inputCurrency',
    type: parsed.data.type as MovementType,
    currency: parsed.data.currency as Currency,
    accountId: (formData.get('accountId') as string | null) || null,
    categoryId: (formData.get('categoryId') as string | null) || null,
    time: (formData.get('time') as string | null) || null,
    originalName: (formData.get('originalName') as string | null) || null,
    emergency: formData.get('emergency') === 'true' || formData.get('emergency') === 'on',
    loan: formData.get('loan') === 'true' || formData.get('loan') === 'on',
  })

  if (result.success) revalidateMovementPaths()
  return result
}

export async function reclassifyReportableMovement(id: string, data: {
  name: string
  date: string
  amount: number
  type: 'income' | 'expense'
  currency: 'CLP' | 'USD'
  accountId: string | null
  categoryId: string | null
  amountUsd: number | null
  exchangeRate: number | null
  amountInputMode?: AmountInputMode
  time?: string | null
  emergency?: boolean
  loan?: boolean
}): Promise<MovementActionResult> {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.reclassifyReportableMovement(space.id, id, {
    ...data,
    amountInputMode: data.amountInputMode ?? 'canonicalClp',
  })
  if (result.success) revalidateMovementPaths()
  return result
}

export async function deleteReportableMovement(id: string): Promise<MovementActionResult> {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.deleteReportableMovement(space.id, id)
  if (result.success) revalidateMovementPaths()
  return result
}

/**
 * Get a single movement by ID (with category/account info)
 */
export async function getMovementById(id: string) {
  const { user: session, space } = await getCurrentSpace()
  const results = await db
    .select({
      id: movements.id,
      spaceId: movements.spaceId,
      categoryId: movements.categoryId,
      accountId: movements.accountId,
      name: movements.name,
      date: movements.date,
      amount: movements.amount,
      type: movements.type,
      currency: movements.currency,
      amountUsd: movements.amountUsd,
      exchangeRate: movements.exchangeRate,
      receivable: movements.receivable,
      received: movements.received,
      needsReview: movements.needsReview,
      time: movements.time,
      originalName: movements.originalName,
      transferId: movements.transferId,
      transferPairId: movements.transferPairId,
      emergency: movements.emergency,
      emergencySettled: movements.emergencySettled,
      loan: movements.loan,
      loanSettled: movements.loanSettled,
      loanId: movements.loanId,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      accountBankName: accounts.bankName,
      accountLastFour: accounts.lastFourDigits,
    })
    .from(movements)
    .leftJoin(categories, and(eq(movements.categoryId, categories.id), eq(categories.spaceId, space.id)))
    .leftJoin(accounts, and(eq(movements.accountId, accounts.id), eq(accounts.spaceId, space.id)))
    .where(and(eq(movements.id, id), eq(movements.spaceId, space.id)))
  return results[0] || null
}

/**
 * Get all movements for the current user (with category info)
 */
export async function getMovements() {
  const { user: session, space } = await getCurrentSpace()

  return db
    .select({
      id: movements.id,
      spaceId: movements.spaceId,
      categoryId: movements.categoryId,
      accountId: movements.accountId,
      name: movements.name,
      date: movements.date,
      amount: movements.amount,
      type: movements.type,
      needsReview: movements.needsReview,
      currency: movements.currency,
      amountUsd: movements.amountUsd,
      exchangeRate: movements.exchangeRate,
      createdAt: movements.createdAt,
      updatedAt: movements.updatedAt,
      time: movements.time,
      originalName: movements.originalName,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      accountBankName: accounts.bankName,
      accountLastFour: accounts.lastFourDigits,
    })
    .from(movements)
    .leftJoin(categories, and(eq(movements.categoryId, categories.id), eq(categories.spaceId, space.id)))
    .leftJoin(accounts, and(eq(movements.accountId, accounts.id), eq(accounts.spaceId, space.id)))
    .where(eq(movements.spaceId, space.id))
    .orderBy(desc(movements.date), desc(movements.createdAt))
}

/**
 * Get expense movements for a report category within a selected period.
 */
export async function getReportCategoryMovements(
  startDate: string,
  endDate: string,
  categoryId: string | null,
  accountId?: string,
): Promise<ReportCategoryMovement[]> {
  const { user: session, space } = await getCurrentSpace()
  const [selectedAccount] = accountId
    ? await db.select({ id: accounts.id, currency: accounts.currency }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.spaceId, space.id))).limit(1)
    : []

  if (accountId && !selectedAccount) return []

  const reportAmount = selectedAccount?.currency === 'USD'
    ? sql<number>`COALESCE(${movements.amountUsd}, 0)`
    : sql<number>`${movements.amount}`

  const conditions: SQL[] = [
    ...reportableMovementSqlFilters(space.id),
    eq(movements.type, 'expense'),
    gte(movements.date, startDate),
    lte(movements.date, endDate),
    categoryId ? eq(movements.categoryId, categoryId) : isNull(movements.categoryId),
  ]
  if (accountId) conditions.push(eq(movements.accountId, accountId))

  const results = await db
    .select({ id: movements.id, date: movements.date, name: movements.name, amount: reportAmount, time: movements.time })
    .from(movements)
    .where(and(...conditions))
    .orderBy(desc(movements.date), desc(movements.time), desc(movements.createdAt))

  return results.map((movement) => ({ ...movement, amount: Number(movement.amount) }))
}

/**
 * Get paginated movements with optional filter.
 */
export async function getMovementsPaginated(
  offset: number,
  limit: number,
  filter: 'all' | 'receivables' = 'all'
) {
  const { user: session, space } = await getCurrentSpace()

  const baseSelect = {
    id: movements.id,
    spaceId: movements.spaceId,
    categoryId: movements.categoryId,
    accountId: movements.accountId,
    name: movements.name,
    date: movements.date,
    amount: movements.amount,
    amountUsd: movements.amountUsd,
    type: movements.type,
    createdAt: movements.createdAt,
    updatedAt: movements.updatedAt,
    categoryName: categories.name,
    categoryEmoji: categories.emoji,
    accountBankName: accounts.bankName,
    accountLastFour: accounts.lastFourDigits,
    accountColor: accounts.color,
    accountEmoji: accounts.emoji,
    currency: movements.currency,
    receivable: movements.receivable,
    received: movements.received,
    receivableId: movements.receivableId,
    time: movements.time,
    originalName: movements.originalName,
    transferId: movements.transferId,
    transferPairId: movements.transferPairId,
  }

  const whereCondition = filter === 'receivables'
    ? and(eq(movements.spaceId, space.id), eq(movements.receivable, true), eq(movements.received, false))
    : eq(movements.spaceId, space.id)

  const results = await db
    .select(baseSelect)
    .from(movements)
    .leftJoin(categories, and(eq(movements.categoryId, categories.id), eq(categories.spaceId, space.id)))
    .leftJoin(accounts, and(eq(movements.accountId, accounts.id), eq(accounts.spaceId, space.id)))
    .where(whereCondition)
    .orderBy(desc(movements.date), desc(movements.createdAt))
    .offset(offset)
    .limit(limit + 1)

  const hasMore = results.length > limit
  const rawData = hasMore ? results.slice(0, limit) : results
  const data = rawData.map((m) => ({ ...m, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString() }))

  return { data, hasMore }
}
