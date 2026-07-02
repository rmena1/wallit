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
  const { user: session, space, spaces: availableSpaces } = await getCurrentSpace()

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
    regularUnlinkedIncomes,
    incomingTransferCandidates,
    settlementAccounts,
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
        exchangeRate: movements.exchangeRate,
        type: movements.type,
        reportable: movements.reportable,
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
        kind: sql<'income'>`'income'`,
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
        sourceSpaceId: sql<string | null>`NULL`,
        sourceSpaceName: sql<string | null>`NULL`,
        sourceSpaceEmoji: sql<string | null>`NULL`,
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

    // Incoming inter-Space Transfers eligible for receivable settlement.
    db
      .select({
        kind: sql<'transfer'>`'transfer'`,
        id: movements.id,
        name: movements.name,
        date: movements.date,
        amount: movements.amount,
        amountUsd: movements.amountUsd,
        currency: movements.currency,
        accountBankName: accounts.bankName,
        accountLastFour: accounts.lastFourDigits,
        accountEmoji: accounts.emoji,
        categoryName: sql<string | null>`NULL`,
        categoryEmoji: sql<string | null>`NULL`,
        sourceSpaceId: transfers.sourceSpaceId,
        sourceSpaceName: sql<string | null>`(
          SELECT source_space.name
          FROM spaces source_space
          WHERE source_space.id = ${transfers.sourceSpaceId}
          LIMIT 1
        )`,
        sourceSpaceEmoji: sql<string | null>`(
          SELECT source_space.emoji
          FROM spaces source_space
          WHERE source_space.id = ${transfers.sourceSpaceId}
          LIMIT 1
        )`,
      })
      .from(transfers)
      .innerJoin(movements, eq(transfers.destinationMovementId, movements.id))
      .leftJoin(accounts, and(eq(movements.accountId, accounts.id), eq(accounts.spaceId, space.id)))
      .where(and(
        eq(transfers.destinationSpaceId, space.id),
        sql`${transfers.sourceSpaceId} <> ${transfers.destinationSpaceId}`,
        eq(movements.needsReview, false),
        sql`${movements.receivableId} IS NULL`,
        sql`${movements.loanId} IS NULL`,
        sql`(${movements.receivable} = false OR ${movements.receivable} IS NULL)`,
        sql`(${movements.emergency} = false OR ${movements.emergency} IS NULL)`,
        sql`(${movements.loan} = false OR ${movements.loan} IS NULL)`,
        sql`NOT EXISTS (
          SELECT 1
          FROM emergency_payments emergency_payment
          WHERE emergency_payment.transfer_id = ${transfers.id}
        )`,
        sql`NOT EXISTS (
          SELECT 1
          FROM receivable_settlements settlement
          WHERE settlement.consumed_transfer_id = ${transfers.id}
             OR settlement.outgoing_movement_id = ${transfers.sourceMovementId}
             OR settlement.incoming_movement_id = ${transfers.destinationMovementId}
        )`,
        sql`EXISTS (
          SELECT 1
          FROM movements source_movement
          WHERE source_movement.id = ${transfers.sourceMovementId}
            AND source_movement.needs_review = false
            AND source_movement.receivable_id IS NULL
            AND source_movement.loan_id IS NULL
            AND (source_movement.receivable = false OR source_movement.receivable IS NULL)
            AND (source_movement.emergency = false OR source_movement.emergency IS NULL)
            AND (source_movement.loan = false OR source_movement.loan IS NULL)
        )`,
        sql`EXISTS (
          SELECT 1
          FROM space_memberships source_membership
          WHERE source_membership.user_id = ${session.id}
            AND source_membership.space_id = ${transfers.sourceSpaceId}
        )`,
      ))
      .orderBy(desc(movements.date), desc(movements.createdAt))
      .limit(20),

    // Accounts from every accessible Space for cross-Space receivable settlement.
    db
      .select({
        id: accounts.id,
        spaceId: accounts.spaceId,
        bankName: accounts.bankName,
        lastFourDigits: accounts.lastFourDigits,
        emoji: accounts.emoji,
        currency: accounts.currency,
      })
      .from(accounts)
      .where(sql`${accounts.spaceId} IN (${sql.join(availableSpaces.map((s) => sql`${s.id}`), sql`, `)})`)
      .orderBy(accounts.bankName),
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
  const recentUnlinkedIncomes = [...regularUnlinkedIncomes, ...incomingTransferCandidates]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30)

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
      userAccounts={accountBalances.map(a => ({ id: a.id, bankName: a.bankName, lastFourDigits: a.lastFourDigits, emoji: a.emoji, currency: a.currency }))}
      recentUnlinkedIncomes={recentUnlinkedIncomes}
      settlementSpaces={availableSpaces.map((s) => ({ id: s.id, name: s.name, emoji: s.emoji, isCurrent: s.id === space.id, hasAccounts: settlementAccounts.some((a) => a.spaceId === s.id) }))}
      settlementAccounts={settlementAccounts}
      unsettledEmergencyCount={unsettledEmergencyCount}
      unsettledLoanCount={unsettledLoanCount}
    />
  )
}
