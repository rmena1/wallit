'use server'

import { db, movements, categories, accounts } from '@/lib/db'
import { eq, sql } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'

export interface DailyData {
  date: string
  income: number
  expense: number
}

export interface ReportData {
  dailyData: DailyData[]
  totalIncome: number
  totalExpense: number
  movementCount: number
  categorySpending: { id: string | null; name: string; emoji: string; total: number; count: number }[]
  categories: { id: string; name: string; emoji: string }[]
  accounts: { id: string; bankName: string; lastFour: string; emoji: string | null }[]
}

export interface HistoricalExpenseProfile {
  monthlyTotals: { yearMonth: string; total: number }[]
  dayOfMonthProfile: number[]
  dayOfWeekProfile: number[]
  monthCount: number
}

export async function getReportData(
  startDate: string,
  endDate: string,
  categoryId?: string,
  accountId?: string,
): Promise<ReportData> {
  const session = await requireAuth()

  const filters = [
    sql`${movements.userId} = ${session.id}`,
    sql`${movements.date} >= ${startDate}`,
    sql`${movements.date} <= ${endDate}`,
    sql`(${movements.receivable} = false OR ${movements.receivable} IS NULL)`,
    sql`${movements.receivableId} IS NULL`,
    sql`${movements.transferId} IS NULL`, // Exclude transfers from reports
    sql`(${movements.emergency} = false OR ${movements.emergency} IS NULL)`, // Exclude emergency expenses
    sql`(${movements.loan} = false OR ${movements.loan} IS NULL)`,
    sql`${movements.loanId} IS NULL`,
  ]
  if (categoryId) filters.push(sql`${movements.categoryId} = ${categoryId}`)
  if (accountId) filters.push(sql`${movements.accountId} = ${accountId}`)

  const where = sql.join(filters, sql` AND `)

  const [dailyData, totals, catSpending, userCategories, userAccounts] = await Promise.all([
    db.select({
      date: movements.date,
      income: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'income' THEN ${movements.amount} ELSE 0 END), 0)`,
      expense: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'expense' THEN ${movements.amount} ELSE 0 END), 0)`,
    }).from(movements).where(where).groupBy(movements.date).orderBy(movements.date),

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

    db.select({ id: accounts.id, bankName: accounts.bankName, lastFour: accounts.lastFourDigits, emoji: accounts.emoji })
      .from(accounts).where(eq(accounts.userId, session.id)),
  ])

  const t = totals[0] || { totalIncome: 0, totalExpense: 0, count: 0 }

  return {
    dailyData: dailyData.map(d => ({ ...d, income: Number(d.income), expense: Number(d.expense) })),
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
    accounts: userAccounts,
  }
}

