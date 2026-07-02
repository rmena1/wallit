import { getCurrentSpace } from '@/lib/spaces'
import { redirect } from 'next/navigation'
import { db, accounts, categories, spaceMemberships, spaces as spacesTable, users } from '@/lib/db'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { AddMovementPage } from './add-client'

export default async function AddPage() {
  const { user: session, space, spaces: availableSpaces } = await getCurrentSpace()

  const userAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.spaceId, space.id))
    .orderBy(accounts.bankName)

  const allCategories = await db
    .select()
    .from(categories)
    .where(sql`${categories.spaceId} IN (${sql.join(availableSpaces.map((s) => sql`${s.id}`), sql`, `)})`)
    .orderBy(categories.name)

  const userCategories = allCategories.filter((category) => category.spaceId === space.id)

  const transferAccounts = await db
    .select()
    .from(accounts)
    .where(sql`${accounts.spaceId} IN (${sql.join(availableSpaces.map((s) => sql`${s.id}`), sql`, `)})`)
    .orderBy(accounts.bankName)

  const memberPersonalDestinations = space.isPersonal
    ? []
    : await db
      .select({
        id: spacesTable.id,
        name: spacesTable.name,
        emoji: spacesTable.emoji,
        userId: users.id,
        email: users.email,
      })
      .from(spaceMemberships)
      .innerJoin(users, eq(spaceMemberships.userId, users.id))
      .innerJoin(spacesTable, and(eq(spacesTable.createdByUserId, users.id), eq(spacesTable.isPersonal, true), isNull(spacesTable.archivedAt)))
      .where(and(eq(spaceMemberships.spaceId, space.id), ne(spaceMemberships.userId, session.id)))
      .orderBy(users.email)

  // If no accounts, redirect to settings
  if (userAccounts.length === 0) {
    redirect('/settings')
  }

  return (
    <AddMovementPage
      accounts={userAccounts}
      transferAccounts={transferAccounts}
      transferSpaces={[
        ...availableSpaces.map((s) => ({
          id: s.id,
          name: s.name,
          emoji: s.emoji,
          isCurrent: s.id === space.id,
          hasAccounts: transferAccounts.some((a) => a.spaceId === s.id),
          requiresAccount: true,
        })),
        ...memberPersonalDestinations.map((destination) => ({
          id: destination.id,
          name: `${destination.email} · Personal`,
          emoji: destination.emoji,
          isCurrent: false,
          hasAccounts: true,
          requiresAccount: false,
        })),
      ]}
      currentSpaceId={space.id}
      categories={userCategories}
      transferCategories={allCategories}
    />
  )
}
