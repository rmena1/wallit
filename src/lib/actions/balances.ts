'use server'

import { db, accounts, movements, investmentSnapshots } from '@/lib/db'
import { eq, and, sql } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'
import { calculateInvestmentPerformance } from '@/lib/investment-performance'

export interface AccountWithBalance {
  id: string
  bankName: string
  accountType: string
  lastFourDigits: string
  initialBalance: number
  totalDeposited: number
  gainLoss: number
  gainLossPercent: number
  isInvestment: boolean
  currentValue: number | null
  currentValueUpdatedAt: Date | null
  creditLimit: number | null
  balance: number
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
  const amountForAccountCurrency = sql<number>`CASE WHEN ${accounts.currency} = 'USD' THEN COALESCE(${movements.amountUsd}, 0) ELSE ${movements.amount} END`

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
      createdAt: accounts.createdAt,
      creditLimit: accounts.creditLimit,
      currency: accounts.currency,
      color: accounts.color,
      emoji: accounts.emoji,
      openingTrackedValue: sql<number | null>`(
        SELECT ${investmentSnapshots.value}
        FROM ${investmentSnapshots}
        WHERE ${investmentSnapshots.accountId} = ${accounts.id}
          AND ${investmentSnapshots.userId} = ${session.id}
        ORDER BY ${investmentSnapshots.date} ASC, ${investmentSnapshots.createdAt} ASC
        LIMIT 1
      )`,
      openingTrackedValueCreatedAt: sql<Date | null>`(
        SELECT ${investmentSnapshots.createdAt}
        FROM ${investmentSnapshots}
        WHERE ${investmentSnapshots.accountId} = ${accounts.id}
          AND ${investmentSnapshots.userId} = ${session.id}
        ORDER BY ${investmentSnapshots.date} ASC, ${investmentSnapshots.createdAt} ASC
        LIMIT 1
      )`,
      incomeSum: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'income' THEN ${amountForAccountCurrency} ELSE 0 END), 0)`,
      expenseSum: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'expense' THEN ${amountForAccountCurrency} ELSE 0 END), 0)`,
      transferInSum: sql<number>`COALESCE(SUM(CASE WHEN ${movements.transferId} IS NOT NULL AND ${movements.type} = 'income' THEN ${amountForAccountCurrency} ELSE 0 END), 0)`,
      transferOutSum: sql<number>`COALESCE(SUM(CASE WHEN ${movements.transferId} IS NOT NULL AND ${movements.type} = 'expense' THEN ${amountForAccountCurrency} ELSE 0 END), 0)`,
    })
    .from(accounts)
    .leftJoin(movements, and(eq(accounts.id, movements.accountId), eq(movements.userId, session.id)))
    .where(eq(accounts.userId, session.id))
    .groupBy(accounts.id)
    .orderBy(accounts.bankName)

  return results.map((r) => {
    const performance = r.isInvestment
      ? calculateInvestmentPerformance({
        initialBalance: r.initialBalance,
        openingTrackedValue: r.openingTrackedValue,
        openingTrackedValueRecordedAt: r.openingTrackedValueCreatedAt,
        accountCreatedAt: r.createdAt,
        transferIn: Number(r.transferInSum),
        transferOut: Number(r.transferOutSum),
        currentValue: r.currentValue,
      })
      : null

    return {
      id: r.id,
      bankName: r.bankName,
      accountType: r.accountType,
      lastFourDigits: r.lastFourDigits,
      initialBalance: r.initialBalance,
      totalDeposited: performance?.totalDeposited ?? 0,
      gainLoss: performance?.gainLoss ?? 0,
      gainLossPercent: performance?.gainLossPercent ?? 0,
      isInvestment: r.isInvestment,
      currentValue: performance?.currentValue ?? r.currentValue,
      currentValueUpdatedAt: r.currentValueUpdatedAt,
      creditLimit: r.creditLimit ?? null,
      balance: r.isInvestment
        ? performance!.currentValue
        : r.initialBalance + Number(r.incomeSum) - Number(r.expenseSum),
      currency: r.currency,
      color: r.color,
      emoji: r.emoji,
    }
  })
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
  unsettledLoans: number // sum of amounts for movements where loan=true and loanSettled=false
  creditDebt: number // sum of (creditLimit - balance) for credit accounts with creditLimit > 0
  netLiquidity: number // debitBalance + receivables - creditDebt - unsettledLoans
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
  const [receivableResults, unsettledLoanResults] = await Promise.all([
    db
      .select({ total: sql<number>`COALESCE(SUM(${movements.amount}), 0)` })
      .from(movements)
      .where(and(
        eq(movements.userId, session.id),
        eq(movements.receivable, true),
        eq(movements.received, false)
      )),
    db
      .select({ total: sql<number>`COALESCE(SUM(${movements.amount}), 0)` })
      .from(movements)
      .where(and(
        eq(movements.userId, session.id),
        eq(movements.type, 'income'),
        eq(movements.loan, true),
        eq(movements.loanSettled, false)
      )),
  ])

  const receivables = Number(receivableResults[0]?.total ?? 0)
  const unsettledLoans = Number(unsettledLoanResults[0]?.total ?? 0)

  return {
    debitBalance,
    receivables,
    unsettledLoans,
    creditDebt,
    netLiquidity: debitBalance + receivables - creditDebt - unsettledLoans,
  }
}
