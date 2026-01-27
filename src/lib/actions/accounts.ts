'use server'

import { revalidatePath } from 'next/cache'
import { db, accounts } from '@/lib/db'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export type AccountActionResult = {
  success: boolean
  error?: string
}

/**
 * Create a new account
 */
export async function createAccount(formData: FormData): Promise<AccountActionResult> {
  const session = await requireAuth()

  const bankName = (formData.get('bankName') as string)?.trim()
  const accountType = (formData.get('accountType') as string)?.trim()
  const lastFourDigits = (formData.get('lastFourDigits') as string)?.trim()

  if (!bankName) {
    return { success: false, error: 'Bank is required' }
  }

  if (!accountType) {
    return { success: false, error: 'Account type is required' }
  }

  if (!lastFourDigits || !/^\d{4}$/.test(lastFourDigits)) {
    return { success: false, error: 'Last 4 digits must be exactly 4 numbers' }
  }

  await db.insert(accounts).values({
    id: generateId(),
    userId: session.id,
    bankName,
    accountType,
    lastFourDigits,
  })

  revalidatePath('/')
  return { success: true }
}

/**
 * Delete an account
 */
export async function deleteAccount(id: string): Promise<AccountActionResult> {
  const session = await requireAuth()

  await db.delete(accounts).where(
    and(
      eq(accounts.id, id),
      eq(accounts.userId, session.id)
    )
  )

  revalidatePath('/')
  return { success: true }
}

/**
 * Get all accounts for the current user
 */
export async function getAccounts() {
  const session = await requireAuth()

  return db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, session.id))
    .orderBy(accounts.bankName)
}
