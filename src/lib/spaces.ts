import 'server-only'

import { cache } from 'react'
import { cookies } from 'next/headers'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { db, spaces, spaceMemberships, users, categories, type Space } from '@/lib/db'
import { requireAuth, type SessionUser } from '@/lib/auth/session'
import { generateId } from '@/lib/utils'

export const ACTIVE_SPACE_COOKIE = 'wallit_active_space'

export type SpaceRole = 'owner' | 'member'
export type AvailableSpace = Pick<Space, 'id' | 'name' | 'normalizedName' | 'emoji' | 'isPersonal' | 'archivedAt'> & {
  role: SpaceRole
}
export type CurrentSpaceContext = {
  user: SessionUser
  space: AvailableSpace
  spaces: AvailableSpace[]
}

export function normalizeSpaceName(name: string): string {
  return name.trim().toLowerCase()
}

export function cleanSpaceName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

export function cleanSpaceEmoji(emoji: string): string {
  return emoji.trim() || '💰'
}

export function spaceNameLockKey(userId: string, normalizedName: string): string {
  return `wallit:space-name:${userId}:${normalizedName}`
}

export function spaceMembershipLockKey(spaceId: string): string {
  return `wallit:space-membership:${spaceId}`
}

async function findPersonalSpace(userId: string): Promise<AvailableSpace | null> {
  const rows = await db
    .select({
      id: spaces.id,
      name: spaces.name,
      normalizedName: spaces.normalizedName,
      emoji: spaces.emoji,
      isPersonal: spaces.isPersonal,
      archivedAt: spaces.archivedAt,
      role: spaceMemberships.role,
    })
    .from(spaceMemberships)
    .innerJoin(spaces, eq(spaceMemberships.spaceId, spaces.id))
    .where(and(eq(spaceMemberships.userId, userId), eq(spaces.isPersonal, true), isNull(spaces.archivedAt)))
    .limit(1)

  return rows[0] ?? null
}

