'use server'

import { revalidatePath } from 'next/cache'
import { db, movements, categories, accounts, transfers, receivableSettlements } from '@/lib/db'
import { movementLedger, type AmountInputMode } from '@/lib/domain/movement-ledger'
import { eq, and, desc, inArray, or, sql } from 'drizzle-orm'
import { getCurrentSpace } from '@/lib/spaces'
import { getPendingReviewItemCount } from '@/lib/domain/pending-review'

export async function getPendingReviewCount() {
  const { space } = await getCurrentSpace()
  return getPendingReviewItemCount(space.id)
}

export async function getPendingReviewMovements() {
  const { space, spaces } = await getCurrentSpace()

  const pendingMovements = await db
    .select({
      id: movements.id,
      name: movements.name,
      date: movements.date,
      amount: movements.amount,
      type: movements.type,
      currency: movements.currency,
      amountUsd: movements.amountUsd,
      exchangeRate: movements.exchangeRate,
      accountId: movements.accountId,
      categoryId: movements.categoryId,
      reportable: movements.reportable,
      receivable: movements.receivable,
      received: movements.received,
      needsReview: movements.needsReview,
      time: movements.time,
      originalName: movements.originalName,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      accountBankName: accounts.bankName,
      accountLastFour: accounts.lastFourDigits,
      receivableSettlementRole: sql<'receivable' | 'outgoing' | 'incoming' | null>`(
        SELECT CASE
          WHEN ${receivableSettlements.receivableId} = ${movements.id} THEN 'receivable'
          WHEN ${receivableSettlements.outgoingMovementId} = ${movements.id} THEN 'outgoing'
          WHEN ${receivableSettlements.incomingMovementId} = ${movements.id} THEN 'incoming'
          ELSE NULL
        END
        FROM ${receivableSettlements}
        WHERE ${receivableSettlements.receivableId} = ${movements.id}
           OR ${receivableSettlements.outgoingMovementId} = ${movements.id}
           OR ${receivableSettlements.incomingMovementId} = ${movements.id}
        LIMIT 1
      )`,
    })
    .from(movements)
    .leftJoin(categories, and(eq(movements.categoryId, categories.id), eq(categories.spaceId, space.id)))
    .leftJoin(accounts, and(eq(movements.accountId, accounts.id), eq(accounts.spaceId, space.id)))
    .where(and(eq(movements.spaceId, space.id), eq(movements.needsReview, true)))
    .orderBy(desc(movements.date), desc(movements.createdAt))

  if (pendingMovements.length === 0) return pendingMovements

  const pendingIds = pendingMovements.map((movement) => movement.id)
  const transferRoots = await db
    .select()
    .from(transfers)
    .where(or(inArray(transfers.sourceMovementId, pendingIds), inArray(transfers.destinationMovementId, pendingIds)))

  if (transferRoots.length === 0) return pendingMovements

  const memberSpaceIds = new Set(spaces.map((memberSpace) => memberSpace.id))
  const transferByMovementId = new Map<string, typeof transferRoots[number]>()
  const relatedMovementIds = new Set<string>()
  for (const transfer of transferRoots) {
    transferByMovementId.set(transfer.sourceMovementId, transfer)
    transferByMovementId.set(transfer.destinationMovementId, transfer)
    relatedMovementIds.add(transfer.sourceMovementId)
    relatedMovementIds.add(transfer.destinationMovementId)
  }

  const relatedMovements = await db
    .select({
      id: movements.id,
      spaceId: movements.spaceId,
      name: movements.name,
      date: movements.date,
      amount: movements.amount,
      type: movements.type,
      currency: movements.currency,
      amountUsd: movements.amountUsd,
      exchangeRate: movements.exchangeRate,
      accountId: movements.accountId,
      categoryId: movements.categoryId,
      reportable: movements.reportable,
      receivable: movements.receivable,
      needsReview: movements.needsReview,
      time: movements.time,
      accountBankName: accounts.bankName,
      accountLastFour: accounts.lastFourDigits,
    })
    .from(movements)
    .leftJoin(accounts, and(eq(movements.accountId, accounts.id), eq(accounts.spaceId, movements.spaceId)))
    .where(inArray(movements.id, Array.from(relatedMovementIds)))

  const movementById = new Map(relatedMovements.map((movement) => [movement.id, movement]))
  const seenTransferIds = new Set<string>()

  return pendingMovements.flatMap((movement) => {
    const transfer = transferByMovementId.get(movement.id)
    if (!transfer) return [movement]
    if (seenTransferIds.has(transfer.id)) return []
    seenTransferIds.add(transfer.id)

    const canReviewTransfer = memberSpaceIds.has(transfer.sourceSpaceId) && memberSpaceIds.has(transfer.destinationSpaceId)
    const source = memberSpaceIds.has(transfer.sourceSpaceId) ? movementById.get(transfer.sourceMovementId) : null
    const destination = memberSpaceIds.has(transfer.destinationSpaceId) ? movementById.get(transfer.destinationMovementId) : null

    return [{
      ...movement,
      transferId: transfer.id,
      transferSourceMovementId: transfer.sourceMovementId,
      transferDestinationMovementId: transfer.destinationMovementId,
      transferSourceSpaceId: transfer.sourceSpaceId,
      transferDestinationSpaceId: transfer.destinationSpaceId,
      transferCanReview: canReviewTransfer,
      transferSourceMovement: source ?? null,
      transferDestinationMovement: destination ?? null,
    }]
  })
}

