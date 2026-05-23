import { getCurrentSpace } from '@/lib/spaces'
import { getPendingReviewMovements, getAccountsAndCategories } from '@/lib/actions/review'
import { db, accounts as accountsTable } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { ReviewClient } from './review-client'

export default async function ReviewPage() {
  const { space, spaces } = await getCurrentSpace()

  const [pendingMovements, { accounts, categories }, transferAccounts] = await Promise.all([
    getPendingReviewMovements(),
    getAccountsAndCategories(),
    db.select().from(accountsTable).where(sql`${accountsTable.spaceId} IN (${sql.join(spaces.map((s) => sql`${s.id}`), sql`, `)})`).orderBy(accountsTable.bankName),
  ])

  return (
    <ReviewClient
      movements={pendingMovements}
      accounts={accounts}
      transferAccounts={transferAccounts}
      transferSpaces={spaces.map((s) => ({ id: s.id, name: s.name, emoji: s.emoji, isCurrent: s.id === space.id, hasAccounts: transferAccounts.some((a) => a.spaceId === s.id) }))}
      currentSpaceId={space.id}
      categories={categories}
    />
  )
}
