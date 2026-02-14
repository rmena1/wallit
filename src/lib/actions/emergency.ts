'use server'

import { revalidatePath } from 'next/cache'
import { db, movements, accounts, emergencyPayments } from '@/lib/db'
import { eq, and, sql } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export interface UnsettledEmergency {
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
 * Get all unsettled emergency expenses for the current user
 */
export async function getUnsettledEmergencies(): Promise<UnsettledEmergency[]> {
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
      totalPaid: sql<number>`COALESCE((SELECT SUM(amount) FROM emergency_payments WHERE emergency_id = ${movements.id}), 0)`,
    })
    .from(movements)
    .leftJoin(accounts, eq(movements.accountId, accounts.id))
    .where(and(
      eq(movements.userId, session.id),
      eq(movements.emergency, true),
      eq(movements.emergencySettled, false),
    ))

  return results.map(r => ({
    ...r,
    currency: r.currency as 'CLP' | 'USD',
    totalPaid: Number(r.totalPaid),
    remaining: r.amount - Number(r.totalPaid),
  }))
}

/**
 * Get count of unsettled emergencies (for dashboard badge)
 */
export async function getUnsettledEmergencyCount(): Promise<number> {
  const session = await requireAuth()

  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(movements)
    .where(and(
      eq(movements.userId, session.id),
      eq(movements.emergency, true),
      eq(movements.emergencySettled, false),
    ))

  return result[0]?.count ?? 0
}

export interface EmergencyPaymentDetail {
  id: string
  amount: number
  date: string
  fromAccountId: string
  toAccountId: string
  fromAccountName: string | null
  fromAccountEmoji: string | null
  toAccountName: string | null
  toAccountEmoji: string | null
  transferId: string | null
}

/**
 * Get all payments for a specific emergency expense
 */
export async function getEmergencyPayments(emergencyId: string): Promise<EmergencyPaymentDetail[]> {
  const session = await requireAuth()

  // Verify the emergency belongs to this user
  const [emergency] = await db
    .select({ id: movements.id })
    .from(movements)
    .where(and(eq(movements.id, emergencyId), eq(movements.userId, session.id)))
    .limit(1)

  if (!emergency) return []

  // Alias for the two account joins
  const fromAcc = db
    .select({ id: accounts.id, bankName: accounts.bankName, emoji: accounts.emoji })
    .from(accounts)
    .as('from_acc')

  const toAcc = db
    .select({ id: accounts.id, bankName: accounts.bankName, emoji: accounts.emoji })
    .from(accounts)
    .as('to_acc')

  // Use raw SQL for the join since drizzle aliasing is complex
  const results = await db
    .select({
      id: emergencyPayments.id,
      amount: emergencyPayments.amount,
      date: emergencyPayments.date,
      fromAccountId: emergencyPayments.fromAccountId,
      toAccountId: emergencyPayments.toAccountId,
      transferId: emergencyPayments.transferId,
    })
    .from(emergencyPayments)
    .where(eq(emergencyPayments.emergencyId, emergencyId))

  // Fetch account names separately
  const accountIds = [...new Set(results.flatMap(r => [r.fromAccountId, r.toAccountId]))]
  const accs = accountIds.length > 0
    ? await db.select({ id: accounts.id, bankName: accounts.bankName, emoji: accounts.emoji })
        .from(accounts).where(sql`${accounts.id} IN (${sql.join(accountIds.map(id => sql`${id}`), sql`,`)})`)
    : []

  const accMap = new Map(accs.map(a => [a.id, a]))

  return results.map(r => ({
    ...r,
    fromAccountName: accMap.get(r.fromAccountId)?.bankName ?? null,
    fromAccountEmoji: accMap.get(r.fromAccountId)?.emoji ?? null,
    toAccountName: accMap.get(r.toAccountId)?.bankName ?? null,
    toAccountEmoji: accMap.get(r.toAccountId)?.emoji ?? null,
  }))
}

/**
 * Check if an emergency expense has any payments
 */
export async function hasEmergencyPayments(emergencyId: string): Promise<boolean> {
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emergencyPayments)
    .where(eq(emergencyPayments.emergencyId, emergencyId))

  return (result[0]?.count ?? 0) > 0
}

export interface SettleResult {
  success: boolean
  error?: string
  remaining?: number
  settled?: boolean
}

