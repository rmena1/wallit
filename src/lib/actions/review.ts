'use server'

import { revalidatePath } from 'next/cache'
import { db, movements, categories, accounts } from '@/lib/db'
import { movementLedger, type AmountInputMode } from '@/lib/domain/movement-ledger'
import { eq, and, desc, sql } from 'drizzle-orm'
import { getCurrentSpace } from '@/lib/spaces'

export async function getPendingReviewCount() {
  const { user: session, space } = await getCurrentSpace()
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(movements)
    .where(and(eq(movements.spaceId, space.id), eq(movements.needsReview, true)))
  return Number(result[0]?.count ?? 0)
}

export async function getPendingReviewMovements() {
  const { user: session, space } = await getCurrentSpace()
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
    .leftJoin(categories, and(eq(movements.categoryId, categories.id), eq(categories.spaceId, space.id)))
    .leftJoin(accounts, and(eq(movements.accountId, accounts.id), eq(accounts.spaceId, space.id)))
    .where(and(eq(movements.spaceId, space.id), eq(movements.needsReview, true)))
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
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.confirmPendingAsReportable(space.id, id, {
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
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.deletePendingMovement(space.id, id)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
  }
  return result
}

export async function markAsReceivable(id: string, reminderText: string) {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.markAsReceivable(space.id, id, reminderText)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
    revalidatePath('/receivables')
    revalidatePath('/reports')
  }
  return result
}

export async function unmarkReceivable(id: string) {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.unmarkReceivable(space.id, id)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/receivables')
    revalidatePath('/reports')
  }
  return result
}

export async function splitMovement(originalId: string, splits: { name: string; amount: number }[]) {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.splitMovement(space.id, session.id, originalId, splits)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
    revalidatePath('/reports')
  }
  return result
}

export async function settleReceivableWithNewMovement(id: string, paymentAccountId?: string) {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.settleReceivableWithNewMovement(space.id, session.id, id, paymentAccountId)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/receivables')
    revalidatePath('/reports')
  }
  return result
}

export async function settleReceivableWithExistingMovement(receivableId: string, existingIncomeId: string) {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.settleReceivableWithExistingMovement(space.id, receivableId, existingIncomeId)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/receivables')
    revalidatePath('/reports')
  }
  return result
}

export async function getAccountsAndCategories() {
  const { user: session, space } = await getCurrentSpace()
  const [userAccounts, userCategories] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(eq(accounts.spaceId, space.id))
      .orderBy(accounts.bankName),
    db
      .select()
      .from(categories)
      .where(eq(categories.spaceId, space.id))
      .orderBy(categories.name),
  ])
  return { accounts: userAccounts, categories: userCategories }
}
