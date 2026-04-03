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
