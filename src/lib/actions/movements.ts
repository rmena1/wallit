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

  if (!accountId) {
    return { success: false, error: 'Account is required' }
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
  })
  
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
