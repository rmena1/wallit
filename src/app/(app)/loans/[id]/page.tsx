import { getCurrentSpace } from '@/lib/spaces'
import { redirect, notFound } from 'next/navigation'
import { getLoanDetail } from '@/lib/actions/loans'
import { db, movements, accounts, transfers } from '@/lib/db'
import { eq, and, isNull, desc, sql } from 'drizzle-orm'
import { LoanDetailClient } from './loan-detail-client'

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user: session, space } = await getCurrentSpace()

  const { id } = await params
  const loan = await getLoanDetail(id)
  if (!loan) notFound()

  const candidateExpenses = await db
    .select({
      id: movements.id,
      name: movements.name,
      amount: movements.amount,
      amountUsd: movements.amountUsd,
      date: movements.date,
      currency: movements.currency,
      accountBankName: accounts.bankName,
      accountLastFour: accounts.lastFourDigits,
      accountEmoji: accounts.emoji,
    })
    .from(movements)
    .leftJoin(accounts, and(eq(movements.accountId, accounts.id), eq(accounts.spaceId, space.id)))
    .where(and(
      eq(movements.spaceId, space.id),
      eq(movements.type, 'expense'),
      eq(movements.needsReview, false),
      eq(movements.receivable, false),
      eq(movements.emergency, false),
      eq(movements.loan, false),
      isNull(movements.loanId),
      sql`NOT EXISTS (
        SELECT 1 FROM ${transfers}
        WHERE ${transfers.sourceMovementId} = ${movements.id}
           OR ${transfers.destinationMovementId} = ${movements.id}
      )`,
      isNull(movements.receivableId),
    ))
    .orderBy(desc(movements.date), desc(movements.createdAt))
    .limit(30)

  const loanCurrency = loan.currency as 'CLP' | 'USD'
  const displayCandidateExpenses = candidateExpenses
    .filter((expense) => loanCurrency === 'CLP' || expense.amountUsd != null)
    .map((expense) => ({
      ...expense,
      amount: loanCurrency === 'USD' && expense.amountUsd != null ? expense.amountUsd : expense.amount,
    }))

  return <LoanDetailClient loan={loan} candidateExpenses={displayCandidateExpenses} />
}
