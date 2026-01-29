import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db, movements, categories, accounts } from '@/lib/db'
import { eq, desc, sql, and } from 'drizzle-orm'
import { getAccountBalances } from '@/lib/actions/balances'
import { getUsdToClpRate } from '@/lib/exchange-rate'
import { HomePage } from './home-client'

export default async function Home() {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  // Fetch account balances
  const accountBalances = await getAccountBalances()
  const totalBalance = accountBalances.reduce((sum, a) => sum + a.balance, 0)

  // Fetch recent movements (last 20)
  const recentMovements = await db
    .select({
      id: movements.id,
      userId: movements.userId,
      categoryId: movements.categoryId,
      accountId: movements.accountId,
      name: movements.name,
      date: movements.date,
      amount: movements.amount,
      type: movements.type,
      createdAt: movements.createdAt,
      updatedAt: movements.updatedAt,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      accountBankName: accounts.bankName,
      accountLastFour: accounts.lastFourDigits,
      accountColor: accounts.color,
      accountEmoji: accounts.emoji,
      receivable: movements.receivable,
      received: movements.received,
    })
    .from(movements)
    .leftJoin(categories, eq(movements.categoryId, categories.id))
    .leftJoin(accounts, eq(movements.accountId, accounts.id))
    .where(eq(movements.userId, session.id))
    .orderBy(desc(movements.date), desc(movements.createdAt))
    .limit(20)

  // Calculate totals
  const totalsResult = await db
    .select({
      totalIncome: sql<number>`COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)`,
      totalExpense: sql<number>`COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)`,
    })
    .from(movements)
    .where(eq(movements.userId, session.id))

  const totals = totalsResult[0] || { totalIncome: 0, totalExpense: 0 }

  // Pending review count
  const reviewResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(movements)
    .where(and(eq(movements.userId, session.id), eq(movements.needsReview, true)))
  const pendingReviewCount = reviewResult[0]?.count ?? 0

  let usdClpRate: number | null = null
  try {
    usdClpRate = await getUsdToClpRate()
  } catch {}

  return (
    <HomePage
      email={session.email}
      accountBalances={accountBalances}
      totalBalance={totalBalance}
      totalIncome={totals.totalIncome}
      totalExpense={totals.totalExpense}
      movements={recentMovements}
      pendingReviewCount={pendingReviewCount}
      usdClpRate={usdClpRate}
    />
  )
}