export async function confirmPendingAsReportable(id: string, data: {
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
  emergency?: boolean
  loan?: boolean
}) {
  const { space } = await getCurrentSpace()
  const result = await movementLedger.confirmPendingAsReportable(space.id, id, {
    ...data,
    amountInputMode: data.amountInputMode ?? 'canonicalClp',
  })
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
    revalidatePath('/emergency')
    revalidatePath('/loans')
    revalidatePath('/reports')
  }
  return result
}

export async function deletePendingMovement(id: string) {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.deletePendingMovement(space.id, session.id, id)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
    revalidatePath('/reports')
    revalidatePath('/receivables')
  }
  return result
}

export async function confirmPendingTransfer(transferId: string, classification?: { source?: { reportable?: boolean; categoryId?: string | null; receivable?: boolean; receivableText?: string | null }; destination?: { reportable?: boolean; categoryId?: string | null; receivable?: boolean } }) {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.confirmPendingTransfer(space.id, session.id, transferId, classification)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
    revalidatePath('/reports')
  }
  return result
}

export async function deletePendingTransfer(transferId: string) {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.deletePendingTransfer(space.id, session.id, transferId)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
    revalidatePath('/reports')
  }
  return result
}

export async function markAsReceivable(id: string, reminderText: string) {
  const { space } = await getCurrentSpace()
  const result = await movementLedger.markAsReceivable(space.id, id, reminderText)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
    revalidatePath('/receivables')
    revalidatePath('/reports')
  }
  return result
}

export async function unmarkReceivable(id: string) {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.unmarkReceivable(space.id, session.id, id)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
    revalidatePath('/receivables')
    revalidatePath('/reports')
  }
  return result
}

export async function splitMovement(originalId: string, splits: { name: string; amount: number }[]) {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.splitMovement(space.id, session.id, originalId, splits)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
    revalidatePath('/reports')
  }
  return result
}

export async function settleReceivableWithNewMovement(id: string, paymentAccountId?: string) {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.settleReceivableWithNewMovement(space.id, session.id, id, paymentAccountId)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/receivables')
    revalidatePath('/reports')
  }
  return result
}

export async function settleReceivableWithExistingMovement(receivableId: string, existingIncomeId: string) {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.settleReceivableWithExistingMovement(space.id, session.id, receivableId, existingIncomeId)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
    revalidatePath('/receivables')
    revalidatePath('/reports')
  }
  return result
}

export async function settleReceivableWithCrossSpacePayment(receivableId: string, data: {
  payingSpaceId: string
  sourceAccountId: string
  destinationAccountId: string
  amount: number
  date: string
}) {
  const { user: session, space } = await getCurrentSpace()
  const result = await movementLedger.settleReceivableWithCrossSpacePayment(space.id, session.id, receivableId, data)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/review')
    revalidatePath('/receivables')
    revalidatePath('/reports')
  }
  return result
}

export async function getAccountsAndCategories() {
  const { space } = await getCurrentSpace()
  const [userAccounts, userCategories] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(eq(accounts.spaceId, space.id))
      .orderBy(accounts.bankName),
    db
      .select()
      .from(categories)
      .where(eq(categories.spaceId, space.id))
      .orderBy(categories.name),
  ])
  return { accounts: userAccounts, categories: userCategories }
}
