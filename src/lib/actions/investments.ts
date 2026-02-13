'use server'

import { revalidatePath } from 'next/cache'
import { and, desc, eq, sql } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'
import { db, accounts, movements, investmentSnapshots } from '@/lib/db'
import { generateId } from '@/lib/utils'

export type InvestmentActionResult = {
  success: boolean
  error?: string
}

export interface InvestmentSummary {
  totalDeposited: number
  gainLoss: number
  gainLossPercent: number
  currentValue: number
  currentValueUpdatedAt: Date | null
}

/**
 * Update current value for an investment account and create a snapshot.
 */
export async function updateInvestmentValue(accountId: string, value: number): Promise<InvestmentActionResult> {
  const session = await requireAuth()

  if (!accountId) {
    return { success: false, error: 'Account ID is required' }
  }

  if (!Number.isFinite(value) || value < 0) {
    return { success: false, error: 'Value must be a valid non-negative number' }
  }

  const [account] = await db
    .select({
      id: accounts.id,
      isInvestment: accounts.isInvestment,
    })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, session.id)))
    .limit(1)

  if (!account) {
    return { success: false, error: 'Account not found' }
  }

  if (!account.isInvestment) {
    return { success: false, error: 'Account is not an investment account' }
  }

  const now = new Date()
  const snapshotDate = now.toISOString().slice(0, 10)
  const normalizedValue = Math.round(value)

  await db.update(accounts)
    .set({
      currentValue: normalizedValue,
      currentValueUpdatedAt: now,
      updatedAt: now,
    })
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, session.id)))

  await db.insert(investmentSnapshots).values({
    id: generateId(),
    accountId,
    userId: session.id,
    value: normalizedValue,
    date: snapshotDate,
  })

  revalidatePath('/')
  revalidatePath('/settings')
  revalidatePath(`/account/${accountId}`)

  return { success: true }
}

/**
 * Get all snapshots for an investment account ordered by date descending.
 */
export async function getInvestmentSnapshots(accountId: string) {
  const session = await requireAuth()

  return db
    .select({
      id: investmentSnapshots.id,
      value: investmentSnapshots.value,
      date: investmentSnapshots.date,
      createdAt: investmentSnapshots.createdAt,
    })
    .from(investmentSnapshots)
    .where(and(eq(investmentSnapshots.accountId, accountId), eq(investmentSnapshots.userId, session.id)))
    .orderBy(desc(investmentSnapshots.date), desc(investmentSnapshots.createdAt))
}

/**
 * Get summary metrics for an investment account.
 */
export async function getInvestmentSummary(accountId: string): Promise<InvestmentSummary | null> {
  const session = await requireAuth()

  const [account] = await db
    .select({
      id: accounts.id,
      currency: accounts.currency,
      initialBalance: accounts.initialBalance,
      isInvestment: accounts.isInvestment,
      currentValue: accounts.currentValue,
      currentValueUpdatedAt: accounts.currentValueUpdatedAt,
    })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, session.id)))
    .limit(1)

  if (!account || !account.isInvestment) {
    return null
  }

  const amountForAccountCurrency = account.currency === 'USD'
    ? sql<number>`COALESCE(${movements.amountUsd}, 0)`
    : sql<number>`${movements.amount}`

  const [totals] = await db
    .select({
      transferIn: sql<number>`COALESCE(SUM(CASE WHEN ${movements.transferId} IS NOT NULL AND ${movements.type} = 'income' THEN ${amountForAccountCurrency} ELSE 0 END), 0)`,
      transferOut: sql<number>`COALESCE(SUM(CASE WHEN ${movements.transferId} IS NOT NULL AND ${movements.type} = 'expense' THEN ${amountForAccountCurrency} ELSE 0 END), 0)`,
    })
    .from(movements)
    .where(and(eq(movements.accountId, accountId), eq(movements.userId, session.id)))

  const totalDeposited = account.initialBalance + (totals?.transferIn ?? 0) - (totals?.transferOut ?? 0)
  const currentValue = account.currentValue ?? account.initialBalance
  const gainLoss = currentValue - totalDeposited
  const gainLossPercent = totalDeposited > 0
    ? ((currentValue - totalDeposited) / totalDeposited) * 100
    : 0

  return {
    totalDeposited,
    gainLoss,
    gainLossPercent,
    currentValue,
    currentValueUpdatedAt: account.currentValueUpdatedAt,
  }
}
