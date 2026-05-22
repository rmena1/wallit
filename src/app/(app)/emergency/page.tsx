import { getCurrentSpace } from '@/lib/spaces'
import { redirect } from 'next/navigation'
import { getUnsettledEmergencies } from '@/lib/actions/emergency'
import { EmergencyListClient } from './emergency-list-client'

export default async function EmergencyPage() {
  const { user: session, space } = await getCurrentSpace()

  const emergencies = await getUnsettledEmergencies()

  return <EmergencyListClient emergencies={emergencies} />
}
