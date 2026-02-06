'use server'

import { revalidatePath } from 'next/cache'
import { db, movements, accounts } from '@/lib/db'
import { eq, and, or } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'
import { generateId } from '@/lib/utils'
import { getUsdToClpRate } from '@/lib/exchange-rate'

export type TransferActionResult = {
  success: boolean
  error?: string
  transferId?: string
}

interface CreateTransferParams {
  fromAccountId: string
  toAccountId: string
  fromAmount: number // cents in source currency
  toAmount: number // cents in destination currency
  fromCurrency: 'CLP' | 'USD'
  toCurrency: 'CLP' | 'USD'
  date: string
  note?: string
}

/**
 * Create a transfer between two accounts.
 * Creates two linked movements: expense from source, income to destination.
 */
export async function createTransfer(params: CreateTransferParams): Promise<TransferActionResult> {
  const session = await requireAuth()
  const { fromAccountId, toAccountId, fromAmount, toAmount, fromCurrency, toCurrency, date, note } = params

  if (fromAccountId === toAccountId) {
    return { success: false, error: 'Las cuentas origen y destino deben ser diferentes' }
  }

  if (fromAmount <= 0 || toAmount <= 0) {
    return { success: false, error: 'Los montos deben ser mayores a 0' }
  }

  // Verify both accounts belong to the current user
  const [fromAccount, toAccount] = await Promise.all([
    db.select({ id: accounts.id, currency: accounts.currency, bankName: accounts.bankName })
      .from(accounts)
      .where(and(eq(accounts.id, fromAccountId), eq(accounts.userId, session.id)))
      .limit(1),
    db.select({ id: accounts.id, currency: accounts.currency, bankName: accounts.bankName })
      .from(accounts)
      .where(and(eq(accounts.id, toAccountId), eq(accounts.userId, session.id)))
      .limit(1),
  ])

  if (!fromAccount[0]) {
    return { success: false, error: 'Cuenta origen no válida' }
  }
  if (!toAccount[0]) {
    return { success: false, error: 'Cuenta destino no válida' }
  }

  const transferId = generateId()
  const fromMovementId = generateId()
  const toMovementId = generateId()

  const transferName = note?.trim() || `Transferencia a ${toAccount[0].bankName}`
  const receiveTransferName = note?.trim() || `Transferencia desde ${fromAccount[0].bankName}`

  // Calculate amounts for storage (always store in CLP + original if USD)
  let fromAmountCLP = fromAmount
  let fromAmountUsd: number | null = null
  let fromExchangeRate: number | null = null

  let toAmountCLP = toAmount
  let toAmountUsd: number | null = null
  let toExchangeRate: number | null = null

  // Handle USD conversion for source account
  if (fromCurrency === 'USD') {
    fromAmountUsd = fromAmount
    const rate = await getUsdToClpRate()
    fromAmountCLP = Math.round(fromAmount * rate / 100)
    fromExchangeRate = rate
  }

  // Handle USD conversion for destination account
  if (toCurrency === 'USD') {
    toAmountUsd = toAmount
    const rate = await getUsdToClpRate()
    toAmountCLP = Math.round(toAmount * rate / 100)
    toExchangeRate = rate
  }

  // Create both movements in a transaction-like manner
  await db.insert(movements).values([
    {
      id: fromMovementId,
      userId: session.id,
      accountId: fromAccountId,
      categoryId: null, // Transfers have no category
      name: transferName,
      date,
      amount: fromAmountCLP,
      type: 'expense',
      currency: fromCurrency,
      amountUsd: fromAmountUsd,
      exchangeRate: fromExchangeRate,
      transferId,
      transferPairId: toMovementId,
    },
    {
      id: toMovementId,
      userId: session.id,
      accountId: toAccountId,
      categoryId: null, // Transfers have no category
      name: receiveTransferName,
      date,
      amount: toAmountCLP,
      type: 'income',
      currency: toCurrency,
      amountUsd: toAmountUsd,
      exchangeRate: toExchangeRate,
      transferId,
      transferPairId: fromMovementId,
    },
  ])

  revalidatePath('/')
  return { success: true, transferId }
}

/**
 * Get transfer details by movement ID (returns both movements)
 */
