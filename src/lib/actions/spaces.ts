'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { db, spaces, spaceMemberships, users } from '@/lib/db'
import { generateId } from '@/lib/utils'
import {
  ACTIVE_SPACE_COOKIE,
  cleanSpaceEmoji,
  cleanSpaceName,
  copyPersonalCategoriesToSpace,
  ensureSpaceMembership,
  findUserByEmail,
  getCurrentSpace,
  getOrCreatePersonalSpace,
  normalizeSpaceName,
  requireOwner,
  spaceMembershipLockKey,
  spaceNameLockKey,
} from '@/lib/spaces'

export type SpaceActionResult = { success: boolean; error?: string; id?: string }

function ok(extra: Omit<SpaceActionResult, 'success'> = {}): SpaceActionResult {
  return { success: true, ...extra }
}

function fail(error: string): SpaceActionResult {
  return { success: false, error }
}

async function setActiveSpaceCookie(spaceId: string) {
  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_SPACE_COOKIE, spaceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })
}

export async function switchSpace(spaceId: string): Promise<SpaceActionResult> {
  const { user } = await getCurrentSpace()
  const membership = await ensureSpaceMembership(user.id, spaceId)
  if (!membership) return fail('Space no disponible')

  await setActiveSpaceCookie(spaceId)
  revalidatePath('/', 'layout')
  revalidatePath('/settings')
  return ok()
}

