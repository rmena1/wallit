'use server'

import { revalidatePath } from 'next/cache'
import { db, movements, categories, accounts } from '@/lib/db'
import { eq, and, desc } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'
import { createMovementSchema } from '@/lib/validations'
import { generateId } from '@/lib/utils'
import { convertUsdToClp } from '@/lib/exchange-rate'

export type MovementActionResult = {
  success: boolean
  error?: string
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
}): Promise<MovementActionResult> {
  const session = await requireAuth()

  // Verify account belongs to the current user (IDOR protection)
  if (data.accountId) {
    const [ownedAccount] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, session.id)))
      .limit(1)
    if (!ownedAccount) {
      return { success: false, error: 'Invalid account' }
    }
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

  await db
    .update(movements)
    .set({
      name: data.name,
      date: data.date,
      amount: data.amount,
      type: data.type,
      currency: data.currency,
      accountId: data.accountId,
      categoryId: data.categoryId,
      amountUsd: data.amountUsd,
      exchangeRate: data.exchangeRate,
      time: data.time,
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
  const data = hasMore ? results.slice(0, limit) : results

  return { data, hasMore }
}
