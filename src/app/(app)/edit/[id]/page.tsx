import { getCurrentSpace } from '@/lib/spaces'
import { notFound } from 'next/navigation'
import { getMovementById } from '@/lib/actions/movements'
import { getTransferByMovementId } from '@/lib/actions/transfers'
import { getAccountsAndCategories } from '@/lib/actions/review'
import { db, accounts as accountsTable } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { EditClient } from './edit-client'
import { EditTransferClient } from './edit-transfer-client'

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { space, spaces } = await getCurrentSpace()

  const { id } = await params
  const [movement, { accounts, categories }, transferAccounts] = await Promise.all([
    getMovementById(id),
    getAccountsAndCategories(),
    db.select().from(accountsTable).where(sql`${accountsTable.spaceId} IN (${sql.join(spaces.map((s) => sql`${s.id}`), sql`, `)})`).orderBy(accountsTable.bankName),
  ])
  const transferSpaces = spaces.map((s) => ({ id: s.id, name: s.name, emoji: s.emoji, isCurrent: s.id === space.id, hasAccounts: transferAccounts.some((a) => a.spaceId === s.id) }))

  if (!movement) notFound()

  // Check if this is a transfer
  if (movement.transferId) {
    const transfer = await getTransferByMovementId(id)
    if (!transfer) notFound()
    return (
      <EditTransferClient
        transfer={transfer}
        accounts={accounts}
        transferAccounts={transferAccounts}
        transferSpaces={transferSpaces}
      />
    )
  }

  return (
    <EditClient
      movement={movement}
      accounts={accounts}
      transferAccounts={transferAccounts}
      transferSpaces={transferSpaces}
      currentSpaceId={space.id}
      categories={categories}
    />
  )
}
