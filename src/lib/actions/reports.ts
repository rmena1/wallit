'use server'

import { db, movements, categories, accounts } from '@/lib/db'
import { eq, sql } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'
import { getUsdToClpRate } from '@/lib/exchange-rate'

export interface DailyData {
  date: string
  income: number
  expense: number
}

export interface ReportData {
  dailyData: DailyData[]
  balanceDailyData: DailyData[]
  openingBalance: number
  balanceCurrency: 'CLP' | 'USD'
  totalIncome: number
  totalExpense: number
  movementCount: number
  categorySpending: { id: string | null; name: string; emoji: string; total: number; count: number }[]
  categories: { id: string; name: string; emoji: string }[]
  accounts: { id: string; bankName: string; lastFour: string; emoji: string | null }[]
}

function buildReportMovementFilters(
  userId: string,
  options: {
    accountId?: string
    categoryId?: string
  } = {},
) {
  const filters = [
    sql`${movements.userId} = ${userId}`,
    sql`(${movements.receivable} = false OR ${movements.receivable} IS NULL)`,
    sql`${movements.receivableId} IS NULL`,
    sql`${movements.transferId} IS NULL`,
    sql`(${movements.emergency} = false OR ${movements.emergency} IS NULL)`,
    sql`(${movements.loan} = false OR ${movements.loan} IS NULL)`,
    sql`${movements.loanId} IS NULL`,
  ]

  if (options.accountId) filters.push(sql`${movements.accountId} = ${options.accountId}`)
  if (options.categoryId) filters.push(sql`${movements.categoryId} = ${options.categoryId}`)

  return filters
}

export async function getReportData(
  startDate: string,
  endDate: string,
  categoryId?: string,
  accountId?: string,
): Promise<ReportData> {
  const session = await requireAuth()

  const userAccounts = await db.select({
    id: accounts.id,
    bankName: accounts.bankName,
    lastFour: accounts.lastFourDigits,
    emoji: accounts.emoji,
    currency: accounts.currency,
    initialBalance: accounts.initialBalance,
  }).from(accounts).where(eq(accounts.userId, session.id))

  const selectedAccount = accountId
    ? userAccounts.find(account => account.id === accountId) ?? null
    : null

  if (accountId && !selectedAccount) {
    throw new Error('Invalid account')
  }

  const reportFilters = [
    ...buildReportMovementFilters(session.id, { accountId, categoryId }),
    sql`${movements.date} >= ${startDate}`,
    sql`${movements.date} <= ${endDate}`,
  ]

  const balanceFilters = [
    ...buildReportMovementFilters(session.id, { accountId }),
    sql`${movements.date} >= ${startDate}`,
    sql`${movements.date} <= ${endDate}`,
  ]
  const balanceBeforeFilters = [
    ...buildReportMovementFilters(session.id, { accountId }),
    sql`${movements.date} < ${startDate}`,
  ]

  const where = sql.join(reportFilters, sql` AND `)
  const balanceWhere = sql.join(balanceFilters, sql` AND `)
  const balanceBeforeWhere = sql.join(balanceBeforeFilters, sql` AND `)
  const balanceCurrency = selectedAccount?.currency ?? 'CLP'
  const balanceAmount = selectedAccount?.currency === 'USD'
    ? sql<number>`COALESCE(${movements.amountUsd}, 0)`
    : sql<number>`${movements.amount}`
  const needsUsdRate = !selectedAccount && userAccounts.some(account => account.currency === 'USD')
  const usdClpRate = needsUsdRate ? await getUsdToClpRate().catch(() => null as number | null) : null

  const [dailyData, balanceDailyData, balanceTotals, totals, catSpending, userCategories] = await Promise.all([
    db.select({
      date: movements.date,
      income: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'income' THEN ${movements.amount} ELSE 0 END), 0)`,
      expense: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'expense' THEN ${movements.amount} ELSE 0 END), 0)`,
    }).from(movements).where(where).groupBy(movements.date).orderBy(movements.date),

    db.select({
      date: movements.date,
      income: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'income' THEN ${balanceAmount} ELSE 0 END), 0)`,
      expense: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'expense' THEN ${balanceAmount} ELSE 0 END), 0)`,
    }).from(movements).where(balanceWhere).groupBy(movements.date).orderBy(movements.date),

    db.select({
      totalIncome: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'income' THEN ${balanceAmount} ELSE 0 END), 0)`,
      totalExpense: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'expense' THEN ${balanceAmount} ELSE 0 END), 0)`,
    }).from(movements).where(balanceBeforeWhere),

    db.select({
      totalIncome: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'income' THEN ${movements.amount} ELSE 0 END), 0)`,
      totalExpense: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'expense' THEN ${movements.amount} ELSE 0 END), 0)`,
      count: sql<number>`COUNT(*)`,
    }).from(movements).where(where),

    db.select({
      categoryId: movements.categoryId,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      total: sql<number>`SUM(${movements.amount})`,
      count: sql<number>`COUNT(*)`,
    }).from(movements)
      .leftJoin(categories, eq(movements.categoryId, categories.id))
      .where(sql`${where} AND ${movements.type} = 'expense'`)
      .groupBy(movements.categoryId, categories.name, categories.emoji)
      .orderBy(sql`SUM(${movements.amount}) DESC`),

    db.select({ id: categories.id, name: categories.name, emoji: categories.emoji })
      .from(categories).where(eq(categories.userId, session.id)),
  ])

  const t = totals[0] || { totalIncome: 0, totalExpense: 0, count: 0 }
  const openingBalanceBase = selectedAccount
    ? selectedAccount.initialBalance
    : userAccounts.reduce((sum, account) => {
      if (account.currency === 'USD' && usdClpRate) {
        return sum + Math.round(account.initialBalance * usdClpRate / 100)
      }
      return sum + account.initialBalance
    }, 0)
  const balanceTotalsBeforeRange = balanceTotals[0] || { totalIncome: 0, totalExpense: 0 }

  return {
    dailyData: dailyData.map(d => ({ ...d, income: Number(d.income), expense: Number(d.expense) })),
    balanceDailyData: balanceDailyData.map(d => ({ ...d, income: Number(d.income), expense: Number(d.expense) })),
    openingBalance: openingBalanceBase + Number(balanceTotalsBeforeRange.totalIncome) - Number(balanceTotalsBeforeRange.totalExpense),
    balanceCurrency,
    totalIncome: Number(t.totalIncome),
    totalExpense: Number(t.totalExpense),
    movementCount: Number(t.count),
    categorySpending: catSpending.map(c => ({
      id: c.categoryId,
      name: c.categoryName || 'Sin categoría',
      emoji: c.categoryEmoji || '📦',
      total: Number(c.total),
      count: Number(c.count),
    })),
    categories: userCategories,
    accounts: userAccounts.map(account => ({
      id: account.id,
      bankName: account.bankName,
      lastFour: account.lastFour,
      emoji: account.emoji,
    })),
  }
}
