'use server'

import { revalidatePath } from 'next/cache'
import { db, movements, accounts, spaces, transfers, spaceMemberships } from '@/lib/db'
import { eq, and, isNull, or } from 'drizzle-orm'
import { getCurrentSpace } from '@/lib/spaces'
import { getUsdToClpRate } from '@/lib/exchange-rate'
import { movementLedger, type AmountInputMode } from '@/lib/domain/movement-ledger'

export type TransferActionResult = {
  success: boolean
  error?: string
  transferId?: string
}

export type TransferSideClassificationInput = {
  reportable?: boolean
  categoryId?: string | null
  receivable?: boolean
  receivableText?: string | null
}

interface CreateTransferParams {
  fromAccountId: string
  toAccountId?: string | null
  destinationSpaceId?: string
  fromAmount: number
  toAmount: number
  fromCurrency: 'CLP' | 'USD'
  toCurrency: 'CLP' | 'USD'
  date: string
  note?: string
  source?: TransferSideClassificationInput
  destination?: TransferSideClassificationInput
}

function revalidateTransferPaths() {
  revalidatePath('/')
  revalidatePath('/review')
  revalidatePath('/reports')
  revalidatePath('/emergency')
}

export async function recordTransfer(params: CreateTransferParams): Promise<TransferActionResult> {
  const { user: session, space } = await getCurrentSpace()
  const destinationSpaceId = params.destinationSpaceId || space.id
  const isInterSpace = destinationSpaceId !== space.id
  if (isInterSpace) {
    const sourceReportable = params.source?.reportable !== false
    const destinationReportable = params.destination?.reportable !== false
    if (sourceReportable && !params.source?.categoryId) return { success: false, error: 'El origen reportable requiere categoría' }
    if (sourceReportable && params.source?.receivable && !params.source.receivableText?.trim()) return { success: false, error: 'Indica quién debe pagar este gasto' }
    if (params.toAccountId && destinationReportable && !params.destination?.categoryId) return { success: false, error: 'El destino reportable requiere categoría' }
  }
  const result = await movementLedger.recordTransfer(space.id, session.id, params)
  if (result.success) revalidateTransferPaths()
  return result
}

/**
 * Get transfer details by movement ID (returns both movements)
 */
export async function getTransferByMovementId(movementId: string) {
  const { user: session, space } = await getCurrentSpace()

  const [movement] = await db
    .select({ id: movements.id })
    .from(movements)
    .where(and(eq(movements.id, movementId), eq(movements.spaceId, space.id)))
    .limit(1)

  if (!movement) return null

  const [transfer] = await db
    .select()
    .from(transfers)
    .where(or(eq(transfers.sourceMovementId, movementId), eq(transfers.destinationMovementId, movementId)))
    .limit(1)

  if (!transfer || (transfer.sourceSpaceId !== space.id && transfer.destinationSpaceId !== space.id)) return null

  const memberships = await db
    .select({ spaceId: spaceMemberships.spaceId })
    .from(spaceMemberships)
    .innerJoin(spaces, eq(spaceMemberships.spaceId, spaces.id))
    .where(and(eq(spaceMemberships.userId, session.id), isNull(spaces.archivedAt)))
  const memberSpaceIds = new Set(memberships.map((m) => m.spaceId))
  const canEdit = memberSpaceIds.has(transfer.sourceSpaceId) && memberSpaceIds.has(transfer.destinationSpaceId)

  // Do not load or return the other side of a transfer unless the user still
  // has access to both Spaces. The timeline may show the accessible movement,
  // but the full edit shape contains private movement/account details from both
  // sides and is only safe for users who can operate the full transfer.
  if (!canEdit) return null

  const transferMovements = await db
    .select({
      id: movements.id,
      spaceId: movements.spaceId,
      accountId: movements.accountId,
      name: movements.name,
      date: movements.date,
      amount: movements.amount,
      type: movements.type,
      currency: movements.currency,
      amountUsd: movements.amountUsd,
      exchangeRate: movements.exchangeRate,
      accountBankName: accounts.bankName,
      accountLastFour: accounts.lastFourDigits,
      accountCurrency: accounts.currency,
      accountEmoji: accounts.emoji,
      categoryId: movements.categoryId,
      reportable: movements.reportable,
      receivable: movements.receivable,
    })
    .from(movements)
    .leftJoin(accounts, and(eq(movements.accountId, accounts.id), eq(accounts.spaceId, movements.spaceId)))
    .where(or(eq(movements.id, transfer.sourceMovementId), eq(movements.id, transfer.destinationMovementId)))

  if (transferMovements.length !== 2) return null
  const expenseMovement = transferMovements.find(m => m.id === transfer.sourceMovementId && m.type === 'expense')
  const incomeMovement = transferMovements.find(m => m.id === transfer.destinationMovementId && m.type === 'income')
  if (!expenseMovement || !incomeMovement) return null

  return {
    transferId: transfer.id,
    sourceSpaceId: transfer.sourceSpaceId,
    destinationSpaceId: transfer.destinationSpaceId,
    canEdit,
    fromMovement: expenseMovement,
    toMovement: incomeMovement,
  }
}

export async function updateTransfer(
  transferId: string,
  params: CreateTransferParams
): Promise<TransferActionResult> {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.updateTransfer(space.id, session.id, transferId, params)
  if (result.success) revalidateTransferPaths()
  return result
}

export async function deleteTransfer(transferId: string): Promise<TransferActionResult> {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.deleteTransfer(space.id, session.id, transferId)
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
  destinationSpaceId?: string
  toAmount: number
  toCurrency: 'CLP' | 'USD'
  note?: string
  sourceReportable?: boolean
  sourceCategoryId?: string | null
  sourceReceivable?: boolean
  sourceReceivableText?: string | null
  destinationReportable?: boolean
  destinationCategoryId?: string | null
}

export async function transformToTransfer(params: TransformToTransferParams): Promise<TransferActionResult> {
  const { user: session, space } = await getCurrentSpace()
  const destinationSpaceId = params.destinationSpaceId || space.id
  const isInterSpace = destinationSpaceId !== space.id
  if (isInterSpace) {
    const sourceReportable = params.sourceReportable !== false
    const destinationReportable = params.destinationReportable !== false
    if (sourceReportable && !params.sourceCategoryId) return { success: false, error: 'El origen reportable requiere categoría' }
    if (sourceReportable && params.sourceReceivable && !params.sourceReceivableText?.trim()) return { success: false, error: 'Indica quién debe pagar este gasto' }
    if (destinationReportable && !params.destinationCategoryId) return { success: false, error: 'El destino reportable requiere categoría' }
  }
  const result = await movementLedger.transformToTransfer(space.id, session.id, {
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
  const { user: session, space } = await getCurrentSpace()
  const destinationSpaceId = params.destinationSpaceId || space.id
  const isInterSpace = destinationSpaceId !== space.id
  if (isInterSpace) {
    const sourceReportable = params.sourceReportable !== false
    const destinationReportable = params.destinationReportable !== false
    if (sourceReportable && !params.sourceCategoryId) return { success: false, error: 'El origen reportable requiere categoría' }
    if (sourceReportable && params.sourceReceivable && !params.sourceReceivableText?.trim()) return { success: false, error: 'Indica quién debe pagar este gasto' }
    if (destinationReportable && !params.destinationCategoryId) return { success: false, error: 'El destino reportable requiere categoría' }
  }
  const result = await movementLedger.confirmPendingAsTransfer(space.id, session.id, {
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
