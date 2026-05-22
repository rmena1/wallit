import { getCurrentSpace } from '@/lib/spaces'
import { redirect } from 'next/navigation'
import { getPendingReviewMovements, getAccountsAndCategories } from '@/lib/actions/review'
import { ReviewClient } from './review-client'

export default async function ReviewPage() {
  const { user: session, space } = await getCurrentSpace()

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
