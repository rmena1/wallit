import { getCurrentSpace } from '@/lib/spaces'
import { db, accounts, categories, spaceMemberships, users } from '@/lib/db'
import { eq, sql } from 'drizzle-orm'
import { getAccountBalances } from '@/lib/actions/balances'
import { SettingsPage } from './settings-client'

export default async function Settings() {
  const { space, spaces } = await getCurrentSpace()

  const accountBalances = await getAccountBalances()

  const userAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.spaceId, space.id))
    .orderBy(sql`${accounts.sortOrder} ASC, ${accounts.bankName} ASC, ${accounts.createdAt} ASC`)

  const userCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.spaceId, space.id))
    .orderBy(categories.name)

  const members = await db
    .select({ userId: spaceMemberships.userId, email: users.email, role: spaceMemberships.role })
    .from(spaceMemberships)
    .innerJoin(users, eq(spaceMemberships.userId, users.id))
    .where(eq(spaceMemberships.spaceId, space.id))

  return (
    <SettingsPage
      accounts={userAccounts}
      accountBalances={accountBalances}
      categories={userCategories}
      spaces={spaces}
      currentSpace={space}
      members={members}
    />
  )
}
