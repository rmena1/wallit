import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getUnsettledEmergencies } from '@/lib/actions/emergency'
import { EmergencyListClient } from './emergency-list-client'

export default async function EmergencyPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const emergencies = await getUnsettledEmergencies()

  return <EmergencyListClient emergencies={emergencies} />
}
