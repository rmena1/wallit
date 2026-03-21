'use server'

import { revalidatePath } from 'next/cache'
import { db, movements, categories, accounts } from '@/lib/db'
import { eq, and, desc, gte, isNull, lte, or, type SQLWrapper, type SQL } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'
import { createMovementSchema } from '@/lib/validations'
import { generateId } from '@/lib/utils'
import { convertUsdToClp } from '@/lib/exchange-rate'

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

/**
 * Create a new movement
 */
export async function createMovement(formData: FormData): Promise<MovementActionResult> {
  const session = await requireAuth()
  
  const rawData = {
    name: formData.get('name'),
    date: formData.get('date'),
    amount: parseInt(formData.get('amount') as string, 10),
    type: formData.get('type'),
    currency: (formData.get('currency') as string) || 'CLP',
  }
  
  const categoryId = formData.get('categoryId') as string | null
  const accountId = formData.get('accountId') as string | null
  const time = (formData.get('time') as string | null) || null
  const originalName = (formData.get('originalName') as string | null) || null

  if (!accountId) {
    return { success: false, error: 'Account is required' }
  }

  // Verify account belongs to the current user and get its currency
  const [ownedAccount] = await db
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, session.id)))
    .limit(1)
  if (!ownedAccount) {
    return { success: false, error: 'Invalid account' }
  }

  // Verify category belongs to the current user (IDOR protection)
  if (categoryId) {
    const [ownedCategory] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, session.id)))
      .limit(1)
    if (!ownedCategory) {
      return { success: false, error: 'Invalid category' }
    }
  }
  
  // Validate input
  const parsed = createMovementSchema.safeParse(rawData)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return {
      success: false,
      error: firstError?.message || 'Invalid input',
    }
  }
  
  const { name, date, amount, type, currency } = parsed.data

  // Handle currency conversion
  // Ensures amountUsd is always set for USD accounts (required for correct balance calculation)
  let finalAmount = amount
  let amountUsd: number | null = null
  let exchangeRate: number | null = null

  if (currency === 'USD') {
    // USD input - convert to CLP for storage, keep USD in amountUsd
    try {
      const conversion = await convertUsdToClp(amount)
      amountUsd = amount
      finalAmount = conversion.clpCents
      exchangeRate = conversion.rate
    } catch {
      return { success: false, error: 'Error al obtener tipo de cambio' }
    }
  } else if (ownedAccount.currency === 'USD') {
    // CLP input on USD account - convert CLP to USD for amountUsd
    // This ensures balance calculation works correctly for USD accounts
    try {
      const { getUsdToClpRate } = await import('@/lib/exchange-rate')
      const rate = await getUsdToClpRate()
      amountUsd = Math.round(amount * 100 / rate) // Convert CLP cents to USD cents
      finalAmount = amount // Keep CLP cents in amount field
      exchangeRate = rate
    } catch {
      return { success: false, error: 'Error al obtener tipo de cambio' }
    }
  }
  
  // Create movement
  await db.insert(movements).values({
    id: generateId(),
    userId: session.id,
    categoryId: categoryId || null,
    accountId,
    name,
    date,
    amount: finalAmount,
    type,
    currency,
    amountUsd,
    exchangeRate,
    time,
    originalName,
  })
  
  revalidatePath('/')
  return { success: true }
}

/**
 * Get a single movement by ID (with category/account info)
 */
