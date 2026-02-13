'use server'

import { revalidatePath } from 'next/cache'
import { db, accounts, movements, categories } from '@/lib/db'
import { eq, and, desc, isNotNull } from 'drizzle-orm'
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
  const isInvestment = formData.get('isInvestment') === 'on' || formData.get('isInvestment') === 'true'
  const initialBalanceStr = (formData.get('initialBalance') as string)?.trim()
  const currency = (formData.get('currency') as string)?.trim() || 'CLP'
  const color = (formData.get('color') as string)?.trim() || null
  const emoji = (formData.get('emoji') as string)?.trim() || null

  if (!bankName) {
    return { success: false, error: 'Bank is required' }
  }

  if (!accountType) {
    return { success: false, error: 'Account type is required' }
  }

  let normalizedLastFourDigits = lastFourDigits || ''
  if (isInvestment) {
    if (!normalizedLastFourDigits) {
      normalizedLastFourDigits = '0000'
    } else if (!/^\d{4}$/.test(normalizedLastFourDigits)) {
      return { success: false, error: 'Last 4 digits must be exactly 4 numbers' }
    }
  } else if (!normalizedLastFourDigits || !/^\d{4}$/.test(normalizedLastFourDigits)) {
    return { success: false, error: 'Last 4 digits must be exactly 4 numbers' }
  }

  // Parse initialBalance: convert from dollars to cents
  let initialBalance = 0
  if (initialBalanceStr) {
    const parsed = parseFloat(initialBalanceStr.replace(/[$,]/g, ''))
    if (!isNaN(parsed)) {
      initialBalance = Math.round(parsed * 100)
    }
  }

  const now = new Date()

  await db.insert(accounts).values({
    id: generateId(),
    userId: session.id,
    bankName,
    accountType,
    lastFourDigits: normalizedLastFourDigits,
    initialBalance,
    isInvestment,
    currentValue: isInvestment ? initialBalance : null,
    currentValueUpdatedAt: isInvestment ? now : null,
    currency: currency as 'CLP' | 'USD',
    color,
    emoji,
  })

  revalidatePath('/')
  revalidatePath('/settings')
  return { success: true }
}

/**
 * Update an existing account
 */
export async function updateAccount(formData: FormData): Promise<AccountActionResult> {
  const session = await requireAuth()

  const id = (formData.get('id') as string)?.trim()
  const bankName = (formData.get('bankName') as string)?.trim()
  const accountType = (formData.get('accountType') as string)?.trim()
  const lastFourDigits = (formData.get('lastFourDigits') as string)?.trim()
  const isInvestment = formData.get('isInvestment') === 'on' || formData.get('isInvestment') === 'true'
  const initialBalanceStr = (formData.get('initialBalance') as string)?.trim()
  const currency = (formData.get('currency') as string)?.trim() || 'CLP'
  const color = (formData.get('color') as string)?.trim() || null
  const emoji = (formData.get('emoji') as string)?.trim() || null

  if (!id) {
    return { success: false, error: 'Account ID is required' }
  }

  if (!bankName) {
    return { success: false, error: 'Bank is required' }
  }

  if (!accountType) {
    return { success: false, error: 'Account type is required' }
  }

  let normalizedLastFourDigits = lastFourDigits || ''
  if (isInvestment) {
    if (!normalizedLastFourDigits) {
      normalizedLastFourDigits = '0000'
    } else if (!/^\d{4}$/.test(normalizedLastFourDigits)) {
      return { success: false, error: 'Last 4 digits must be exactly 4 numbers' }
    }
  } else if (!normalizedLastFourDigits || !/^\d{4}$/.test(normalizedLastFourDigits)) {
    return { success: false, error: 'Last 4 digits must be exactly 4 numbers' }
  }

  const [existingAccount] = await db
    .select({
      id: accounts.id,
      currentValue: accounts.currentValue,
      currentValueUpdatedAt: accounts.currentValueUpdatedAt,
    })
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, session.id)))
    .limit(1)

  if (!existingAccount) {
    return { success: false, error: 'Account not found' }
  }

  let initialBalance = 0
  if (initialBalanceStr) {
    const parsed = parseFloat(initialBalanceStr.replace(/[$,]/g, ''))
    if (!isNaN(parsed)) {
      initialBalance = Math.round(parsed * 100)
    }
  }

  const now = new Date()
  let currentValue = existingAccount.currentValue
  let currentValueUpdatedAt = existingAccount.currentValueUpdatedAt

  if (isInvestment && currentValue === null) {
    currentValue = initialBalance
    currentValueUpdatedAt = now
  }

  await db.update(accounts)
    .set({
      bankName,
      accountType,
      lastFourDigits: normalizedLastFourDigits,
      initialBalance,
      isInvestment,
      currentValue,
      currentValueUpdatedAt,
      currency: currency as 'CLP' | 'USD',
      color,
      emoji,
      updatedAt: now,
    })
    .where(
      and(
        eq(accounts.id, id),
        eq(accounts.userId, session.id)
      )
    )

  revalidatePath('/')
  revalidatePath('/settings')
  revalidatePath(`/account/${id}`)
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
  revalidatePath('/settings')
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

/**
 * Get paginated movements for an account (used by "load more" on account detail)
 */
export async function getAccountMovements(accountId: string, offset: number, limit: number = 50, transfersOnly: boolean = false) {
  const session = await requireAuth()
  const whereCondition = transfersOnly
    ? and(eq(movements.accountId, accountId), eq(movements.userId, session.id), isNotNull(movements.transferId))
    : and(eq(movements.accountId, accountId), eq(movements.userId, session.id))

  return db
    .select({
      id: movements.id,
      name: movements.name,
      date: movements.date,
      amount: movements.amount,
      type: movements.type,
      currency: movements.currency,
      amountUsd: movements.amountUsd,
      time: movements.time,
      originalName: movements.originalName,
      receivable: movements.receivable,
      received: movements.received,
      transferId: movements.transferId,
      transferPairId: movements.transferPairId,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
    })
    .from(movements)
    .leftJoin(categories, eq(movements.categoryId, categories.id))
    .where(whereCondition)
    .orderBy(desc(movements.date), desc(movements.createdAt))
    .limit(limit)
    .offset(offset)
}
