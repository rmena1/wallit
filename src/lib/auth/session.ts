import { cache } from 'react'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import { db, sessions, users } from '@/lib/db'
import { eq, and, gt, lt } from 'drizzle-orm'

const SESSION_COOKIE_NAME = 'wallit_session'
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const MAX_SESSIONS_PER_USER = 5

export interface SessionUser {
  id: string
  email: string
}

/**
 * Purge expired sessions and enforce max sessions per user.
 * Called on every new session creation to keep the DB clean.
 */
async function pruneSessionsForUser(userId: string): Promise<void> {
  // Delete all expired sessions for this user
  await db.delete(sessions).where(
    and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date()))
  )

  // Enforce max active sessions — keep only the N most recent
  const activeSessions = await db
    .select({ id: sessions.id, createdAt: sessions.createdAt })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(sessions.createdAt)

  if (activeSessions.length >= MAX_SESSIONS_PER_USER) {
    const toDelete = activeSessions.slice(0, activeSessions.length - MAX_SESSIONS_PER_USER + 1)
    for (const s of toDelete) {
      await db.delete(sessions).where(eq(sessions.id, s.id))
    }
  }
}

/**
 * Create a new session for a user.
 * Prunes expired/excess sessions first.
 */
export async function createSession(userId: string): Promise<string> {
  // Clean up old sessions before creating a new one
  await pruneSessionsForUser(userId)

  const sessionId = randomBytes(32).toString('hex') // 256-bit cryptographic session token
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)
  
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
  })
  
  // Set cookie
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  })
  
  return sessionId
}

/**
 * Get the current session user (if authenticated).
 * Wrapped with React.cache() to deduplicate DB lookups within a single request.
 */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value
  
  if (!sessionId) {
    return null
  }
  
  const result = await db
    .select({
      userId: sessions.userId,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.id, sessionId),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1)
  
  if (result.length === 0) {
    return null
  }
  
  return {
    id: result[0].userId,
    email: result[0].email,
  }
})

/**
 * Require authentication
 */
export async function requireAuth(): Promise<SessionUser> {
  const session = await getSession()
  
  if (!session) {
    throw new Error('Unauthorized')
  }
  
  return session
}

/**
 * Destroy the current session
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value
  
  if (sessionId) {
    await db.delete(sessions).where(eq(sessions.id, sessionId))
  }
  
  cookieStore.delete(SESSION_COOKIE_NAME)
}

/**
 * Destroy ALL sessions for a user (useful for password change, security reset).
 */
export async function destroyAllUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}
