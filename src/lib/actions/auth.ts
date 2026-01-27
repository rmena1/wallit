'use server'

import { redirect } from 'next/navigation'
import { db, users, categories } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { hashPassword, verifyPassword, createSession, destroySession } from '@/lib/auth'
import { registerSchema, loginSchema } from '@/lib/validations'
import { generateId } from '@/lib/utils'

export type AuthActionResult = {
  success: boolean
  error?: string
}

/**
 * Register a new user
 */
export async function register(formData: FormData): Promise<AuthActionResult> {
  const rawData = {
    email: formData.get('email'),
    password: formData.get('password'),
  }
  
  // Validate input
  const parsed = registerSchema.safeParse(rawData)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return {
      success: false,
      error: firstError?.message || 'Invalid input',
    }
  }
  
  const { email, password } = parsed.data
  
  // Check if user already exists
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1)
  
  if (existingUser.length > 0) {
    return {
      success: false,
      error: 'An account with this email already exists',
    }
  }
  
  // Create user
  const userId = generateId()
  const passwordHash = await hashPassword(password)
  
  await db.insert(users).values({
    id: userId,
    email: email.toLowerCase(),
    passwordHash,
  })
  
  // Create default categories for new user
  const defaultCategories = [
    { emoji: '🍔', name: 'Food' },
    { emoji: '🚗', name: 'Transport' },
    { emoji: '🏠', name: 'Home' },
    { emoji: '🛒', name: 'Shopping' },
    { emoji: '💊', name: 'Health' },
    { emoji: '🎬', name: 'Entertainment' },
    { emoji: '💼', name: 'Work' },
    { emoji: '📚', name: 'Education' },
    { emoji: '💰', name: 'Salary' },
    { emoji: '🎁', name: 'Gifts' },
  ]
  
  for (const cat of defaultCategories) {
    await db.insert(categories).values({
      id: generateId(),
      userId,
      name: cat.name,
      emoji: cat.emoji,
    })
  }
  
  // Create session and redirect
  await createSession(userId)
  redirect('/')
}

/**
 * Log in an existing user
 */
export async function login(formData: FormData): Promise<AuthActionResult> {
  const rawData = {
    email: formData.get('email'),
    password: formData.get('password'),
  }
  
  // Validate input
  const parsed = loginSchema.safeParse(rawData)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return {
      success: false,
      error: firstError?.message || 'Invalid input',
    }
  }
  
  const { email, password } = parsed.data
  
  // Find user
  const user = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1)
  
  if (user.length === 0) {
    return {
      success: false,
      error: 'Invalid email or password',
    }
  }
  
  // Verify password
  const isValid = await verifyPassword(password, user[0].passwordHash)
  if (!isValid) {
    return {
      success: false,
      error: 'Invalid email or password',
    }
  }
  
  // Create session and redirect
  await createSession(user[0].id)
  redirect('/')
}

/**
 * Log out the current user
 */
export async function logout(): Promise<void> {
  await destroySession()
  redirect('/login')
}
