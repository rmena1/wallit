'use server'

import { revalidatePath } from 'next/cache'
import { db, movements, categories, accounts } from '@/lib/db'
import { movementLedger, type AmountInputMode } from '@/lib/domain/movement-ledger'
import { eq, and, desc, sql } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'

export async function getPendingReviewCount() {
  const session = await requireAuth()
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(movements)
    .where(and(eq(movements.userId, session.id), eq(movements.needsReview, true)))
  return Number(result[0]?.count ?? 0)
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

export async function confirmPendingAsReportable(id: string, data: {
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
}) {
  const session = await requireAuth()
  const result = await movementLedger.confirmPendingAsReportable(session.id, id, {
    ...data,
    amountInputMode: data.amountInputMode ?? 'canonicalClp',
  })
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
    revalidatePath('/emergency')
    revalidatePath('/loans')
    revalidatePath('/reports')
  }
  return result
}

export async function deletePendingMovement(id: string) {
  const session = await requireAuth()
  const result = await movementLedger.deletePendingMovement(session.id, id)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
  }
  return result
}

export async function markAsReceivable(id: string, reminderText: string) {
  const session = await requireAuth()
  const result = await movementLedger.markAsReceivable(session.id, id, reminderText)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
    revalidatePath('/receivables')
    revalidatePath('/reports')
  }
  return result
}

export async function unmarkReceivable(id: string) {
  const session = await requireAuth()
  const result = await movementLedger.unmarkReceivable(session.id, id)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/receivables')
    revalidatePath('/reports')
  }
  return result
}

export async function splitMovement(originalId: string, splits: { name: string; amount: number }[]) {
  const session = await requireAuth()
  const result = await movementLedger.splitMovement(session.id, originalId, splits)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
    revalidatePath('/reports')
  }
  return result
}

export async function settleReceivableWithNewMovement(id: string, paymentAccountId?: string) {
  const session = await requireAuth()
  const result = await movementLedger.settleReceivableWithNewMovement(session.id, id, paymentAccountId)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/receivables')
    revalidatePath('/reports')
  }
  return result
}

export async function settleReceivableWithExistingMovement(receivableId: string, existingIncomeId: string) {
  const session = await requireAuth()
  const result = await movementLedger.settleReceivableWithExistingMovement(session.id, receivableId, existingIncomeId)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/receivables')
    revalidatePath('/reports')
  }
  return result
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
