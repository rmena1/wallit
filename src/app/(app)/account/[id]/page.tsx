import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { db, accounts, movements, categories } from '@/lib/db'
import { eq, and, desc, asc, sql, isNotNull, gte } from 'drizzle-orm'
import dynamic from 'next/dynamic'
import { getAccountBalances } from '@/lib/actions/balances'
import { getInvestmentSummary, getInvestmentSnapshots } from '@/lib/actions/investments'

const AccountDetailClient = dynamic(
  () => import('./account-detail-client').then((m) => m.AccountDetailClient),
  { loading: () => <AccountDetailSkeleton /> }
)

function AccountDetailSkeleton() {
  const shimmer: React.CSSProperties = {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    border: '1px solid #2a2a4a',
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
        <div style={{ ...shimmer, height: 110, marginBottom: 14, borderRadius: 16 }} />
        <div style={{ ...shimmer, height: 110, marginBottom: 14, borderRadius: 16 }} />
        <div style={{ ...shimmer, height: 14, width: 120, marginBottom: 10 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ ...shimmer, height: 64 }} />
          ))}
        </div>
      </main>
    </>
  )
}

const MOVEMENTS_PAGE_SIZE = 50

interface Props {
  params: Promise<{ id: string }>
}

export default async function AccountDetailPage({ params }: Props) {
  const session = await getSession()
  if (!session) {
    redirect('/login')
  }

  const { id } = await params

  const [account] = await db
    .select({
      id: accounts.id,
      bankName: accounts.bankName,
      accountType: accounts.accountType,
      lastFourDigits: accounts.lastFourDigits,
      initialBalance: accounts.initialBalance,
      isInvestment: accounts.isInvestment,
      currentValue: accounts.currentValue,
      currentValueUpdatedAt: accounts.currentValueUpdatedAt,
      currency: accounts.currency,
      color: accounts.color,
      emoji: accounts.emoji,
    })
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, session.id)))
    .limit(1)

  if (!account) {
    notFound()
  }

  const movementsWhere = account.isInvestment
    ? and(eq(movements.accountId, id), eq(movements.userId, session.id), isNotNull(movements.transferId))
    : and(eq(movements.accountId, id), eq(movements.userId, session.id))

  const [accountMovements, countResult, accountBalances, investmentSummary, investmentSnapshots] = await Promise.all([
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
        transferId: movements.transferId,
        transferPairId: movements.transferPairId,
        categoryName: categories.name,
        categoryEmoji: categories.emoji,
      })
      .from(movements)
      .leftJoin(categories, eq(movements.categoryId, categories.id))
      .where(movementsWhere)
      .orderBy(desc(movements.date), desc(movements.createdAt))
      .limit(MOVEMENTS_PAGE_SIZE),

    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(movements)
      .where(movementsWhere),

    getAccountBalances(),

    account.isInvestment ? getInvestmentSummary(id) : Promise.resolve(null),
    account.isInvestment ? getInvestmentSnapshots(id) : Promise.resolve([]),
  ])

  const balanceData = accountBalances.find((a) => a.id === id)
  const balance = balanceData?.balance ?? (account.currentValue ?? account.initialBalance)
  const totalCount = countResult[0]?.count ?? 0
  const hasMore = totalCount > MOVEMENTS_PAGE_SIZE

  // Compute balance history
  let balanceHistory: { date: string, balance: number, currency: 'CLP' | 'USD' }[] = []
  if (account.isInvestment && investmentSnapshots.length > 0) {
    balanceHistory = [...investmentSnapshots].reverse().map((s) => ({ date: s.date, balance: s.value, currency: account.currency }))
  } else {
    // Get movements from last 180 days sorted by date asc for balance history
    const cutoffDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const allMovements = await db.select({ date: movements.date, amount: movements.amount, type: movements.type, amountUsd: movements.amountUsd }).from(movements).where(and(eq(movements.accountId, id), eq(movements.userId, session.id), gte(movements.date, cutoffDate))).orderBy(asc(movements.date), asc(movements.createdAt))
    let running = account.initialBalance
    const byDate = new Map<string, number>()
    for (const m of allMovements) {
      const amt = account.currency === 'USD' && m.amountUsd ? m.amountUsd : m.amount
      running += m.type === 'income' ? amt : -amt
      byDate.set(m.date, running)
    }
    balanceHistory = Array.from(byDate.entries()).map(([date, balance]) => ({ date, balance, currency: account.currency }))
  }

  return (
    <AccountDetailClient
      account={account}
      balance={balance}
      balanceHistory={balanceHistory}
      movements={accountMovements}
      totalCount={totalCount}
      hasMore={hasMore}
      investmentSummary={investmentSummary}
      investmentSnapshots={investmentSnapshots}
    />
  )
}