export async function getTransferByMovementId(movementId: string) {
  const session = await requireAuth()

  // Get the movement
  const [movement] = await db
    .select()
    .from(movements)
    .where(and(eq(movements.id, movementId), eq(movements.userId, session.id)))
    .limit(1)

  if (!movement || !movement.transferId) {
    return null
  }

  // Get both movements of the transfer
  const transferMovements = await db
    .select({
      id: movements.id,
      accountId: movements.accountId,
      name: movements.name,
      date: movements.date,
      amount: movements.amount,
      type: movements.type,
      currency: movements.currency,
      amountUsd: movements.amountUsd,
      exchangeRate: movements.exchangeRate,
      transferId: movements.transferId,
      transferPairId: movements.transferPairId,
      accountBankName: accounts.bankName,
      accountLastFour: accounts.lastFourDigits,
      accountCurrency: accounts.currency,
      accountEmoji: accounts.emoji,
    })
    .from(movements)
    .leftJoin(accounts, eq(movements.accountId, accounts.id))
    .where(and(
      eq(movements.transferId, movement.transferId),
      eq(movements.userId, session.id)
    ))

  if (transferMovements.length !== 2) {
    return null
  }

  const expenseMovement = transferMovements.find(m => m.type === 'expense')
  const incomeMovement = transferMovements.find(m => m.type === 'income')

  if (!expenseMovement || !incomeMovement) {
    return null
  }

  return {
    transferId: movement.transferId,
    fromMovement: expenseMovement,
    toMovement: incomeMovement,
  }
}

/**
 * Update a transfer (both movements)
 */
export async function updateTransfer(
  transferId: string,
  params: {
    fromAmount: number
    toAmount: number
    fromCurrency: 'CLP' | 'USD'
    toCurrency: 'CLP' | 'USD'
    date: string
    note?: string
  }
): Promise<TransferActionResult> {
  const session = await requireAuth()
  const { fromAmount, toAmount, fromCurrency, toCurrency, date, note } = params

  // Get both movements
  const transferMovements = await db
    .select()
    .from(movements)
    .where(and(
      eq(movements.transferId, transferId),
      eq(movements.userId, session.id)
    ))

  if (transferMovements.length !== 2) {
    return { success: false, error: 'Transferencia no encontrada' }
  }

  const expenseMovement = transferMovements.find(m => m.type === 'expense')
  const incomeMovement = transferMovements.find(m => m.type === 'income')

  if (!expenseMovement || !incomeMovement) {
    return { success: false, error: 'Transferencia corrupta' }
  }

  // Get account names for note generation
  const [fromAccount, toAccount] = await Promise.all([
    db.select({ bankName: accounts.bankName })
      .from(accounts)
      .where(eq(accounts.id, expenseMovement.accountId!))
      .limit(1),
    db.select({ bankName: accounts.bankName })
      .from(accounts)
      .where(eq(accounts.id, incomeMovement.accountId!))
      .limit(1),
  ])

  const transferName = note?.trim() || `Transferencia a ${toAccount[0]?.bankName || 'cuenta'}`
  const receiveTransferName = note?.trim() || `Transferencia desde ${fromAccount[0]?.bankName || 'cuenta'}`

  // Calculate amounts
  let fromAmountCLP = fromAmount
  let fromAmountUsd: number | null = null
  let fromExchangeRate: number | null = null

  let toAmountCLP = toAmount
  let toAmountUsd: number | null = null
  let toExchangeRate: number | null = null

  if (fromCurrency === 'USD') {
    fromAmountUsd = fromAmount
    const rate = await getUsdToClpRate()
    fromAmountCLP = Math.round(fromAmount * rate / 100)
    fromExchangeRate = rate
  }

  if (toCurrency === 'USD') {
    toAmountUsd = toAmount
    const rate = await getUsdToClpRate()
    toAmountCLP = Math.round(toAmount * rate / 100)
    toExchangeRate = rate
  }

  // Update both movements
  await Promise.all([
    db.update(movements)
      .set({
        name: transferName,
        date,
        amount: fromAmountCLP,
        currency: fromCurrency,
        amountUsd: fromAmountUsd,
        exchangeRate: fromExchangeRate,
        updatedAt: new Date(),
      })
      .where(eq(movements.id, expenseMovement.id)),
    db.update(movements)
      .set({
        name: receiveTransferName,
        date,
        amount: toAmountCLP,
        currency: toCurrency,
        amountUsd: toAmountUsd,
        exchangeRate: toExchangeRate,
        updatedAt: new Date(),
      })
      .where(eq(movements.id, incomeMovement.id)),
  ])

  revalidatePath('/')
  return { success: true }
}