/**
 * Make a partial payment towards settling an emergency expense
 */
export async function settleEmergencyPartial(
  emergencyId: string,
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  date: string,
): Promise<SettleResult> {
  const session = await requireAuth()

  if (amount <= 0) {
    return { success: false, error: 'El monto debe ser mayor a 0' }
  }

  // Verify the emergency belongs to this user and is unsettled
  const [emergency] = await db
    .select({ id: movements.id, amount: movements.amount, emergencySettled: movements.emergencySettled, accountId: movements.accountId })
    .from(movements)
    .where(and(
      eq(movements.id, emergencyId),
      eq(movements.userId, session.id),
      eq(movements.emergency, true),
    ))
    .limit(1)

  if (!emergency) {
    return { success: false, error: 'Gasto de emergencia no encontrado' }
  }

  if (emergency.emergencySettled) {
    return { success: false, error: 'Este gasto de emergencia ya está saldado' }
  }

  // Verify both accounts belong to this user
  const [fromAccount, toAccount] = await Promise.all([
    db.select({ id: accounts.id, bankName: accounts.bankName, currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.id, fromAccountId), eq(accounts.userId, session.id)))
      .limit(1),
    db.select({ id: accounts.id, bankName: accounts.bankName, currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.id, toAccountId), eq(accounts.userId, session.id)))
      .limit(1),
  ])

  if (!fromAccount[0]) return { success: false, error: 'Cuenta origen no válida' }
  if (!toAccount[0]) return { success: false, error: 'Cuenta destino no válida' }

  let transferId: string | null = null

  // If accounts are different, create a transfer (pair of movements)
  if (fromAccountId !== toAccountId) {
    transferId = generateId()
    const fromMovementId = generateId()
    const toMovementId = generateId()

    await db.insert(movements).values([
      {
        id: fromMovementId,
        userId: session.id,
        accountId: fromAccountId,
        categoryId: null,
        name: `Abono emergencia: ${emergency.accountId ? 'pago' : 'pago'}`,
        date,
        amount,
        type: 'expense',
        currency: 'CLP',
        transferId,
        transferPairId: toMovementId,
      },
      {
        id: toMovementId,
        userId: session.id,
        accountId: toAccountId,
        categoryId: null,
        name: `Abono emergencia: recibido`,
        date,
        amount,
        type: 'income',
        currency: 'CLP',
        transferId,
        transferPairId: fromMovementId,
      },
    ])
  }

  // Insert emergency payment record
  await db.insert(emergencyPayments).values({
    id: generateId(),
    emergencyId,
    fromAccountId,
    toAccountId,
    amount,
    date,
    transferId,
  })

  // Check if fully settled
  const [totalResult] = await db
    .select({ total: sql<number>`COALESCE(SUM(amount), 0)` })
    .from(emergencyPayments)
    .where(eq(emergencyPayments.emergencyId, emergencyId))

  const totalPaid = Number(totalResult?.total ?? 0)
  const remaining = emergency.amount - totalPaid
  const settled = remaining <= 0

  if (settled) {
    await db.update(movements)
      .set({ emergencySettled: true, updatedAt: new Date() })
      .where(eq(movements.id, emergencyId))
  }

  revalidatePath('/')
  return { success: true, remaining: Math.max(0, remaining), settled }
}

/**
 * Get a single emergency expense with full details
 */
export async function getEmergencyDetail(emergencyId: string) {
  const session = await requireAuth()

  const [emergency] = await db
    .select({
      id: movements.id,
      name: movements.name,
      amount: movements.amount,
      date: movements.date,
      currency: movements.currency,
      accountId: movements.accountId,
      accountBankName: accounts.bankName,
      accountEmoji: accounts.emoji,
      emergencySettled: movements.emergencySettled,
    })
    .from(movements)
    .leftJoin(accounts, eq(movements.accountId, accounts.id))
    .where(and(
      eq(movements.id, emergencyId),
      eq(movements.userId, session.id),
      eq(movements.emergency, true),
    ))
    .limit(1)

  if (!emergency) return null

  const payments = await getEmergencyPayments(emergencyId)
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0)

  return {
    ...emergency,
    totalPaid,
    remaining: emergency.amount - totalPaid,
    payments,
  }
}
