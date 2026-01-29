'use server'

import { revalidatePath } from 'next/cache'
import { db, movements, categories, accounts } from '@/lib/db'
import { eq, and, desc, sql } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'

export async function getPendingReviewCount() {
  const session = await requireAuth()
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(movements)
    .where(and(eq(movements.userId, session.id), eq(movements.needsReview, true)))
  return result[0]?.count ?? 0
}

export async function getPendingReviewMovements() {
  const session = await requireAuth()
  return db
    .select({
      id: movements.id,
      name: movements.name,
      date: movements.date,
      amount: movements.amount,
      type: movements.type,
      currency: movements.currency,
      amountUsd: movements.amountUsd,
      exchangeRate: movements.exchangeRate,
      categoryId: movements.categoryId,
      accountId: movements.accountId,
      needsReview: movements.needsReview,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      accountBankName: accounts.bankName,
      accountLastFour: accounts.lastFourDigits,
    })
    .from(movements)
    .leftJoin(categories, eq(movements.categoryId, categories.id))
    .leftJoin(accounts, eq(movements.accountId, accounts.id))
    .where(and(eq(movements.userId, session.id), eq(movements.needsReview, true)))
    .orderBy(desc(movements.date), desc(movements.createdAt))
}

export async function confirmMovement(id: string, data: {
  name: string
  date: string
  amount: number
  type: 'income' | 'expense'
  currency: 'CLP' | 'USD'
  accountId: string | null
  categoryId: string | null
  amountUsd: number | null
  exchangeRate: number | null
}) {
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
      needsReview: false,
      updatedAt: new Date(),
    })
    .where(and(eq(movements.id, id), eq(movements.userId, session.id)))
  
  revalidatePath('/')
  revalidatePath('/review')
  return { success: true }
}

export async function deleteReviewMovement(id: string) {
  const session = await requireAuth()
  await db.delete(movements).where(and(eq(movements.id, id), eq(movements.userId, session.id)))
  revalidatePath('/')
  revalidatePath('/review')
  return { success: true }
}

export async function markAsReceivable(id: string, reminderText: string) {
  const session = await requireAuth()
  await db
    .update(movements)
    .set({
      name: reminderText,
      receivable: true,
      needsReview: false,
      updatedAt: new Date(),
    })
    .where(and(eq(movements.id, id), eq(movements.userId, session.id)))
  revalidatePath('/')
  revalidatePath('/review')
  return { success: true }
}

export async function splitMovement(originalId: string, splits: { name: string; amount: number }[]) {
  const session = await requireAuth()
  
  // Get original movement
  const [original] = await db
    .select()
    .from(movements)
    .where(and(eq(movements.id, originalId), eq(movements.userId, session.id)))
  
  if (!original) throw new Error('Movement not found')

  const { generateId } = await import('@/lib/utils')
  const totalOriginal = original.amount
  
  // Delete original
  await db.delete(movements).where(eq(movements.id, originalId))
  
  // Create split movements
  for (const split of splits) {
    const proportion = totalOriginal !== 0 ? split.amount / totalOriginal : 0
    await db.insert(movements).values({
      id: generateId(),
      userId: session.id,
      categoryId: original.categoryId,
      accountId: original.accountId,
      name: split.name,
      date: original.date,
      amount: split.amount,
      type: original.type,
      currency: original.currency,
      amountUsd: original.currency === 'USD' && original.amountUsd
        ? Math.round(original.amountUsd * proportion)
        : null,
      exchangeRate: original.exchangeRate,
      needsReview: true,
      receivable: false,
      received: false,
      // Use a future createdAt so they sort first in review queue
      createdAt: new Date(Date.now() + 1000),
      updatedAt: new Date(),
    })
  }
  
  revalidatePath('/')
  revalidatePath('/review')
  return { success: true }
}

export async function markAsReceived(id: string) {
  const session = await requireAuth()
  await db
    .update(movements)
    .set({ received: true, updatedAt: new Date() })
    .where(and(eq(movements.id, id), eq(movements.userId, session.id)))
  revalidatePath('/')
  return { success: true }
}

export async function getAccountsAndCategories() {
  const session = await requireAuth()
  const userAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, session.id))
    .orderBy(accounts.bankName)
  const userCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.userId, session.id))
    .orderBy(categories.name)
  return { accounts: userAccounts, categories: userCategories }
}
