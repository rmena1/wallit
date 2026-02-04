import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { db, accounts, movements, categories } from '@/lib/db'
import { eq, and, desc, sql, asc } from 'drizzle-orm'
import { AccountDetailClient } from './account-detail-client'

const MOVEMENTS_PAGE_SIZE = 50

interface Props {
  params: Promise<{ accountId: string }>
}

export default async function AccountDetailPage({ params }: Props) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { accountId } = await params

  // Fetch account
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, session.id)))
    .limit(1)

  if (!account) notFound()

  // Fetch first page of movements, balance, balance history, and total count in parallel
  const [accountMovements, balanceResult, balanceHistory, countResult] = await Promise.all([
    // Page 1 of movements (limited)
    db
      .select({
        id: movements.id,
        name: movements.name,
        date: movements.date,
        amount: movements.amount,
        type: movements.type,
        currency: movements.currency,
        amountUsd: movements.amountUsd,
        time: movements.time,
        originalName: movements.originalName,
        receivable: movements.receivable,
        received: movements.received,
        categoryName: categories.name,
        categoryEmoji: categories.emoji,
      })
      .from(movements)
      .leftJoin(categories, eq(movements.categoryId, categories.id))
      .where(and(eq(movements.accountId, accountId), eq(movements.userId, session.id)))
      .orderBy(desc(movements.date), desc(movements.createdAt))
      .limit(MOVEMENTS_PAGE_SIZE),

    // Balance calculation
    db
      .select({
        incomeSum: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'income' THEN CASE WHEN ${accounts.currency} = 'USD' THEN COALESCE(${movements.amountUsd}, 0) ELSE ${movements.amount} END ELSE 0 END), 0)`,
        expenseSum: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'expense' THEN CASE WHEN ${accounts.currency} = 'USD' THEN COALESCE(${movements.amountUsd}, 0) ELSE ${movements.amount} END ELSE 0 END), 0)`,
      })
      .from(accounts)
      .leftJoin(movements, and(eq(accounts.id, movements.accountId), eq(movements.userId, session.id)))
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, session.id)))
      .groupBy(accounts.id),

    // Balance history: fetch only date + net per day (lightweight aggregation)
    db
      .select({
        date: movements.date,
        net: account.currency === 'USD'
          ? sql<number>`SUM(CASE WHEN ${movements.type} = 'income' THEN COALESCE(${movements.amountUsd}, 0) ELSE -1 * COALESCE(${movements.amountUsd}, 0) END)`
          : sql<number>`SUM(CASE WHEN ${movements.type} = 'income' THEN ${movements.amount} ELSE -1 * ${movements.amount} END)`,
      })
      .from(movements)
      .where(and(eq(movements.accountId, accountId), eq(movements.userId, session.id)))
      .groupBy(movements.date)
      .orderBy(asc(movements.date)),

    // Total count for "has more" indicator
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(movements)
      .where(and(eq(movements.accountId, accountId), eq(movements.userId, session.id))),
  ])

  const bal = balanceResult[0]
  const balance = account.initialBalance + (bal?.incomeSum ?? 0) - (bal?.expenseSum ?? 0)
  const totalCount = countResult[0]?.count ?? 0
  const hasMore = totalCount > MOVEMENTS_PAGE_SIZE

  // Build cumulative balance from daily net aggregates (much less data than all movements)
  const balanceByDate: { date: string; balance: number }[] = []
  if (balanceHistory.length > 0) {
    const firstDate = balanceHistory[0].date
    const d = new Date(firstDate + 'T00:00:00')
    d.setDate(d.getDate() - 1)
    balanceByDate.push({ date: d.toISOString().slice(0, 10), balance: account.initialBalance })
  }
  let runningBalance = account.initialBalance
  for (const row of balanceHistory) {
    runningBalance += Number(row.net)
    balanceByDate.push({ date: row.date, balance: runningBalance })
  }

  return (
    <AccountDetailClient
      account={{
        id: account.id,
        bankName: account.bankName,
        accountType: account.accountType,
        lastFourDigits: account.lastFourDigits,
        currency: account.currency,
        color: account.color,
        emoji: account.emoji,
      }}
      balance={balance}
      movements={accountMovements}
      balanceHistory={balanceByDate}
      totalCount={totalCount}
      hasMore={hasMore}
    />
  )
}
