import { getCurrentSpace } from '@/lib/spaces'
import { db, movements, categories, accounts, transfers } from '@/lib/db'
import { eq, desc, sql, and, gte } from 'drizzle-orm'
import { getAccountBalances, getNetLiquidity, type AccountWithBalanceSerialized, type NetLiquidityData } from '@/lib/actions/balances'
import { getUsdToClpRate } from '@/lib/exchange-rate'
import { getUnsettledEmergencyCount } from '@/lib/actions/emergency'
import { getUnsettledLoanCount } from '@/lib/actions/loans'
import { reportableMovementSqlFilters } from '@/lib/domain/reporting'
import { getPendingReviewItemCount } from '@/lib/domain/pending-review'
import { HomePage } from './home-client'

export default async function Home() {
  const { user: session, space } = await getCurrentSpace()

  // First fetch account balances (needed to determine if we need USD rate)
  const accountBalances = await getAccountBalances()
  
  // Only fetch USD rate if user has at least one USD account (avoids unnecessary API calls)
  const hasUsdAccount = accountBalances.some(a => a.currency === 'USD')

  const reportableMovementWhere = sql.join(reportableMovementSqlFilters(space.id), sql` AND `)

  // Run remaining data fetches in parallel for faster page load
  const [
    usdClpRate,
    recentMovements,
    totalsResult,
    pendingReviewCount,
    unsettledEmergencyCount,
    unsettledLoanCount,
    recentUnlinkedIncomes,
  ] = await Promise.all([
    // Exchange rate - only fetch if needed
    hasUsdAccount ? getUsdToClpRate().catch(() => null as number | null) : Promise.resolve(null),

    // Recent movements (last 20)
    db
      .select({
        id: movements.id,
        spaceId: movements.spaceId,
        categoryId: movements.categoryId,
        accountId: movements.accountId,
        name: movements.name,
        date: movements.date,
        amount: movements.amount,
        amountUsd: movements.amountUsd,
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
        transferId: sql<string | null>`(
          SELECT ${transfers.id}
          FROM ${transfers}
          WHERE (${transfers.sourceMovementId} = ${movements.id}
             OR ${transfers.destinationMovementId} = ${movements.id})
          LIMIT 1
        )`,
        transferOtherSpaceName: sql<string | null>`(
          SELECT CASE
            WHEN ${transfers.sourceMovementId} = ${movements.id} THEN destination_space.name
            ELSE source_space.name
          END
          FROM ${transfers}
          INNER JOIN spaces source_space ON source_space.id = ${transfers.sourceSpaceId}
          INNER JOIN spaces destination_space ON destination_space.id = ${transfers.destinationSpaceId}
          WHERE (${transfers.sourceMovementId} = ${movements.id}
             OR ${transfers.destinationMovementId} = ${movements.id})
            AND EXISTS (
              SELECT 1
              FROM space_memberships other_membership
              WHERE other_membership.user_id = ${session.id}
                AND other_membership.space_id = CASE
                  WHEN ${transfers.sourceMovementId} = ${movements.id} THEN ${transfers.destinationSpaceId}
                  ELSE ${transfers.sourceSpaceId}
                END
            )
          LIMIT 1
        )`,
      })
      .from(movements)
      .leftJoin(categories, and(eq(movements.categoryId, categories.id), eq(categories.spaceId, space.id)))
      .leftJoin(accounts, and(eq(movements.accountId, accounts.id), eq(accounts.spaceId, space.id)))
      .where(eq(movements.spaceId, space.id))
      .orderBy(desc(movements.date), desc(movements.createdAt))
      .limit(20),

    // Totals for confirmed reportable movements only
    db
      .select({
        totalIncome: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'income' THEN ${movements.amount} ELSE 0 END), 0)`,
        totalExpense: sql<number>`COALESCE(SUM(CASE WHEN ${movements.type} = 'expense' THEN ${movements.amount} ELSE 0 END), 0)`,
      })
      .from(movements)
      .where(reportableMovementWhere),

    // Pending review item count. Transfer roots count as one review item even when both legs are pending.
    getPendingReviewItemCount(space.id),

    // Unsettled emergency count
    getUnsettledEmergencyCount().catch(() => 0),

    // Unsettled loan count
    getUnsettledLoanCount().catch(() => 0),

    // Recent confirmed reportable incomes eligible for receivable matching
    db
      .select({
        id: movements.id,
        name: movements.name,
        date: movements.date,
        amount: movements.amount,
        amountUsd: movements.amountUsd,
        currency: movements.currency,
        accountBankName: accounts.bankName,
        accountLastFour: accounts.lastFourDigits,
        accountEmoji: accounts.emoji,
        categoryName: categories.name,
        categoryEmoji: categories.emoji,
      })
      .from(movements)
      .leftJoin(categories, and(eq(movements.categoryId, categories.id), eq(categories.spaceId, space.id)))
      .leftJoin(accounts, and(eq(movements.accountId, accounts.id), eq(accounts.spaceId, space.id)))
      .where(and(
        ...reportableMovementSqlFilters(space.id),
        eq(movements.type, 'income'),
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
  const netLiquidity: NetLiquidityData = await getNetLiquidity(usdClpRate ?? undefined, accountBalances)
  const serializedAccountBalances: AccountWithBalanceSerialized[] = accountBalances.map((account) => ({
    ...account,
    currentValueUpdatedAt: account.currentValueUpdatedAt?.toISOString() ?? null,
  }))
  // Serialize Date fields for client component
  const serializedMovements = recentMovements.map((m) => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }))

  return (
    <HomePage
      email={session.email}
      accountBalances={serializedAccountBalances}
      totalBalance={totalBalance}
      totalIncome={totals.totalIncome}
      totalExpense={totals.totalExpense}
      movements={serializedMovements}
      currentSpaceId={space.id}
      pendingReviewCount={pendingReviewCount}
      usdClpRate={usdClpRate}
      netLiquidity={netLiquidity}
      userAccounts={accountBalances.map(a => ({ id: a.id, bankName: a.bankName, lastFourDigits: a.lastFourDigits, emoji: a.emoji }))}
      recentUnlinkedIncomes={recentUnlinkedIncomes}
      unsettledEmergencyCount={unsettledEmergencyCount}
      unsettledLoanCount={unsettledLoanCount}
    />
  )
}
