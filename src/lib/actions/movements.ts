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

  // Verify account belongs to the current user
  const [ownedAccount] = await db
    .select({ id: accounts.id })
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
  let finalAmount = amount
  let amountUsd: number | null = null
  let exchangeRate: number | null = null

  if (currency === 'USD') {
    try {
      const conversion = await convertUsdToClp(amount)
      amountUsd = amount
      finalAmount = conversion.clpCents
      exchangeRate = conversion.rate
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
