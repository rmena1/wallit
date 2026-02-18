'use server'

import { revalidatePath } from 'next/cache'
import { db, movements, accounts } from '@/lib/db'
import { eq, and, sql, desc } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'

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
      date: movements.date,
      currency: movements.currency,
      accountId: movements.accountId,
      accountBankName: accounts.bankName,
      accountEmoji: accounts.emoji,
      totalPaid: sql<number>`COALESCE((SELECT SUM(amount) FROM movements paybacks WHERE paybacks.loan_id = ${movements.id} AND paybacks.user_id = ${session.id} AND paybacks.type = 'expense'), 0)`,
    })
    .from(movements)
    .leftJoin(accounts, eq(movements.accountId, accounts.id))
    .where(and(
      eq(movements.userId, session.id),
      eq(movements.type, 'income'),
      eq(movements.loan, true),
      eq(movements.loanSettled, false),
    ))

  return results.map((r) => ({
    ...r,
    currency: r.currency as 'CLP' | 'USD',
    totalPaid: Number(r.totalPaid),
    remaining: Math.max(0, r.amount - Number(r.totalPaid)),
  }))
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

  const totalPaidFromExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const totalPaid = loan.loanSettled
    ? Math.max(totalPaidFromExpenses, loan.amount)
    : totalPaidFromExpenses

  return {
    ...loan,
    currency: loan.currency as 'CLP' | 'USD',
    totalPaid,
    remaining: Math.max(0, loan.amount - totalPaid),
    expenses: expenses.map((expense) => ({
      ...expense,
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
  date?: string,
): Promise<SettleLoanResult> {
  const settleDate = date || new Date().toISOString().slice(0, 10)
  const session = await requireAuth()

  const [loan] = await db
    .select({
      id: movements.id,
      amount: movements.amount,
      loanSettled: movements.loanSettled,
    })
    .from(movements)
    .where(and(
      eq(movements.id, loanId),
      eq(movements.userId, session.id),
      eq(movements.type, 'income'),
      eq(movements.loan, true),
    ))
    .limit(1)

  if (!loan) {
    return { success: false, error: 'Préstamo no encontrado' }
  }

  if (loan.loanSettled) {
    return { success: false, error: 'Este préstamo ya está saldado' }
  }

  if (expenseMovementId === 'cash') {
    await db
      .update(movements)
      .set({ loanSettled: true, updatedAt: new Date() })
      .where(and(eq(movements.id, loanId), eq(movements.userId, session.id)))

    revalidatePath('/')
    revalidatePath('/loans')
    revalidatePath(`/loans/${loanId}`)

    return {
      success: true,
      remaining: 0,
      settled: true,
      totalPaid: loan.amount,
    }
  }

  const [expense] = await db
    .select({
      id: movements.id,
      loanId: movements.loanId,
      type: movements.type,
    })
    .from(movements)
    .where(and(eq(movements.id, expenseMovementId), eq(movements.userId, session.id)))
    .limit(1)

  if (!expense) {
    return { success: false, error: 'Gasto no encontrado' }
  }

  if (expense.type !== 'expense') {
    return { success: false, error: 'El movimiento seleccionado no es un gasto' }
  }

  if (expense.loanId === loanId) {
    return { success: false, error: 'Este gasto ya está vinculado a este préstamo' }
  }

  if (expense.loanId) {
    return { success: false, error: 'Este gasto ya está vinculado a otro préstamo' }
  }

  await db
    .update(movements)
    .set({
      loanId,
      updatedAt: new Date(),
    })
    .where(and(eq(movements.id, expenseMovementId), eq(movements.userId, session.id)))

  const [totalResult] = await db
    .select({ total: sql<number>`COALESCE(SUM(${movements.amount}), 0)` })
    .from(movements)
    .where(and(
      eq(movements.userId, session.id),
      eq(movements.type, 'expense'),
      eq(movements.loanId, loanId),
    ))

  const totalPaid = Number(totalResult?.total ?? 0)
  const remaining = Math.max(0, loan.amount - totalPaid)
  const settled = remaining <= 0

  await db
    .update(movements)
    .set({ loanSettled: settled, updatedAt: new Date() })
    .where(and(eq(movements.id, loanId), eq(movements.userId, session.id)))

  revalidatePath('/')
  revalidatePath('/loans')
  revalidatePath(`/loans/${loanId}`)

  return {
    success: true,
    remaining,
    settled,
    totalPaid,
  }
}
