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
  categorySpending: { name: string; emoji: string; total: number; count: number }[]
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
    sql`(${movements.receivable} = 0 OR ${movements.receivable} IS NULL)`,
    sql`${movements.receivableId} IS NULL`,
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
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      total: sql<number>`SUM(${movements.amount})`,
      count: sql<number>`COUNT(*)`,
    }).from(movements)
      .leftJoin(categories, eq(movements.categoryId, categories.id))
      .where(sql`${where} AND ${movements.type} = 'expense'`)
      .groupBy(categories.id)
      .orderBy(sql`SUM(${movements.amount}) DESC`),

    db.select({ id: categories.id, name: categories.name, emoji: categories.emoji })
      .from(categories).where(eq(categories.userId, session.id)),

    db.select({ id: accounts.id, bankName: accounts.bankName, lastFour: accounts.lastFourDigits, emoji: accounts.emoji })
      .from(accounts).where(eq(accounts.userId, session.id)),
  ])

  const t = totals[0] || { totalIncome: 0, totalExpense: 0, count: 0 }

  return {
    dailyData,
    totalIncome: t.totalIncome,
    totalExpense: t.totalExpense,
    movementCount: t.count,
    categorySpending: catSpending.map(c => ({
      name: c.categoryName || 'Sin categoría',
      emoji: c.categoryEmoji || '📦',
      total: c.total,
      count: c.count,
    })),
    categories: userCategories,
    accounts: userAccounts,
  }
}
