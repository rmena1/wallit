'use server'

import { revalidatePath } from 'next/cache'
import { db, movements, accounts } from '@/lib/db'
import { eq, and, sql, desc } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'
import { movementLedger } from '@/lib/domain/movement-ledger'

export interface UnsettledLoan {
  id: string
  name: string
  amount: number
  date: string
  currency: 'CLP' | 'USD'
  accountId: string | null
  accountBankName: string | null
  accountEmoji: string | null
  totalPaid: number
  remaining: number
}

function displayAmount(amount: number, amountUsd: number | null, currency: 'CLP' | 'USD') {
  return currency === 'USD' ? (amountUsd ?? 0) : amount
}

/**
 * Get all unsettled loans for the current user
 */
export async function getUnsettledLoans(): Promise<UnsettledLoan[]> {
  const session = await requireAuth()

  const results = await db
    .select({
      id: movements.id,
      name: movements.name,
      amount: movements.amount,
      amountUsd: movements.amountUsd,
      date: movements.date,
      currency: movements.currency,
      accountId: movements.accountId,
      accountBankName: accounts.bankName,
      accountEmoji: accounts.emoji,
      totalPaid: sql<number>`COALESCE((
        SELECT SUM(
          CASE
            WHEN ${movements.currency} = 'USD' THEN paybacks.amount_usd
            ELSE paybacks.amount
          END
        )
        FROM movements paybacks
        WHERE paybacks.loan_id = ${movements.id}
          AND paybacks.user_id = ${session.id}
          AND paybacks.type = 'expense'
      ), 0)`,
    })
    .from(movements)
    .leftJoin(accounts, eq(movements.accountId, accounts.id))
    .where(and(
      eq(movements.userId, session.id),
      eq(movements.type, 'income'),
      eq(movements.loan, true),
      eq(movements.loanSettled, false),
    ))

  return results.map((r) => {
    const currency = r.currency as 'CLP' | 'USD'
    const amount = displayAmount(r.amount, r.amountUsd, currency)
    const totalPaid = Number(r.totalPaid)
    return {
      ...r,
      amount,
      currency,
      totalPaid,
      remaining: Math.max(0, amount - totalPaid),
    }
  })
}

/**
 * Get count of unsettled loans (for dashboard badge)
 */
export async function getUnsettledLoanCount(): Promise<number> {
  const session = await requireAuth()

  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(movements)
    .where(and(
      eq(movements.userId, session.id),
      eq(movements.type, 'income'),
      eq(movements.loan, true),
      eq(movements.loanSettled, false),
    ))

  return result[0]?.count ?? 0
}

export interface LoanPaybackExpense {
  id: string
  name: string
  amount: number
  date: string
  currency: 'CLP' | 'USD'
  accountId: string | null
  accountBankName: string | null
  accountEmoji: string | null
}

/**
 * Check if a loan has any linked payback expenses
 */
export async function hasLoanPaybackExpenses(loanId: string): Promise<boolean> {
  const session = await requireAuth()

  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(movements)
    .where(and(
      eq(movements.userId, session.id),
      eq(movements.type, 'expense'),
      eq(movements.loanId, loanId),
    ))

  return (result[0]?.count ?? 0) > 0
}

/**
 * Get a single loan with linked payback expenses
 */
export async function getLoanDetail(loanId: string) {
  const session = await requireAuth()

  const [loan] = await db
    .select({
      id: movements.id,
      name: movements.name,
      amount: movements.amount,
      amountUsd: movements.amountUsd,
      date: movements.date,
      currency: movements.currency,
      accountId: movements.accountId,
      accountBankName: accounts.bankName,
      accountEmoji: accounts.emoji,
      loanSettled: movements.loanSettled,
    })
    .from(movements)
    .leftJoin(accounts, eq(movements.accountId, accounts.id))
    .where(and(
      eq(movements.id, loanId),
      eq(movements.userId, session.id),
      eq(movements.type, 'income'),
      eq(movements.loan, true),
    ))
    .limit(1)

  if (!loan) return null

  const expenses = await db
    .select({
      id: movements.id,
      name: movements.name,
      amount: movements.amount,
      amountUsd: movements.amountUsd,
      date: movements.date,
      currency: movements.currency,
      accountId: movements.accountId,
      accountBankName: accounts.bankName,
      accountEmoji: accounts.emoji,
    })
    .from(movements)
    .leftJoin(accounts, eq(movements.accountId, accounts.id))
    .where(and(
      eq(movements.userId, session.id),
      eq(movements.type, 'expense'),
      eq(movements.loanId, loanId),
    ))
    .orderBy(desc(movements.date), desc(movements.createdAt))

  const loanCurrency = loan.currency as 'CLP' | 'USD'
  const loanAmount = displayAmount(loan.amount, loan.amountUsd, loanCurrency)
  const totalPaidFromExpenses = expenses.reduce((sum, expense) => (
    sum + displayAmount(expense.amount, expense.amountUsd, loanCurrency)
  ), 0)
  const totalPaid = loan.loanSettled
    ? Math.max(totalPaidFromExpenses, loanAmount)
    : totalPaidFromExpenses

  return {
    ...loan,
    amount: loanAmount,
    currency: loanCurrency,
    totalPaid,
    remaining: Math.max(0, loanAmount - totalPaid),
    expenses: expenses.map((expense) => ({
      ...expense,
      amount: displayAmount(expense.amount, expense.amountUsd, loanCurrency),
      currency: expense.currency as 'CLP' | 'USD',
    })),
  }
}

export interface SettleLoanResult {
  success: boolean
  error?: string
  remaining?: number
  settled?: boolean
  totalPaid?: number
}

/**
 * Settle a loan using an existing expense movement or cash settlement
 */
export async function settleLoan(
  loanId: string,
  expenseMovementId: string | 'cash',
  date: string,
): Promise<SettleLoanResult> {
  const session = await requireAuth()
  const result = expenseMovementId === 'cash'
    ? await movementLedger.settleLoanWithCash(session.id, loanId)
    : await movementLedger.settleLoanWithExistingMovement(session.id, loanId, expenseMovementId, date)

  if (result.success) {
    revalidatePath('/')
    revalidatePath('/loans')
    revalidatePath(`/loans/${loanId}`)
    revalidatePath('/reports')
  }

  return result
}
