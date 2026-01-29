'use server'

import { db, accounts, movements } from '@/lib/db'
import { eq, and, sql } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'

export interface AccountWithBalance {
  id: string
  bankName: string
  accountType: string
  lastFourDigits: string
  initialBalance: number
  balance: number
  color: string | null
  emoji: string | null
}

/**
 * Get all accounts with calculated balances for the current user.
 * Balance = initialBalance + sum(income) - sum(expense)
 */
export async function getAccountBalances(): Promise<AccountWithBalance[]> {
  const session = await requireAuth()

  const results = await db
    .select({
      id: accounts.id,
      bankName: accounts.bankName,
      accountType: accounts.accountType,
      lastFourDigits: accounts.lastFourDigits,
      initialBalance: accounts.initialBalance,
      color: accounts.color,
      emoji: accounts.emoji,
      incomeSum: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'income' THEN ${movements.amount} ELSE 0 END), 0)`,
      expenseSum: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'expense' THEN ${movements.amount} ELSE 0 END), 0)`,
    })
    .from(accounts)
    .leftJoin(movements, eq(accounts.id, movements.accountId))
    .where(eq(accounts.userId, session.id))
    .groupBy(accounts.id)
    .orderBy(accounts.bankName)

  return results.map((r) => ({
    id: r.id,
    bankName: r.bankName,
    accountType: r.accountType,
    lastFourDigits: r.lastFourDigits,
    initialBalance: r.initialBalance,
    balance: r.initialBalance + r.incomeSum - r.expenseSum,
    color: r.color,
    emoji: r.emoji,
  }))
}

/**
 * Get the total balance across all accounts for the current user.
 */
export async function getTotalBalance(): Promise<number> {
  const accountBalances = await getAccountBalances()
  return accountBalances.reduce((sum, a) => sum + a.balance, 0)
}