export async function createSpace(input: { name: string; emoji: string }): Promise<SpaceActionResult> {
  const { user } = await getCurrentSpace()
  const name = cleanSpaceName(input.name)
  const emoji = cleanSpaceEmoji(input.emoji)
  const normalizedName = normalizeSpaceName(name)
  if (!name) return fail('El Space necesita nombre')

  const now = new Date()
  const spaceId = generateId()
  const personal = await getOrCreatePersonalSpace(user.id)
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${spaceNameLockKey(user.id, normalizedName)}, 0))`)
    const duplicate = await tx
      .select({ id: spaces.id })
      .from(spaceMemberships)
      .innerJoin(spaces, eq(spaceMemberships.spaceId, spaces.id))
      .where(and(
        eq(spaceMemberships.userId, user.id),
        eq(spaces.normalizedName, normalizedName),
        isNull(spaces.archivedAt),
      ))
      .limit(1)
    if (duplicate.length > 0) return false

    await tx.insert(spaces).values({
      id: spaceId,
      name,
      normalizedName,
      emoji,
      isPersonal: false,
      createdByUserId: user.id,
      createdAt: now,
      updatedAt: now,
    })
    await tx.insert(spaceMemberships).values({
      id: generateId(),
      spaceId,
      userId: user.id,
      role: 'owner',
      createdAt: now,
    })
    await copyPersonalCategoriesToSpace(user.id, spaceId, tx, personal.id)
    return true
  })
  if (!created) return fail('Ya tienes un Space activo con ese nombre')

  await setActiveSpaceCookie(spaceId)
  revalidatePath('/', 'layout')
  revalidatePath('/settings')
  return ok({ id: spaceId })
}

export async function updateSpace(input: { spaceId: string; name: string; emoji: string }): Promise<SpaceActionResult> {
  const { user } = await getCurrentSpace()
  try {
    await requireOwner(user.id, input.spaceId)
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Solo el Owner puede administrar este Space')
  }

  const membership = await ensureSpaceMembership(user.id, input.spaceId)
  if (!membership) return fail('Space no disponible')
  if (membership.isPersonal) return fail('El Space Personal no se puede renombrar')

  const name = cleanSpaceName(input.name)
  const emoji = cleanSpaceEmoji(input.emoji)
  const normalizedName = normalizeSpaceName(name)
  if (!name) return fail('El Space necesita nombre')

  const renamed = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${spaceMembershipLockKey(input.spaceId)}, 0))`)
    const members = await tx
      .select({ userId: spaceMemberships.userId })
      .from(spaceMemberships)
      .where(eq(spaceMemberships.spaceId, input.spaceId))

    for (const member of members) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${spaceNameLockKey(member.userId, normalizedName)}, 0))`)
      const duplicate = await tx
        .select({ id: spaces.id })
        .from(spaceMemberships)
        .innerJoin(spaces, eq(spaceMemberships.spaceId, spaces.id))
        .where(and(
          eq(spaceMemberships.userId, member.userId),
          eq(spaces.normalizedName, normalizedName),
          isNull(spaces.archivedAt),
          ne(spaces.id, input.spaceId),
        ))
        .limit(1)
      if (duplicate.length > 0) return false
    }

    const [updatedSpace] = await tx.update(spaces)
      .set({ name, emoji, normalizedName, updatedAt: new Date() })
      .where(eq(spaces.id, input.spaceId))
      .returning({ id: spaces.id })
    return updatedSpace ? 'renamed' : 'not-found'
  })
  if (renamed === false) return fail('Un miembro ya tiene un Space activo con ese nombre')
  if (renamed === 'not-found') return fail('Space no disponible')

  revalidatePath('/', 'layout')
  return ok()
}

export async function addSpaceMember(input: { spaceId: string; email: string }): Promise<SpaceActionResult> {
  const { user } = await getCurrentSpace()
  try {
    await requireOwner(user.id, input.spaceId)
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Solo el Owner puede administrar este Space')
  }
  const space = await ensureSpaceMembership(user.id, input.spaceId)
  if (!space) return fail('Space no disponible')
  if (space.isPersonal) return fail('El Space Personal no se puede compartir')

  const target = await findUserByEmail(input.email)
  if (!target) return fail('No existe un usuario con ese email')
  if (target.id === user.id) return fail('Ya eres Owner de este Space')

  const addResult = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${spaceMembershipLockKey(input.spaceId)}, 0))`)
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${spaceNameLockKey(target.id, space.normalizedName)}, 0))`)

    const existing = await tx
      .select({ id: spaceMemberships.id })
      .from(spaceMemberships)
      .where(and(eq(spaceMemberships.userId, target.id), eq(spaceMemberships.spaceId, input.spaceId)))
      .limit(1)
    if (existing.length > 0) return 'already-member'

    const duplicate = await tx
      .select({ id: spaces.id })
      .from(spaceMemberships)
      .innerJoin(spaces, eq(spaceMemberships.spaceId, spaces.id))
      .where(and(
        eq(spaceMemberships.userId, target.id),
        eq(spaces.normalizedName, space.normalizedName),
        isNull(spaces.archivedAt),
      ))
      .limit(1)
    if (duplicate.length > 0) return 'name-collision'

    await tx.insert(spaceMemberships).values({
      id: generateId(),
      spaceId: input.spaceId,
      userId: target.id,
      role: 'member',
      createdAt: new Date(),
    })
    return 'added'
  })
  if (addResult === 'already-member') return fail('Ese usuario ya pertenece al Space')
  if (addResult === 'name-collision') {
    return fail('Ese usuario ya tiene un Space activo con el mismo nombre. Renombra este Space antes de compartirlo.')
  }

  revalidatePath('/settings')
  return ok()
}

export async function removeSpaceMember(input: { spaceId: string; userId: string }): Promise<SpaceActionResult> {
  const { user } = await getCurrentSpace()
  try {
    await requireOwner(user.id, input.spaceId)
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Solo el Owner puede administrar este Space')
  }
  if (input.userId === user.id) return fail('El Owner no puede removerse a sí mismo')

  const [removedMember] = await db.delete(spaceMemberships).where(and(
    eq(spaceMemberships.spaceId, input.spaceId),
    eq(spaceMemberships.userId, input.userId),
    eq(spaceMemberships.role, 'member')
  )).returning({ id: spaceMemberships.id })
  if (!removedMember) return fail('Miembro no encontrado')
  revalidatePath('/settings')
  return ok()
}

export async function leaveSpace(spaceId: string): Promise<SpaceActionResult> {
  const { user, space } = await getCurrentSpace()
  const membership = await ensureSpaceMembership(user.id, spaceId)
  if (!membership) return fail('Space no disponible')
  if (membership.isPersonal) return fail('No puedes salir del Space Personal')
  if (membership.role === 'owner') return fail('El Owner no puede salir del Space')

  const [removedMembership] = await db.delete(spaceMemberships)
    .where(and(eq(spaceMemberships.spaceId, spaceId), eq(spaceMemberships.userId, user.id)))
    .returning({ id: spaceMemberships.id })
  if (!removedMembership) return fail('Space no disponible')
  if (space.id === spaceId) {
    const cookieStore = await cookies()
    cookieStore.delete(ACTIVE_SPACE_COOKIE)
  }
  revalidatePath('/', 'layout')
  return ok()
}

export async function archiveSpace(spaceId: string): Promise<SpaceActionResult> {
  const { user, space } = await getCurrentSpace()
  try {
    await requireOwner(user.id, spaceId)
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Solo el Owner puede administrar este Space')
  }
  const membership = await ensureSpaceMembership(user.id, spaceId)
  if (!membership) return fail('Space no disponible')
  if (membership.isPersonal) return fail('El Space Personal no se puede archivar')

  const [archivedSpace] = await db.update(spaces)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(spaces.id, spaceId))
    .returning({ id: spaces.id })
  if (!archivedSpace) return fail('Space no disponible')
  if (space.id === spaceId) {
    const cookieStore = await cookies()
    cookieStore.delete(ACTIVE_SPACE_COOKIE)
  }
  revalidatePath('/', 'layout')
  return ok()
}

export async function getSpaceMembers(spaceId: string) {
  const { user } = await getCurrentSpace()
  const membership = await ensureSpaceMembership(user.id, spaceId)
  if (!membership) throw new Error('Space no disponible')

  return db
    .select({ userId: spaceMemberships.userId, email: users.email, role: spaceMemberships.role, createdAt: spaceMemberships.createdAt })
    .from(spaceMemberships)
    .innerJoin(users, eq(spaceMemberships.userId, users.id))
    .where(eq(spaceMemberships.spaceId, spaceId))
}
