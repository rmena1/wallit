'use server'

import { revalidatePath } from 'next/cache'
import { db, accounts, movements, categories, investmentSnapshots, type Account } from '@/lib/db'
import { eq, and, desc, isNotNull, sql } from 'drizzle-orm'
import { getCurrentSpace } from '@/lib/spaces'
import { generateId } from '@/lib/utils'

export type AccountActionResult = {
  success: boolean
  error?: string
  account?: Account
}

/**
 * Create a new account
 */
export async function createAccount(formData: FormData): Promise<AccountActionResult> {
  const { user: session, space } = await getCurrentSpace()

  const bankName = (formData.get('bankName') as string)?.trim()
  const accountType = (formData.get('accountType') as string)?.trim()
  const lastFourDigits = (formData.get('lastFourDigits') as string)?.trim()
  const isInvestment = formData.get('isInvestment') === 'on' || formData.get('isInvestment') === 'true'
  const initialBalanceStr = (formData.get('initialBalance') as string)?.trim()
  const creditLimitStr = (formData.get('creditLimit') as string)?.trim()
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

  let creditLimit: number | null = null
  if (creditLimitStr) {
    const parsed = parseFloat(creditLimitStr.replace(/[$,]/g, ''))
    if (!isNaN(parsed)) {
      creditLimit = Math.round(parsed * 100)
    }
  }

  if ((accountType === 'Crédito' || accountType === 'credit') && creditLimit && creditLimit > 0 && initialBalance === 0) {
    initialBalance = creditLimit
  }

  const now = new Date()
  const accountId = generateId()

  const [maxOrder] = await db
    .select({ value: sql<number>`COALESCE(MAX(${accounts.sortOrder}), -1)` })
    .from(accounts)
    .where(eq(accounts.spaceId, space.id))

  const sortOrder = Number(maxOrder?.value ?? -1) + 1

  const newAccount = {
      id: accountId,
      spaceId: space.id,
      createdByUserId: session.id,
      bankName,
      accountType,
      lastFourDigits: normalizedLastFourDigits,
      initialBalance,
      isInvestment,
      currentValue: isInvestment ? initialBalance : null,
      currentValueUpdatedAt: isInvestment ? now : null,
      creditLimit,
      currency: currency as 'CLP' | 'USD',
      color,
      emoji,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    }

  await db.transaction(async (tx) => {
    await tx.insert(accounts).values(newAccount)

    if (isInvestment) {
      await tx.insert(investmentSnapshots).values({
        id: generateId(),
        accountId,
        spaceId: space.id,
      createdByUserId: session.id,
        value: initialBalance,
        date: now.toISOString().slice(0, 10),
        createdAt: now,
      })
    }
  })

  revalidatePath('/')
  revalidatePath('/settings')
  return { success: true, account: newAccount }
}

/**
 * Update an existing account
 */
