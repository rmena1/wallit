import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { db, accounts, movements, categories } from '@/lib/db'
import { eq, and, desc, sql, asc } from 'drizzle-orm'
import dynamic from 'next/dynamic'

// Lazy-load the client component to defer Recharts bundle (~350KB) until needed
const AccountDetailClient = dynamic(
  () => import('./account-detail-client').then(m => m.AccountDetailClient),
  { loading: () => <AccountDetailSkeleton /> }
)

function AccountDetailSkeleton() {
  const shimmer: React.CSSProperties = {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    border: '1px solid #2a2a2a',
    animation: 'pulse 1.5s ease-in-out infinite',
  }
  return (
    <>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }`}</style>
      <header style={{
        backgroundColor: '#111111', borderBottom: '1px solid #1e1e1e',
        padding: '12px 16px', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ ...shimmer, width: 36, height: 36, borderRadius: 10 }} />
          <div>
            <div style={{ ...shimmer, width: 100, height: 16, marginBottom: 4 }} />
            <div style={{ ...shimmer, width: 80, height: 12 }} />
          </div>
        </div>
      </header>
      <main style={{ maxWidth: 540, margin: '0 auto', padding: '16px 16px 96px' }}>
        <div style={{ ...shimmer, height: 100, marginBottom: 16, borderRadius: 20 }} />
        <div style={{ ...shimmer, height: 240, marginBottom: 16 }} />
        <div style={{ ...shimmer, height: 14, width: 120, marginBottom: 10 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{ ...shimmer, height: 64 }} />
          ))}
        </div>
      </main>
    </>
  )
}

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
