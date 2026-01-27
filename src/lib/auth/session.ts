import { cookies } from 'next/headers'
import { db, sessions, users } from '@/lib/db'
import { eq, and, gt } from 'drizzle-orm'
import { generateId } from '@/lib/utils'

const SESSION_COOKIE_NAME = 'wallit_session'
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface SessionUser {
  id: string
  email: string
}

/**
 * Create a new session for a user
 */
export async function createSession(userId: string): Promise<string> {
  const sessionId = generateId()
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
 * Get the current session user (if authenticated)
 */
export async function getSession(): Promise<SessionUser | null> {
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
}

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