/**
 * Delete a transfer (both movements)
 */
export async function deleteTransfer(transferId: string): Promise<TransferActionResult> {
  const session = await requireAuth()

  // Delete both movements with this transferId
  await db.delete(movements).where(
    and(
      eq(movements.transferId, transferId),
      eq(movements.userId, session.id)
    )
  )

  revalidatePath('/')
  return { success: true }
}

/**
 * Get current exchange rate for UI
 */
export async function getCurrentExchangeRate(): Promise<number> {
  return getUsdToClpRate()
}

interface ConvertToTransferParams {
  movementId: string
  toAccountId: string
  toAmount: number // cents in destination currency
  toCurrency: 'CLP' | 'USD'
  note?: string
}

/**
 * Convert an existing movement to a transfer.
 * Creates the paired movement and links them together.
 */
export async function convertToTransfer(params: ConvertToTransferParams): Promise<TransferActionResult> {
  const session = await requireAuth()
  const { movementId, toAccountId, toAmount, toCurrency, note } = params

  // Get the original movement
  const [originalMovement] = await db
    .select()
    .from(movements)
    .where(and(eq(movements.id, movementId), eq(movements.userId, session.id)))
    .limit(1)

  if (!originalMovement) {
    return { success: false, error: 'Movimiento no encontrado' }
  }

  if (originalMovement.transferId) {
    return { success: false, error: 'Este movimiento ya es una transferencia' }
  }

  if (!originalMovement.accountId) {
    return { success: false, error: 'El movimiento debe tener una cuenta asignada' }
  }

  if (originalMovement.accountId === toAccountId) {
    return { success: false, error: 'Las cuentas origen y destino deben ser diferentes' }
  }

  if (toAmount <= 0) {
    return { success: false, error: 'El monto destino debe ser mayor a 0' }
  }

  // Get both accounts to verify ownership and get names
  const [fromAccount, toAccount] = await Promise.all([
    db.select({ id: accounts.id, bankName: accounts.bankName, currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.id, originalMovement.accountId), eq(accounts.userId, session.id)))
      .limit(1),
    db.select({ id: accounts.id, bankName: accounts.bankName, currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.id, toAccountId), eq(accounts.userId, session.id)))
      .limit(1),
  ])

  if (!fromAccount[0]) {
    return { success: false, error: 'Cuenta origen no válida' }
  }
  if (!toAccount[0]) {
    return { success: false, error: 'Cuenta destino no válida' }
  }

  const transferId = generateId()
  const pairedMovementId = generateId()

  // Determine names
  const expenseName = note?.trim() || `Transferencia a ${toAccount[0].bankName}`
  const incomeName = note?.trim() || `Transferencia desde ${fromAccount[0].bankName}`

  // Calculate amounts for the paired movement
  let toAmountCLP = toAmount
  let toAmountUsd: number | null = null
  let toExchangeRate: number | null = null

  if (toCurrency === 'USD') {
    toAmountUsd = toAmount
    const rate = await getUsdToClpRate()
    toAmountCLP = Math.round(toAmount * rate / 100)
    toExchangeRate = rate
  }

  // Determine the type of the paired movement (opposite of original)
  const pairedType = originalMovement.type === 'expense' ? 'income' : 'expense'

  // Create the paired movement
  await db.insert(movements).values({
    id: pairedMovementId,
    userId: session.id,
    accountId: toAccountId,
    categoryId: null, // Transfers have no category
    name: pairedType === 'income' ? incomeName : expenseName,
    date: originalMovement.date,
    amount: toAmountCLP,
    type: pairedType,
    currency: toCurrency,
    amountUsd: toAmountUsd,
    exchangeRate: toExchangeRate,
    transferId,
    transferPairId: movementId,
    time: originalMovement.time,
    needsReview: false,
  })

  // Update the original movement to be part of the transfer
  await db.update(movements)
    .set({
      name: originalMovement.type === 'expense' ? expenseName : incomeName,
      transferId,
      transferPairId: pairedMovementId,
      categoryId: null, // Transfers have no category
      needsReview: false,
      updatedAt: new Date(),
    })
    .where(eq(movements.id, movementId))

  revalidatePath('/')
  return { success: true, transferId }
}
