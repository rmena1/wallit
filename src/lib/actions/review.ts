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
  time?: string | null
}) {
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

export async function unmarkReceivable(id: string) {
  const session = await requireAuth()
  
  // Delete any payment income linked to this receivable
  await db
    .delete(movements)
    .where(and(eq(movements.receivableId, id), eq(movements.userId, session.id)))
  
  // Unmark the receivable
  await db
    .update(movements)
    .set({
      receivable: false,
      received: false,
      updatedAt: new Date(),
    })
    .where(and(eq(movements.id, id), eq(movements.userId, session.id)))
  revalidatePath('/')
  revalidatePath('/review')
  revalidatePath('/receivables')
  return { success: true }
}

export async function splitMovement(originalId: string, splits: { name: string; amount: number }[]) {
  const session = await requireAuth()

  // Validate splits input
  if (!Array.isArray(splits) || splits.length < 2 || splits.length > 20) {
    return { success: false, error: 'Splits must contain between 2 and 20 items' }
  }

  for (const split of splits) {
    if (typeof split.name !== 'string' || split.name.trim().length === 0 || split.name.length > 200) {
      return { success: false, error: 'Each split must have a valid name (1-200 chars)' }
    }
    if (typeof split.amount !== 'number' || !Number.isInteger(split.amount) || split.amount <= 0) {
      return { success: false, error: 'Each split amount must be a positive integer' }
    }
  }
  
  // Get original movement
  const [original] = await db
    .select()
    .from(movements)
    .where(and(eq(movements.id, originalId), eq(movements.userId, session.id)))
  
  if (!original) return { success: false, error: 'Movement not found' }

  const { generateId } = await import('@/lib/utils')
  const totalOriginal = original.amount
  
  // Validate split amounts sum to original
  const splitTotal = splits.reduce((sum, s) => sum + s.amount, 0)
  if (splitTotal !== totalOriginal) {
    return { success: false, error: 'Split amounts must equal the original amount' }
  }
  
  // Use a transaction to ensure atomicity — if any insert fails,
  // the original movement is preserved (no data loss)
  // Note: better-sqlite3 is synchronous, so no async/await inside transaction
  db.transaction((tx) => {
    // Delete original
    tx.delete(movements).where(eq(movements.id, originalId)).run()
    
    // Create split movements
    for (const split of splits) {
      const proportion = totalOriginal !== 0 ? split.amount / totalOriginal : 0
      tx.insert(movements).values({
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
        time: original.time,
        originalName: original.originalName,
        needsReview: true,
        receivable: false,
        received: false,
        // Use a future createdAt so they sort first in review queue
        createdAt: new Date(Date.now() + 1000),
        updatedAt: new Date(),
      }).run()
    }
  })
  
  revalidatePath('/')
  revalidatePath('/review')
  return { success: true }
}

export async function markAsReceived(id: string, paymentAccountId?: string) {
  const session = await requireAuth()
  
  // Get the original receivable movement
  const [original] = await db
    .select()
    .from(movements)
    .where(and(eq(movements.id, id), eq(movements.userId, session.id)))
  
  if (!original) return { success: false, error: 'Movement not found' }
  
  // Verify the payment account belongs to the current user (IDOR protection)
  if (paymentAccountId) {
    const [ownedAccount] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, paymentAccountId), eq(accounts.userId, session.id)))
      .limit(1)
    if (!ownedAccount) {
      return { success: false, error: 'Invalid account' }
    }
  }
  
  const { generateId } = await import('@/lib/utils')
  
  // Note: better-sqlite3 is synchronous, so no async/await inside transaction
  db.transaction((tx) => {
    // Mark the original as received
    tx
      .update(movements)
      .set({ received: true, updatedAt: new Date() })
      .where(and(eq(movements.id, id), eq(movements.userId, session.id)))
      .run()
    
    // If an account was selected (not cash), create an income movement
    if (paymentAccountId) {
      tx.insert(movements).values({
        id: generateId(),
        userId: session.id,
        categoryId: original.categoryId,
        accountId: paymentAccountId,
        name: `Cobro: ${original.name}`,
        date: new Date().toISOString().slice(0, 10),
        amount: original.amount,
        type: 'income',
        currency: original.currency,
        amountUsd: original.amountUsd,
        exchangeRate: original.exchangeRate,
        time: original.time,
        receivable: false,
        received: false,
        receivableId: id, // link to original receivable
        needsReview: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).run()
    }
  })
  
  revalidatePath('/')
  return { success: true }
}

export async function markAsReceivedWithExisting(receivableId: string, existingIncomeId: string) {
  const session = await requireAuth()
  
  // Verify both movements exist and belong to user
  const [receivable] = await db
    .select()
    .from(movements)
    .where(and(eq(movements.id, receivableId), eq(movements.userId, session.id)))
  
  const [income] = await db
    .select()
    .from(movements)
    .where(and(eq(movements.id, existingIncomeId), eq(movements.userId, session.id)))
  
  if (!receivable) return { success: false, error: 'Receivable not found' }
  if (!income) return { success: false, error: 'Income movement not found' }
  if (income.type !== 'income') return { success: false, error: 'Selected movement is not an income' }
  if (income.receivableId) return { success: false, error: 'Income is already linked to another receivable' }
  
  // Note: better-sqlite3 is synchronous, so no async/await inside transaction
  db.transaction((tx) => {
    // Mark the receivable as received
    tx
      .update(movements)
      .set({ received: true, updatedAt: new Date() })
      .where(and(eq(movements.id, receivableId), eq(movements.userId, session.id)))
      .run()
    
    // Link the existing income to this receivable
    tx
      .update(movements)
      .set({ receivableId: receivableId, updatedAt: new Date() })
      .where(and(eq(movements.id, existingIncomeId), eq(movements.userId, session.id)))
      .run()
  })
  
  revalidatePath('/')
  revalidatePath('/receivables')
  return { success: true }
}

export async function getAccountsAndCategories() {
  const session = await requireAuth()
  const [userAccounts, userCategories] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, session.id))
      .orderBy(accounts.bankName),
    db
      .select()
      .from(categories)
      .where(eq(categories.userId, session.id))
      .orderBy(categories.name),
  ])
  return { accounts: userAccounts, categories: userCategories }
}
