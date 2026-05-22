'use server'

import { revalidatePath } from 'next/cache'
import { db, movements, accounts, emergencyPayments } from '@/lib/db'
import { eq, and, sql } from 'drizzle-orm'
import { getCurrentSpace } from '@/lib/spaces'
import { movementLedger } from '@/lib/domain/movement-ledger'

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

function displayAmount(amount: number, amountUsd: number | null, currency: 'CLP' | 'USD') {
  return currency === 'USD' ? (amountUsd ?? 0) : amount
}

/**
 * Get all unsettled emergency expenses for the current user
 */
export async function getUnsettledEmergencies(): Promise<UnsettledEmergency[]> {
  const { user: session, space } = await getCurrentSpace()

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
      totalPaid: sql<number>`COALESCE((SELECT SUM(amount) FROM emergency_payments WHERE emergency_id = ${movements.id} AND space_id = ${space.id}), 0)`,
    })
    .from(movements)
    .leftJoin(accounts, and(eq(movements.accountId, accounts.id), eq(accounts.spaceId, space.id)))
    .where(and(
      eq(movements.spaceId, space.id),
      eq(movements.emergency, true),
      eq(movements.emergencySettled, false),
    ))

  return results.map(r => {
    const currency = r.currency as 'CLP' | 'USD'
    const amount = displayAmount(r.amount, r.amountUsd, currency)
    const totalPaid = Math.min(Number(r.totalPaid), amount)
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
 * Get count of unsettled emergencies (for dashboard badge)
 */
export async function getUnsettledEmergencyCount(): Promise<number> {
  const { user: session, space } = await getCurrentSpace()

  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(movements)
    .where(and(
      eq(movements.spaceId, space.id),
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
  const { user: session, space } = await getCurrentSpace()

  // Verify the emergency belongs to this user
  const [emergency] = await db
    .select({ id: movements.id })
    .from(movements)
    .where(and(eq(movements.id, emergencyId), eq(movements.spaceId, space.id)))
    .limit(1)

  if (!emergency) return []

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
    .where(and(eq(emergencyPayments.emergencyId, emergencyId), eq(emergencyPayments.spaceId, space.id)))

  // Fetch Space-scoped account names separately
  const accountIds = [...new Set(results.flatMap(r => [r.fromAccountId, r.toAccountId]))]
  const accs = accountIds.length > 0
    ? await db.select({ id: accounts.id, bankName: accounts.bankName, emoji: accounts.emoji })
        .from(accounts).where(and(eq(accounts.spaceId, space.id), sql`${accounts.id} IN (${sql.join(accountIds.map(id => sql`${id}`), sql`,`)})`))
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
  const { user: session, space } = await getCurrentSpace()

  const [emergency] = await db
    .select({ id: movements.id })
    .from(movements)
    .where(and(
      eq(movements.id, emergencyId),
      eq(movements.spaceId, space.id),
      eq(movements.emergency, true),
    ))
    .limit(1)

  if (!emergency) return false

  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emergencyPayments)
    .where(and(eq(emergencyPayments.emergencyId, emergencyId), eq(emergencyPayments.spaceId, space.id)))

  return (result[0]?.count ?? 0) > 0
}

export interface SettleResult {
  success: boolean
  error?: string
  totalPaid?: number
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
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.settleEmergencyPartially(space.id, session.id, emergencyId, fromAccountId, toAccountId, amount, date)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/emergency')
    revalidatePath(`/emergency/${emergencyId}`)
    revalidatePath('/reports')
  }
  return result
}

/**
 * Mark an emergency expense as settled without creating a payment
 */
export async function settleEmergencyDirect(
  emergencyId: string,
): Promise<{ success: boolean; error?: string }> {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.settleEmergencyDirectly(space.id, emergencyId)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/emergency')
    revalidatePath(`/emergency/${emergencyId}`)
    revalidatePath('/reports')
  }
  return result
}

/**
 * Get a single emergency expense with full details
 */
export async function getEmergencyDetail(emergencyId: string) {
  const { user: session, space } = await getCurrentSpace()

  const [emergency] = await db
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
      emergencySettled: movements.emergencySettled,
    })
    .from(movements)
    .leftJoin(accounts, and(eq(movements.accountId, accounts.id), eq(accounts.spaceId, space.id)))
    .where(and(
      eq(movements.id, emergencyId),
      eq(movements.spaceId, space.id),
      eq(movements.emergency, true),
    ))
    .limit(1)

  if (!emergency) return null

  const payments = await getEmergencyPayments(emergencyId)
  const currency = emergency.currency as 'CLP' | 'USD'
  const amount = displayAmount(emergency.amount, emergency.amountUsd, currency)
  const totalPaid = Math.min(payments.reduce((sum, p) => sum + p.amount, 0), amount)

  return {
    ...emergency,
    amount,
    currency,
    totalPaid,
    remaining: Math.max(0, amount - totalPaid),
    payments,
  }
}
