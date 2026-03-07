import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { getEmergencyDetail } from '@/lib/actions/emergency'
import { db, accounts } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { EmergencyDetailClient } from './emergency-detail-client'

export default async function EmergencyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const emergency = await getEmergencyDetail(id)
  if (!emergency) notFound()

  const userAccounts = await db
    .select({ id: accounts.id, bankName: accounts.bankName, lastFourDigits: accounts.lastFourDigits, emoji: accounts.emoji })
    .from(accounts)
    .where(eq(accounts.userId, session.id))

  return <EmergencyDetailClient emergency={emergency} accounts={userAccounts} />
}
