import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db, accounts, categories } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { getAccountBalances } from '@/lib/actions/balances'
import { SettingsPage } from './settings-client'

export default async function Settings() {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  const accountBalances = await getAccountBalances()

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

  return (
    <SettingsPage
      accounts={userAccounts}
      accountBalances={accountBalances}
      categories={userCategories}
    />
  )
}