export async function getHistoricalExpenseProfile(monthsBack = 12): Promise<HistoricalExpenseProfile> {
  const session = await requireAuth()

  const normalizedMonthsBack = Number.isFinite(monthsBack) ? Math.max(1, Math.floor(monthsBack)) : 6
  const today = new Date()
  const startDateObj = new Date(today.getFullYear(), today.getMonth() - normalizedMonthsBack, 1)
  const endDateObj = new Date(today.getFullYear(), today.getMonth(), 0) // Last day of previous month

  const toDateKey = (d: Date) => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  if (endDateObj < startDateObj) {
    return {
      monthlyTotals: [],
      dayOfMonthProfile: Array(31).fill(0),
      dayOfWeekProfile: Array(7).fill(1),
      monthCount: 0,
    }
  }

  const startDate = toDateKey(startDateObj)
  const endDate = toDateKey(endDateObj)

  const where = sql.join([
    sql`${movements.userId} = ${session.id}`,
    sql`${movements.type} = 'expense'`,
    sql`${movements.date} >= ${startDate}`,
    sql`${movements.date} <= ${endDate}`,
    sql`(${movements.receivable} = false OR ${movements.receivable} IS NULL)`,
    sql`${movements.receivableId} IS NULL`,
    sql`${movements.transferId} IS NULL`,
    sql`(${movements.emergency} = false OR ${movements.emergency} IS NULL)`,
    sql`(${movements.loan} = false OR ${movements.loan} IS NULL)`,
    sql`${movements.loanId} IS NULL`,
  ], sql` AND `)

  const rawDailyExpenses = await db.select({
    date: movements.date,
    total: sql<number>`COALESCE(SUM(${movements.amount}), 0)`,
  }).from(movements)
    .where(where)
    .groupBy(movements.date)
    .orderBy(movements.date)

  const dailyExpenseMap = new Map<string, number>()
  const monthlyTotalsMap = new Map<string, number>()

  for (const row of rawDailyExpenses) {
    const date = String(row.date)
    const total = Number(row.total) || 0
    dailyExpenseMap.set(date, total)

    const yearMonth = date.slice(0, 7)
    monthlyTotalsMap.set(yearMonth, (monthlyTotalsMap.get(yearMonth) || 0) + total)
  }

  const monthlyTotals = Array.from(monthlyTotalsMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([yearMonth, total]) => ({ yearMonth, total }))

  const monthCount = monthlyTotals.length
  if (monthCount === 0) {
    return {
      monthlyTotals,
      dayOfMonthProfile: Array(31).fill(0),
      dayOfWeekProfile: Array(7).fill(1),
      monthCount,
    }
  }

  const months = monthlyTotals.map(m => m.yearMonth)
  const decay = 0.7
  const monthWeights = months.map((_, i) => Math.pow(decay, months.length - 1 - i))

  const dayOfMonthProfile = Array(31).fill(0)
  for (let day = 1; day <= 31; day++) {
    let weightedTotal = 0
    let weightedCount = 0

    for (let i = 0; i < months.length; i++) {
      const [yearStr, monthStr] = months[i].split('-')
      const year = Number(yearStr)
      const month = Number(monthStr)
      const daysInMonth = new Date(year, month, 0).getDate()
      if (day > daysInMonth) continue

      const dateKey = `${months[i]}-${String(day).padStart(2, '0')}`
      if (dateKey < startDate || dateKey > endDate) continue
      const amount = dailyExpenseMap.get(dateKey) || 0
      const weight = monthWeights[i]

      weightedTotal += amount * weight
      weightedCount += weight
    }

    dayOfMonthProfile[day - 1] = weightedCount > 0 ? weightedTotal / weightedCount : 0
  }

  const dayOfWeekTotals = Array(7).fill(0)
  const dayOfWeekCounts = Array(7).fill(0)
  let weightedOverallTotal = 0
  let weightedOverallCount = 0

  for (let i = 0; i < months.length; i++) {
    const [yearStr, monthStr] = months[i].split('-')
    const year = Number(yearStr)
    const month = Number(monthStr)
    const daysInMonth = new Date(year, month, 0).getDate()
    const weight = monthWeights[i]

    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${months[i]}-${String(day).padStart(2, '0')}`
      if (dateKey < startDate || dateKey > endDate) continue

      const amount = dailyExpenseMap.get(dateKey) || 0
      const jsWeekday = new Date(year, month - 1, day).getDay()
      const weekday = jsWeekday === 0 ? 6 : jsWeekday - 1

      dayOfWeekTotals[weekday] += amount * weight
      dayOfWeekCounts[weekday] += weight
      weightedOverallTotal += amount * weight
      weightedOverallCount += weight
    }
  }

  const overallAverage = weightedOverallCount > 0 ? weightedOverallTotal / weightedOverallCount : 0
  const dayOfWeekProfile = Array(7).fill(1)

  for (let i = 0; i < 7; i++) {
    const weekdayAverage = dayOfWeekCounts[i] > 0 ? dayOfWeekTotals[i] / dayOfWeekCounts[i] : overallAverage
    const ratio = overallAverage > 0 ? weekdayAverage / overallAverage : 1
    dayOfWeekProfile[i] = Number.isFinite(ratio) ? ratio : 1
  }

  return {
    monthlyTotals,
    dayOfMonthProfile,
    dayOfWeekProfile,
    monthCount,
  }
}
