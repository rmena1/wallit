import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db, movements, categories, accounts } from '@/lib/db'
import { eq, desc, sql, and, isNull, gte } from 'drizzle-orm'
import { getAccountBalances } from '@/lib/actions/balances'
import { getUsdToClpRate } from '@/lib/exchange-rate'
import { HomePage } from './home-client'

export default async function Home() {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  // First fetch account balances (needed to determine if we need USD rate)
  const accountBalances = await getAccountBalances()
  
  // Only fetch USD rate if user has at least one USD account (avoids unnecessary API calls)
  const hasUsdAccount = accountBalances.some(a => a.currency === 'USD')

  // Run remaining data fetches in parallel for faster page load
  const [
    usdClpRate,
    recentMovements,
    totalsResult,
    reviewResult,
    recentUnlinkedIncomes,
  ] = await Promise.all([
    // Exchange rate - only fetch if needed
    hasUsdAccount ? getUsdToClpRate().catch(() => null as number | null) : Promise.resolve(null),

    // Recent movements (last 20)
    db
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
        currency: movements.currency,
        receivable: movements.receivable,
        received: movements.received,
        receivableId: movements.receivableId,
        time: movements.time,
        originalName: movements.originalName,
        transferId: movements.transferId,
        transferPairId: movements.transferPairId,
      })
      .from(movements)
      .leftJoin(categories, eq(movements.categoryId, categories.id))
      .leftJoin(accounts, eq(movements.accountId, accounts.id))
      .where(eq(movements.userId, session.id))
      .orderBy(desc(movements.date), desc(movements.createdAt))
      .limit(20),

    // Totals (excluding transfers and receivables)
    db
      .select({
        totalIncome: sql<number>`COALESCE(SUM(CASE WHEN type = 'income' AND (${movements.receivable} = 0 OR ${movements.receivable} IS NULL) AND (${movements.receivableId} IS NULL) AND (${movements.transferId} IS NULL) THEN amount ELSE 0 END), 0)`,
        totalExpense: sql<number>`COALESCE(SUM(CASE WHEN type = 'expense' AND (${movements.receivable} = 0 OR ${movements.receivable} IS NULL) AND (${movements.transferId} IS NULL) THEN amount ELSE 0 END), 0)`,
      })
      .from(movements)
      .where(eq(movements.userId, session.id)),

    // Pending review count
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(movements)
      .where(and(eq(movements.userId, session.id), eq(movements.needsReview, true))),

    // Recent unlinked incomes (last 30 days, no receivableId, type=income)
    db
      .select({
        id: movements.id,
        name: movements.name,
        date: movements.date,
        amount: movements.amount,
        currency: movements.currency,
        accountBankName: accounts.bankName,
        accountLastFour: accounts.lastFourDigits,
        accountEmoji: accounts.emoji,
        categoryName: categories.name,
        categoryEmoji: categories.emoji,
      })
      .from(movements)
      .leftJoin(categories, eq(movements.categoryId, categories.id))
      .leftJoin(accounts, eq(movements.accountId, accounts.id))
      .where(and(
        eq(movements.userId, session.id),
        eq(movements.type, 'income'),
        isNull(movements.receivableId),
        eq(movements.receivable, false),
        eq(movements.needsReview, false),
        gte(movements.date, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
      ))
      .orderBy(desc(movements.date), desc(movements.createdAt))
      .limit(20),
  ])

  // Compute total balance from parallel results
  const totalBalance = accountBalances.reduce((sum, a) => {
    if (a.currency === 'USD' && usdClpRate) {
      return sum + Math.round(a.balance * usdClpRate / 100)
    }
    return sum + a.balance
  }, 0)

  const totals = totalsResult[0] || { totalIncome: 0, totalExpense: 0 }
  const pendingReviewCount = reviewResult[0]?.count ?? 0

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
      userAccounts={accountBalances.map(a => ({ id: a.id, bankName: a.bankName, lastFourDigits: a.lastFourDigits, emoji: a.emoji }))}
      recentUnlinkedIncomes={recentUnlinkedIncomes}
    />
  )
}
