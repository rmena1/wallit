'use server'

import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'
import { db, accounts, movements, investmentSnapshots } from '@/lib/db'
import { calculateInvestmentPerformance } from '@/lib/investment-performance'
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
      initialBalance: accounts.initialBalance,
      currentValue: accounts.currentValue,
      createdAt: accounts.createdAt,
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

  const [existingSnapshot] = await db
    .select({ id: investmentSnapshots.id })
    .from(investmentSnapshots)
    .where(and(eq(investmentSnapshots.accountId, accountId), eq(investmentSnapshots.userId, session.id)))
    .limit(1)

  await db.transaction(async (tx) => {
    if (!existingSnapshot) {
      await tx.insert(investmentSnapshots).values({
        id: generateId(),
        accountId,
        userId: session.id,
        value: account.currentValue ?? account.initialBalance,
        date: account.createdAt.toISOString().slice(0, 10),
        createdAt: account.createdAt,
      })
    }

    await tx.update(accounts)
      .set({
        currentValue: normalizedValue,
        currentValueUpdatedAt: now,
        updatedAt: now,
      })
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, session.id)))

    await tx.insert(investmentSnapshots).values({
      id: generateId(),
      accountId,
      userId: session.id,
      value: normalizedValue,
      date: snapshotDate,
    })
  })

  revalidatePath('/')
  revalidatePath('/settings')
  revalidatePath(`/account/${accountId}`)

  return { success: true }
}

/**
 * Delete a snapshot for an investment account and keep the account value in sync
 * with the latest remaining snapshot, or fall back to the initial balance when
 * no snapshots remain.
 */
export async function deleteInvestmentSnapshot(accountId: string, snapshotId: string): Promise<InvestmentActionResult> {
  const session = await requireAuth()

  if (!accountId) {
    return { success: false, error: 'Account ID is required' }
  }

  if (!snapshotId) {
    return { success: false, error: 'Snapshot ID is required' }
  }

  const [account] = await db
    .select({
      id: accounts.id,
      isInvestment: accounts.isInvestment,
      initialBalance: accounts.initialBalance,
      createdAt: accounts.createdAt,
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

  const [snapshot] = await db
    .select({ id: investmentSnapshots.id })
    .from(investmentSnapshots)
    .where(
      and(
        eq(investmentSnapshots.id, snapshotId),
        eq(investmentSnapshots.accountId, accountId),
        eq(investmentSnapshots.userId, session.id)
      )
    )
    .limit(1)

  if (!snapshot) {
    return { success: false, error: 'Snapshot not found' }
  }

  const now = new Date()

  await db.transaction(async (tx) => {
    await tx.delete(investmentSnapshots).where(
      and(
        eq(investmentSnapshots.id, snapshotId),
        eq(investmentSnapshots.accountId, accountId),
        eq(investmentSnapshots.userId, session.id)
      )
    )

    const [latestRemainingSnapshot] = await tx
      .select({
        value: investmentSnapshots.value,
        createdAt: investmentSnapshots.createdAt,
      })
      .from(investmentSnapshots)
      .where(and(eq(investmentSnapshots.accountId, accountId), eq(investmentSnapshots.userId, session.id)))
      .orderBy(desc(investmentSnapshots.date), desc(investmentSnapshots.createdAt))
      .limit(1)

    await tx.update(accounts)
      .set({
        currentValue: latestRemainingSnapshot?.value ?? account.initialBalance,
        currentValueUpdatedAt: latestRemainingSnapshot?.createdAt ?? account.createdAt,
        updatedAt: now,
      })
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, session.id)))
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
      createdAt: accounts.createdAt,
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

  const [[totals], [openingSnapshot]] = await Promise.all([
    db
      .select({
        transferIn: sql<number>`COALESCE(SUM(CASE WHEN ${movements.transferId} IS NOT NULL AND ${movements.type} = 'income' THEN ${amountForAccountCurrency} ELSE 0 END), 0)`,
        transferOut: sql<number>`COALESCE(SUM(CASE WHEN ${movements.transferId} IS NOT NULL AND ${movements.type} = 'expense' THEN ${amountForAccountCurrency} ELSE 0 END), 0)`,
      })
      .from(movements)
      .where(and(eq(movements.accountId, accountId), eq(movements.userId, session.id))),
    db
      .select({
        value: investmentSnapshots.value,
        createdAt: investmentSnapshots.createdAt,
      })
      .from(investmentSnapshots)
      .where(and(eq(investmentSnapshots.accountId, accountId), eq(investmentSnapshots.userId, session.id)))
      .orderBy(asc(investmentSnapshots.date), asc(investmentSnapshots.createdAt))
      .limit(1),
  ])

  const transferIn = Number(totals?.transferIn ?? 0)
  const transferOut = Number(totals?.transferOut ?? 0)
  const performance = calculateInvestmentPerformance({
    initialBalance: account.initialBalance,
    openingTrackedValue: openingSnapshot?.value ?? null,
    openingTrackedValueRecordedAt: openingSnapshot?.createdAt ?? null,
    accountCreatedAt: account.createdAt,
    transferIn,
    transferOut,
    currentValue: account.currentValue,
  })

  return {
    totalDeposited: performance.totalDeposited,
    gainLoss: performance.gainLoss,
    gainLossPercent: performance.gainLossPercent,
    currentValue: performance.currentValue,
    currentValueUpdatedAt: account.currentValueUpdatedAt,
  }
}
