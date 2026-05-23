import { getCurrentSpace } from '@/lib/spaces'
import { redirect } from 'next/navigation'
import { db, accounts, categories } from '@/lib/db'
import { eq, sql } from 'drizzle-orm'
import { AddMovementPage } from './add-client'

export default async function AddPage() {
  const { user: session, space, spaces: availableSpaces } = await getCurrentSpace()

  const userAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.spaceId, space.id))
    .orderBy(accounts.bankName)

  const userCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.spaceId, space.id))
    .orderBy(categories.name)

  const transferAccounts = await db
    .select()
    .from(accounts)
    .where(sql`${accounts.spaceId} IN (${sql.join(availableSpaces.map((s) => sql`${s.id}`), sql`, `)})`)
    .orderBy(accounts.bankName)

  // If no accounts, redirect to settings
  if (userAccounts.length === 0) {
    redirect('/settings')
  }

  return (
    <AddMovementPage
      accounts={userAccounts}
      transferAccounts={transferAccounts}
      transferSpaces={availableSpaces.map((s) => ({ id: s.id, name: s.name, emoji: s.emoji, isCurrent: s.id === space.id, hasAccounts: transferAccounts.some((a) => a.spaceId === s.id) }))}
      currentSpaceId={space.id}
      categories={userCategories}
    />
  )
}
