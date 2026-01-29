import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db, accounts, categories } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { AddMovementPage } from './add-client'

export default async function AddPage() {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  const userAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, session.id))
    .orderBy(accounts.bankName)

  const userCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.userId, session.id))
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
