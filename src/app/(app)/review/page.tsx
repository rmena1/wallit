import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getPendingReviewMovements, getAccountsAndCategories } from '@/lib/actions/review'
import { ReviewClient } from './review-client'

export default async function ReviewPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [pendingMovements, { accounts, categories }] = await Promise.all([
    getPendingReviewMovements(),
    getAccountsAndCategories(),
  ])

  return (
    <ReviewClient
      movements={pendingMovements}
      accounts={accounts}
      categories={categories}
    />
  )
}
