import { getCurrentSpace } from '@/lib/spaces'
import { redirect } from 'next/navigation'
import { getUnsettledLoans } from '@/lib/actions/loans'
import { LoansListClient } from './loans-list-client'

export default async function LoansPage() {
  const { user: session, space } = await getCurrentSpace()

  const loans = await getUnsettledLoans()

  return <LoansListClient loans={loans} />
}
