import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { getLoanDetail } from '@/lib/actions/loans'
import { db, movements, accounts } from '@/lib/db'
import { eq, and, isNull, desc } from 'drizzle-orm'
import { LoanDetailClient } from './loan-detail-client'

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

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
    .leftJoin(accounts, eq(movements.accountId, accounts.id))
    .where(and(
      eq(movements.userId, session.id),
      eq(movements.type, 'expense'),
      eq(movements.needsReview, false),
      eq(movements.receivable, false),
      eq(movements.emergency, false),
      eq(movements.loan, false),
      isNull(movements.loanId),
      isNull(movements.transferId),
      isNull(movements.transferPairId),
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
