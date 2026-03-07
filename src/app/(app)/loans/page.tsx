import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getUnsettledLoans } from '@/lib/actions/loans'
import { LoansListClient } from './loans-list-client'

export default async function LoansPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const loans = await getUnsettledLoans()

  return <LoansListClient loans={loans} />
}