export async function updateAccount(formData: FormData): Promise<AccountActionResult> {
  const { user: session, space } = await getCurrentSpace()

  const id = (formData.get('id') as string)?.trim()
  const bankName = (formData.get('bankName') as string)?.trim()
  const accountType = (formData.get('accountType') as string)?.trim()
  const lastFourDigits = (formData.get('lastFourDigits') as string)?.trim()
  const isInvestment = formData.get('isInvestment') === 'on' || formData.get('isInvestment') === 'true'
  const initialBalanceStr = (formData.get('initialBalance') as string)?.trim()
  const creditLimitStr = (formData.get('creditLimit') as string)?.trim()
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
      createdAt: accounts.createdAt,
      isInvestment: accounts.isInvestment,
    })
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.spaceId, space.id)))
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

  let creditLimit: number | null = null
  if (creditLimitStr) {
    const parsed = parseFloat(creditLimitStr.replace(/[$,]/g, ''))
    if (!isNaN(parsed)) {
      creditLimit = Math.round(parsed * 100)
    }
  }

  if ((accountType === 'Crédito' || accountType === 'credit') && creditLimit && creditLimit > 0 && initialBalance === 0) {
    initialBalance = creditLimit
  }

  const now = new Date()
  let currentValue = existingAccount.currentValue
  let currentValueUpdatedAt = existingAccount.currentValueUpdatedAt

  if (isInvestment && currentValue === null) {
    currentValue = initialBalance
    currentValueUpdatedAt = now
  }

  await db.transaction(async (tx) => {
    await tx.update(accounts)
      .set({
        bankName,
        accountType,
        lastFourDigits: normalizedLastFourDigits,
        initialBalance,
        isInvestment,
        currentValue,
        currentValueUpdatedAt,
        creditLimit,
        currency: currency as 'CLP' | 'USD',
        color,
        emoji,
        updatedAt: now,
      })
      .where(
        and(
          eq(accounts.id, id),
          eq(accounts.spaceId, space.id)
        )
      )

    const isConvertingToInvestment = isInvestment && !existingAccount.isInvestment
    if (isConvertingToInvestment) {
      await tx.insert(investmentSnapshots).values({
        id: generateId(),
        accountId: id,
        spaceId: space.id,
      createdByUserId: session.id,
        value: currentValue ?? initialBalance,
        date: existingAccount.createdAt.toISOString().slice(0, 10),
        createdAt: existingAccount.createdAt,
      })
    }
  })

  revalidatePath('/')
  revalidatePath('/settings')
  revalidatePath(`/account/${id}`)
  return { success: true }
}

/**
 * Delete an account
 */
export async function deleteAccount(id: string): Promise<AccountActionResult> {
  const { space } = await getCurrentSpace()

  const [deletedAccount] = await db.delete(accounts).where(
    and(
      eq(accounts.id, id),
      eq(accounts.spaceId, space.id)
    )
  ).returning({ id: accounts.id })

  if (!deletedAccount) {
    return { success: false, error: 'Account not found' }
  }

  revalidatePath('/')
  revalidatePath('/settings')
  return { success: true }
}

/**
 * Persist the user's preferred account display order.
 */
export async function reorderAccounts(accountIds: string[]): Promise<AccountActionResult> {
  const { space } = await getCurrentSpace()

  const uniqueIds = Array.from(new Set(accountIds.filter(Boolean)))
  if (uniqueIds.length !== accountIds.length || uniqueIds.length === 0) {
    return { success: false, error: 'Invalid account order' }
  }

  const existingAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.spaceId, space.id))

  const existingIds = new Set(existingAccounts.map((account) => account.id))
  if (uniqueIds.length !== existingIds.size || uniqueIds.some((id) => !existingIds.has(id))) {
    return { success: false, error: 'Account order does not match your accounts' }
  }

  const now = new Date()
  await db.transaction(async (tx) => {
    for (const [index, id] of uniqueIds.entries()) {
      await tx
        .update(accounts)
        .set({ sortOrder: index, updatedAt: now })
        .where(and(eq(accounts.id, id), eq(accounts.spaceId, space.id)))
    }
  })

  revalidatePath('/')
  revalidatePath('/settings')
  return { success: true }
}

/**
 * Get all accounts for the current user
 */
export async function getAccounts() {
  const { space } = await getCurrentSpace()

  return db
    .select()
    .from(accounts)
    .where(eq(accounts.spaceId, space.id))
    .orderBy(sql`${accounts.sortOrder} ASC, ${accounts.bankName} ASC, ${accounts.createdAt} ASC`)
}

/**
 * Get paginated movements for an account (used by "load more" on account detail)
 */
export async function getAccountMovements(accountId: string, offset: number, limit: number = 50, transfersOnly: boolean = false) {
  const { space } = await getCurrentSpace()
  const whereCondition = transfersOnly
    ? and(eq(movements.accountId, accountId), eq(movements.spaceId, space.id), isNotNull(movements.transferId))
    : and(eq(movements.accountId, accountId), eq(movements.spaceId, space.id))

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
    .leftJoin(categories, and(eq(movements.categoryId, categories.id), eq(categories.spaceId, space.id)))
    .where(whereCondition)
    .orderBy(desc(movements.date), desc(movements.createdAt))
    .limit(limit)
    .offset(offset)
}