export async function getMovementById(id: string) {
  const session = await requireAuth()
  const results = await db
    .select({
      id: movements.id,
      userId: movements.userId,
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
    .leftJoin(categories, eq(movements.categoryId, categories.id))
    .leftJoin(accounts, eq(movements.accountId, accounts.id))
    .where(and(eq(movements.id, id), eq(movements.userId, session.id)))
  return results[0] || null
}

/**
 * Update an existing movement
 */
export async function updateMovement(id: string, data: {
  name: string
  date: string
  amount: number
  type: 'income' | 'expense'
  currency: 'CLP' | 'USD'
  accountId: string | null
  categoryId: string | null
  amountUsd: number | null
  exchangeRate: number | null
  time?: string | null
  emergency?: boolean
  loan?: boolean
}): Promise<MovementActionResult> {
  const session = await requireAuth()

  // Verify account belongs to the current user and get its currency (IDOR protection)
  let accountCurrency: 'CLP' | 'USD' | null = null
  if (data.accountId) {
    const [ownedAccount] = await db
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, session.id)))
      .limit(1)
    if (!ownedAccount) {
      return { success: false, error: 'Invalid account' }
    }
    accountCurrency = ownedAccount.currency
  }

  // Verify category belongs to the current user (IDOR protection)
  if (data.categoryId) {
    const [ownedCategory] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, data.categoryId), eq(categories.userId, session.id)))
      .limit(1)
    if (!ownedCategory) {
      return { success: false, error: 'Invalid category' }
    }
  }

  // Handle currency conversion to ensure amountUsd is correctly set for USD accounts
  // This mirrors the logic in createMovement to prevent balance calculation bugs
  let finalAmount = data.amount
  let finalAmountUsd = data.amountUsd
  let finalExchangeRate = data.exchangeRate

  if (data.currency === 'USD') {
    // USD input - convert to CLP for storage, keep USD in amountUsd
    if (!data.amountUsd) {
      // amountUsd not provided but currency is USD - use amount as amountUsd and convert
      try {
        const conversion = await convertUsdToClp(data.amount)
        finalAmountUsd = data.amount
        finalAmount = conversion.clpCents
        finalExchangeRate = conversion.rate
      } catch {
        return { success: false, error: 'Error al obtener tipo de cambio' }
      }
    }
  } else if (accountCurrency === 'USD' && data.currency === 'CLP') {
    // CLP input on USD account - convert CLP to USD for amountUsd
    // This ensures balance calculation works correctly for USD accounts
    if (!data.amountUsd) {
      try {
        const { getUsdToClpRate } = await import('@/lib/exchange-rate')
        const rate = await getUsdToClpRate()
        finalAmountUsd = Math.round(data.amount * 100 / rate) // Convert CLP cents to USD cents
        finalExchangeRate = rate
      } catch {
        return { success: false, error: 'Error al obtener tipo de cambio' }
      }
    }
  }

  await db
    .update(movements)
    .set({
      name: data.name,
      date: data.date,
      amount: finalAmount,
      type: data.type,
      currency: data.currency,
      accountId: data.accountId,
      categoryId: data.categoryId,
      amountUsd: finalAmountUsd,
      exchangeRate: finalExchangeRate,
      time: data.time,
      ...(data.emergency !== undefined ? { emergency: data.emergency } : {}),
      ...(data.emergency === false ? { emergencySettled: false } : {}),
      ...(data.type === 'expense' ? { loan: false, loanSettled: false } : {}),
      ...(data.type === 'income' ? { loanId: null } : {}),
      ...(data.type === 'income' && data.loan !== undefined ? { loan: data.loan } : {}),
      ...(data.type === 'income' && data.loan === false ? { loanSettled: false } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(movements.id, id), eq(movements.userId, session.id)))
  revalidatePath('/')
  return { success: true }
}

/**
 * Delete a movement
 */
export async function deleteMovement(id: string): Promise<MovementActionResult> {
  const session = await requireAuth()
  
  await db.delete(movements).where(
    and(
      eq(movements.id, id),
      eq(movements.userId, session.id)
    )
  )
  
  revalidatePath('/')
  return { success: true }
}

/**
 * Get all movements for the current user (with category info)
 */
export async function getMovements() {
  const session = await requireAuth()
  
  return db
    .select({
      id: movements.id,
      userId: movements.userId,
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
    .leftJoin(categories, eq(movements.categoryId, categories.id))
    .leftJoin(accounts, eq(movements.accountId, accounts.id))
    .where(eq(movements.userId, session.id))
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
  const session = await requireAuth()

  const conditions: SQL[] = [
    eq(movements.userId, session.id),
    eq(movements.type, 'expense'),
    gte(movements.date, startDate),
    lte(movements.date, endDate),
    or(eq(movements.receivable, false), isNull(movements.receivable))!,
    isNull(movements.receivableId),
    isNull(movements.transferId),
    or(eq(movements.emergency, false), isNull(movements.emergency))!,
    or(eq(movements.loan, false), isNull(movements.loan))!,
    isNull(movements.loanId),
    categoryId ? eq(movements.categoryId, categoryId) : isNull(movements.categoryId),
  ]
  if (accountId) conditions.push(eq(movements.accountId, accountId))

  const results = await db
    .select({
      id: movements.id,
      date: movements.date,
      name: movements.name,
      amount: movements.amount,
      time: movements.time,
    })
    .from(movements)
    .where(and(...conditions))
    .orderBy(desc(movements.date), desc(movements.time), desc(movements.createdAt))

  return results.map((movement) => ({
    ...movement,
    amount: Number(movement.amount),
  }))
}

/**
 * Get paginated movements with optional filter
 * @param offset - number of records to skip
 * @param limit - number of records to return
 * @param filter - 'all' for all movements, 'receivables' for only pending receivables
 */
export async function getMovementsPaginated(
  offset: number,
  limit: number,
  filter: 'all' | 'receivables' = 'all'
) {
  const session = await requireAuth()
  
  const baseSelect = {
    id: movements.id,
    userId: movements.userId,
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
    ? and(
        eq(movements.userId, session.id),
        eq(movements.receivable, true),
        eq(movements.received, false)
      )
    : eq(movements.userId, session.id)

  const results = await db
    .select(baseSelect)
    .from(movements)
    .leftJoin(categories, eq(movements.categoryId, categories.id))
    .leftJoin(accounts, eq(movements.accountId, accounts.id))
    .where(whereCondition)
    .orderBy(desc(movements.date), desc(movements.createdAt))
    .offset(offset)
    .limit(limit + 1) // Fetch one extra to know if there's more

  const hasMore = results.length > limit
  const rawData = hasMore ? results.slice(0, limit) : results
  
  // Serialize Date fields for client component
  const data = rawData.map((m) => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }))

  return { data, hasMore }
}
