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
  totalDeposited: number
  isInvestment: boolean
  currentValue: number | null
  currentValueUpdatedAt: Date | null
  balance: number
  creditLimit: number | null
  currency: 'CLP' | 'USD'
  color: string | null
  emoji: string | null
}

export type AccountWithBalanceSerialized = Omit<AccountWithBalance, 'currentValueUpdatedAt'> & {
  currentValueUpdatedAt: string | null
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
      isInvestment: accounts.isInvestment,
      currentValue: accounts.currentValue,
      currentValueUpdatedAt: accounts.currentValueUpdatedAt,
      creditLimit: accounts.creditLimit,
      currency: accounts.currency,
      color: accounts.color,
      emoji: accounts.emoji,
      incomeSum: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'income' THEN CASE WHEN ${accounts.currency} = 'USD' THEN COALESCE(${movements.amountUsd}, 0) ELSE ${movements.amount} END ELSE 0 END), 0)`,
      expenseSum: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'expense' THEN CASE WHEN ${accounts.currency} = 'USD' THEN COALESCE(${movements.amountUsd}, 0) ELSE ${movements.amount} END ELSE 0 END), 0)`,
    })
    .from(accounts)
    .leftJoin(movements, and(eq(accounts.id, movements.accountId), eq(movements.userId, session.id)))
    .where(eq(accounts.userId, session.id))
    .groupBy(accounts.id)
    .orderBy(accounts.bankName)

  return results.map((r) => ({
    id: r.id,
    bankName: r.bankName,
    accountType: r.accountType,
    lastFourDigits: r.lastFourDigits,
    initialBalance: r.initialBalance,
    totalDeposited: r.isInvestment ? r.initialBalance + r.incomeSum - r.expenseSum : 0,
    isInvestment: r.isInvestment,
    currentValue: r.currentValue,
    currentValueUpdatedAt: r.currentValueUpdatedAt,
    balance: r.isInvestment
      ? (r.currentValue ?? r.initialBalance)
      : r.initialBalance + r.incomeSum - r.expenseSum,
    creditLimit: r.creditLimit ?? null,
    currency: r.currency,
    color: r.color,
    emoji: r.emoji,
  }))
}

/**
 * Get the total balance across all accounts for the current user, in CLP cents.
 * USD account balances are converted to CLP using the current exchange rate.
 */
export async function getTotalBalance(usdToClpRate?: number): Promise<number> {
  const accountBalances = await getAccountBalances()
  return accountBalances.reduce((sum, a) => {
    if (a.currency === 'USD' && usdToClpRate) {
      // Convert USD cents to CLP cents: usdCents * (rate / 100)
      return sum + Math.round(a.balance * usdToClpRate / 100)
    }
    return sum + a.balance
  }, 0)
}

export interface NetLiquidityData {
  debitBalance: number // sum of balances for debit accounts in CLP cents
  receivables: number // sum of amounts for movements where receivable=true and received=false
  creditDebt: number // sum of (creditLimit - balance) for credit accounts with creditLimit > 0
  netLiquidity: number // debitBalance + receivables - creditDebt
}

export async function getNetLiquidity(usdToClpRate?: number, precomputedBalances?: AccountWithBalance[]): Promise<NetLiquidityData> {
  const accountBalances = precomputedBalances ?? await getAccountBalances()
  // Support both Spanish types (current) and English types (legacy)
  const debitTypes = ['Corriente', 'Vista', 'Ahorro', 'Prepago', 'debit']
  const creditTypes = ['Crédito', 'credit']

  let debitBalance = 0
  let creditDebt = 0

  for (const a of accountBalances) {
    const balanceInClp = a.currency === 'USD' && usdToClpRate
      ? Math.round(a.balance * usdToClpRate / 100)
      : a.balance

    if (debitTypes.includes(a.accountType) && !a.isInvestment) {
      debitBalance += balanceInClp
    }

    if (creditTypes.includes(a.accountType) && a.creditLimit && a.creditLimit > 0) {
      const creditLimitClp = a.currency === 'USD' && usdToClpRate
        ? Math.round(a.creditLimit * usdToClpRate / 100)
        : a.creditLimit
      creditDebt += Math.max(0, creditLimitClp - balanceInClp)
    }
  }

  const session = await requireAuth()
  const receivableResults = await db
    .select({ total: sql<number>`COALESCE(SUM(${movements.amount}), 0)` })
    .from(movements)
    .where(and(
      eq(movements.userId, session.id),
      eq(movements.receivable, true),
      eq(movements.received, false)
    ))

  const receivables = receivableResults[0]?.total ?? 0

  return {
    debitBalance,
    receivables,
    creditDebt,
    netLiquidity: debitBalance + receivables - creditDebt,
  }
}