export async function getOrCreatePersonalSpace(userId: string): Promise<AvailableSpace> {
  const existing = await findPersonalSpace(userId)
  if (existing) return existing

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${spaceNameLockKey(userId, 'personal')}, 0))`)

    const rows = await tx
      .select({
        id: spaces.id,
        name: spaces.name,
        normalizedName: spaces.normalizedName,
        emoji: spaces.emoji,
        isPersonal: spaces.isPersonal,
        archivedAt: spaces.archivedAt,
        role: spaceMemberships.role,
      })
      .from(spaceMemberships)
      .innerJoin(spaces, eq(spaceMemberships.spaceId, spaces.id))
      .where(and(eq(spaceMemberships.userId, userId), eq(spaces.isPersonal, true), isNull(spaces.archivedAt)))
      .limit(1)

    if (rows[0]) return rows[0]

    const ownedPersonal = await tx
      .select({
        id: spaces.id,
        name: spaces.name,
        normalizedName: spaces.normalizedName,
        emoji: spaces.emoji,
        isPersonal: spaces.isPersonal,
        archivedAt: spaces.archivedAt,
      })
      .from(spaces)
      .where(and(eq(spaces.createdByUserId, userId), eq(spaces.isPersonal, true), isNull(spaces.archivedAt)))
      .limit(1)

    if (ownedPersonal[0]) {
      await tx.insert(spaceMemberships).values({
        id: generateId(),
        spaceId: ownedPersonal[0].id,
        userId,
        role: 'owner',
        createdAt: new Date(),
      })
      return { ...ownedPersonal[0], role: 'owner' }
    }

    const now = new Date()
    const spaceId = generateId()
    await tx.insert(spaces).values({
      id: spaceId,
      name: 'Personal',
      normalizedName: 'personal',
      emoji: '👤',
      isPersonal: true,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    })
    await tx.insert(spaceMemberships).values({
      id: generateId(),
      spaceId,
      userId,
      role: 'owner',
      createdAt: now,
    })

    return {
      id: spaceId,
      name: 'Personal',
      normalizedName: 'personal',
      emoji: '👤',
      isPersonal: true,
      archivedAt: null,
      role: 'owner',
    }
  })
}

export async function getAvailableSpaces(userId: string): Promise<AvailableSpace[]> {
  await getOrCreatePersonalSpace(userId)

  return db
    .select({
      id: spaces.id,
      name: spaces.name,
      normalizedName: spaces.normalizedName,
      emoji: spaces.emoji,
      isPersonal: spaces.isPersonal,
      archivedAt: spaces.archivedAt,
      role: spaceMemberships.role,
    })
    .from(spaceMemberships)
    .innerJoin(spaces, eq(spaceMemberships.spaceId, spaces.id))
    .where(and(eq(spaceMemberships.userId, userId), isNull(spaces.archivedAt)))
    .orderBy(sql`${spaces.isPersonal} DESC`, spaces.createdAt)
}

export async function userHasActiveSpaceNamed(userId: string, normalizedName: string, excludeSpaceId?: string): Promise<boolean> {
  const conditions = [
    eq(spaceMemberships.userId, userId),
    eq(spaces.normalizedName, normalizedName),
    isNull(spaces.archivedAt),
  ]
  if (excludeSpaceId) conditions.push(ne(spaces.id, excludeSpaceId))

  const rows = await db
    .select({ id: spaces.id })
    .from(spaceMemberships)
    .innerJoin(spaces, eq(spaceMemberships.spaceId, spaces.id))
    .where(and(...conditions))
    .limit(1)
  return rows.length > 0
}

export async function getCurrentSpaceForUser(userId: string): Promise<{ space: AvailableSpace; spaces: AvailableSpace[] }> {
  const available = await getAvailableSpaces(userId)
  const personal = available.find((space) => space.isPersonal) ?? await getOrCreatePersonalSpace(userId)
  const cookieStore = await cookies()
  const cookieSpaceId = cookieStore.get(ACTIVE_SPACE_COOKIE)?.value
  const active = cookieSpaceId ? available.find((space) => space.id === cookieSpaceId) : null
  const space = active ?? personal

  return { space, spaces: available }
}

export const getCurrentSpace = cache(async (): Promise<CurrentSpaceContext> => {
  const user = await requireAuth()
  const { space, spaces } = await getCurrentSpaceForUser(user.id)
  return { user, space, spaces }
})

export async function requireOwner(userId: string, spaceId: string): Promise<void> {
  const rows = await db
    .select({ role: spaceMemberships.role })
    .from(spaceMemberships)
    .innerJoin(spaces, eq(spaceMemberships.spaceId, spaces.id))
    .where(and(eq(spaceMemberships.userId, userId), eq(spaceMemberships.spaceId, spaceId), isNull(spaces.archivedAt)))
    .limit(1)

  if (rows[0]?.role !== 'owner') {
    throw new Error('Solo el Owner puede administrar este Space')
  }
}

export async function ensureSpaceMembership(userId: string, spaceId: string): Promise<AvailableSpace | null> {
  const rows = await db
    .select({
      id: spaces.id,
      name: spaces.name,
      normalizedName: spaces.normalizedName,
      emoji: spaces.emoji,
      isPersonal: spaces.isPersonal,
      archivedAt: spaces.archivedAt,
      role: spaceMemberships.role,
    })
    .from(spaceMemberships)
    .innerJoin(spaces, eq(spaceMemberships.spaceId, spaces.id))
    .where(and(eq(spaceMemberships.userId, userId), eq(spaceMemberships.spaceId, spaceId), isNull(spaces.archivedAt)))
    .limit(1)

  return rows[0] ?? null
}

type CategoryCopyClient = Pick<typeof db, 'select' | 'insert'>

export async function copyPersonalCategoriesToSpace(
  userId: string,
  targetSpaceId: string,
  client: CategoryCopyClient = db,
  sourcePersonalSpaceId?: string,
): Promise<void> {
  const personalSpaceId = sourcePersonalSpaceId ?? (await getOrCreatePersonalSpace(userId)).id
  const sourceCategories = await client.select().from(categories).where(eq(categories.spaceId, personalSpaceId))
  const now = new Date()
  if (sourceCategories.length === 0) return

  await client.insert(categories).values(sourceCategories.map((category) => ({
    id: generateId(),
    spaceId: targetSpaceId,
    createdByUserId: userId,
    name: category.name,
    emoji: category.emoji,
    createdAt: now,
    updatedAt: now,
  })))
}

export async function findUserByEmail(email: string) {
  const rows = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1)
  return rows[0] ?? null
}
