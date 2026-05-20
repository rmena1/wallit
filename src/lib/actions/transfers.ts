'use server'

import { revalidatePath } from 'next/cache'
import { db, movements, accounts } from '@/lib/db'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'
import { getUsdToClpRate } from '@/lib/exchange-rate'
import { movementLedger, type AmountInputMode } from '@/lib/domain/movement-ledger'

export type TransferActionResult = {
  success: boolean
  error?: string
  transferId?: string
}

interface CreateTransferParams {
  fromAccountId: string
  toAccountId: string
  fromAmount: number
  toAmount: number
  fromCurrency: 'CLP' | 'USD'
  toCurrency: 'CLP' | 'USD'
  date: string
  note?: string
}

function revalidateTransferPaths() {
  revalidatePath('/')
  revalidatePath('/review')
  revalidatePath('/reports')
  revalidatePath('/emergency')
}

export async function recordTransfer(params: CreateTransferParams): Promise<TransferActionResult> {
  const session = await requireAuth()
  const result = await movementLedger.recordTransfer(session.id, params)
  if (result.success) revalidateTransferPaths()
  return result
}

/**
 * Get transfer details by movement ID (returns both movements)
 */
export async function getTransferByMovementId(movementId: string) {
  const session = await requireAuth()

  const [movement] = await db
    .select()
    .from(movements)
    .where(and(eq(movements.id, movementId), eq(movements.userId, session.id)))
    .limit(1)

  if (!movement || !movement.transferId) return null

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
    .where(and(eq(movements.transferId, movement.transferId), eq(movements.userId, session.id)))

  if (transferMovements.length !== 2) return null
  const expenseMovement = transferMovements.find(m => m.type === 'expense')
  const incomeMovement = transferMovements.find(m => m.type === 'income')
  if (!expenseMovement || !incomeMovement) return null
  if (expenseMovement.transferPairId !== incomeMovement.id || incomeMovement.transferPairId !== expenseMovement.id) return null

  return { transferId: movement.transferId, fromMovement: expenseMovement, toMovement: incomeMovement }
}

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
  const result = await movementLedger.updateTransfer(session.id, transferId, params)
  if (result.success) revalidateTransferPaths()
  return result
}

export async function deleteTransfer(transferId: string): Promise<TransferActionResult> {
  const session = await requireAuth()
  const result = await movementLedger.deleteTransfer(session.id, transferId)
  if (result.success) revalidateTransferPaths()
  return result
}

export async function getCurrentExchangeRate(): Promise<number> {
  return getUsdToClpRate()
}

interface TransformToTransferParams {
  movementId: string
  source: {
    name: string
    date: string
    amount: number
    type: 'income' | 'expense'
    currency: 'CLP' | 'USD'
    accountId: string | null
    categoryId: string | null
    amountUsd: number | null
    exchangeRate: number | null
    amountInputMode?: AmountInputMode
    time?: string | null
  }
  toAccountId: string
  toAmount: number
  toCurrency: 'CLP' | 'USD'
  note?: string
}

export async function transformToTransfer(params: TransformToTransferParams): Promise<TransferActionResult> {
  const session = await requireAuth()
  const result = await movementLedger.transformToTransfer(session.id, {
    ...params,
    source: {
      ...params.source,
      amountInputMode: params.source.amountInputMode ?? 'canonicalClp',
    },
  })
  if (result.success) revalidateTransferPaths()
  return result
}

export async function confirmPendingAsTransfer(params: TransformToTransferParams): Promise<TransferActionResult> {
  const session = await requireAuth()
  const result = await movementLedger.confirmPendingAsTransfer(session.id, {
    ...params,
    source: {
      ...params.source,
      amountInputMode: params.source.amountInputMode ?? 'canonicalClp',
    },
    requirePending: true,
  })
  if (result.success) revalidateTransferPaths()
  return result
}
