import { getCurrentSpace } from '@/lib/spaces'
import { redirect } from 'next/navigation'
import { db, accounts, categories } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { AddMovementPage } from './add-client'

export default async function AddPage() {
  const { user: session, space } = await getCurrentSpace()

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

  // If no accounts, redirect to settings
  if (userAccounts.length === 0) {
    redirect('/settings')
  }

  return (
    <AddMovementPage
      accounts={userAccounts}
      categories={userCategories}
    />
  )
}
