import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db, movements, categories } from '@/lib/db'
import { eq, sql, desc } from 'drizzle-orm'
import { ReportsPage } from './reports-client'

export default async function Reports() {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  // Get monthly totals for current month
  const now = new Date()
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const monthlyTotals = await db
    .select({
      totalIncome: sql<number>`COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)`,
      totalExpense: sql<number>`COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(movements)
    .where(
      sql`${movements.userId} = ${session.id} AND ${movements.date} LIKE ${yearMonth + '%'}`
    )

  // Get spending by category this month
  const categorySpending = await db
    .select({
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      total: sql<number>`SUM(${movements.amount})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(movements)
    .leftJoin(categories, eq(movements.categoryId, categories.id))
    .where(
      sql`${movements.userId} = ${session.id} AND ${movements.type} = 'expense' AND ${movements.date} LIKE ${yearMonth + '%'}`
    )
    .groupBy(categories.id)
    .orderBy(desc(sql`SUM(${movements.amount})`))

  const totals = monthlyTotals[0] || { totalIncome: 0, totalExpense: 0, count: 0 }

  return (
    <ReportsPage
      monthLabel={now.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })}
      totalIncome={totals.totalIncome}
      totalExpense={totals.totalExpense}
      movementCount={totals.count}
      categorySpending={categorySpending.map(c => ({
        name: c.categoryName || 'Sin categoría',
        emoji: c.categoryEmoji || '📦',
        total: c.total,
        count: c.count,
      }))}
    />
  )
}
