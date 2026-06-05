import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { accounts, categories, db, emergencyPayments, movements, receivableSettlements, spaces, spaceMemberships, transfers, type Account, type Movement, type ReceivableSettlement, type Space, type Transfer } from '@/lib/db'
import { convertUsdToClp, getUsdToClpRate } from '@/lib/exchange-rate'
import { formatCurrency, generateId } from '@/lib/utils'

export type LedgerResult = { success: boolean; error?: string; transferId?: string; settlementId?: string; remaining?: number; settled?: boolean; totalPaid?: number }
export type Currency = 'CLP' | 'USD'
export type MovementType = 'income' | 'expense'
export type AmountInputMode = 'inputCurrency' | 'canonicalClp'

const RECEIVABLE_SETTLEMENT_TOLERANCE = 0.05
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type MovementInput = {
  name: string
  date: string
  amount: number
  amountInputMode: AmountInputMode
  type: MovementType
  currency: Currency
  accountId: string | null
  categoryId: string | null
  amountUsd?: number | null
  exchangeRate?: number | null
  time?: string | null
}

type ReportableInput = MovementInput & {
  originalName?: string | null
  emergency?: boolean
  loan?: boolean
}

type TransferInput = {
  fromAccountId: string
  toAccountId?: string | null
  destinationSpaceId?: string
  fromAmount: number
  toAmount: number
  fromCurrency: Currency
  toCurrency: Currency
  date: string
  note?: string
}

type TransformToTransferInput = {
  movementId: string
  source: MovementInput
  toAccountId: string
  destinationSpaceId?: string
  toAmount: number
  toCurrency: Currency
  note?: string
  requirePending?: boolean
}

type CrossSpaceReceivableSettlementInput = {
  payingSpaceId: string
  sourceAccountId: string
  destinationAccountId: string
  amount: number
  date: string
}

type NormalizedMoney = {
  amount: number
  amountUsd: number | null
  exchangeRate: number | null
  account: Pick<Account, 'id' | 'currency' | 'bankName'>
}

function ok(extra: Omit<LedgerResult, 'success'> = {}): LedgerResult {
  return { success: true, ...extra }
}

function fail(error: string): LedgerResult {
  return { success: false, error }
}

function hasDependentWorkflow(movement: Movement): boolean {
  return Boolean(
    movement.receivableId ||
    movement.loanId
  )
}

function isOperational(movement: Pick<Movement, 'needsReview' | 'receivable' | 'receivableId' | 'emergency' | 'loan' | 'loanId'>): boolean {
  return Boolean(
    movement.needsReview ||
    movement.receivable ||
    movement.receivableId ||
    movement.emergency ||
    movement.loan ||
    movement.loanId
  )
}

async function getMemberSpace(userId: string, spaceId: string): Promise<Pick<Space, 'id' | 'name' | 'isPersonal'> | null> {
  const [space] = await db
    .select({ id: spaces.id, name: spaces.name, isPersonal: spaces.isPersonal })
    .from(spaceMemberships)
    .innerJoin(spaces, eq(spaceMemberships.spaceId, spaces.id))
    .where(and(eq(spaceMemberships.userId, userId), eq(spaceMemberships.spaceId, spaceId), isNull(spaces.archivedAt)))
    .limit(1)
  return space ?? null
}

async function getAccountInSpace(spaceId: string, accountId: string | null): Promise<Pick<Account, 'id' | 'currency' | 'bankName'> | null> {
  return getOwnedAccount(spaceId, accountId)
}


type PendingMemberPersonalDestination = {
  id: string
  name: string
  destinationUserId: string
}

async function getPendingMemberPersonalDestination(actorUserId: string, sourceSpaceId: string, destinationSpaceId: string): Promise<PendingMemberPersonalDestination | null> {
  const [destination] = await db
    .select({ id: spaces.id, name: spaces.name, isPersonal: spaces.isPersonal, createdByUserId: spaces.createdByUserId })
    .from(spaces)
    .where(and(eq(spaces.id, destinationSpaceId), eq(spaces.isPersonal, true), isNull(spaces.archivedAt)))
    .limit(1)

  if (!destination || destination.createdByUserId === actorUserId) return null

  const [destinationMembership] = await db
    .select({ userId: spaceMemberships.userId })
    .from(spaceMemberships)
    .where(and(eq(spaceMemberships.spaceId, destination.id), eq(spaceMemberships.userId, destination.createdByUserId)))
    .limit(1)
  if (!destinationMembership) return null

  const [sharedMembership] = await db
    .select({ userId: spaceMemberships.userId })
    .from(spaceMemberships)
    .innerJoin(spaces, eq(spaceMemberships.spaceId, spaces.id))
    .where(and(
      eq(spaceMemberships.spaceId, sourceSpaceId),
      eq(spaceMemberships.userId, destination.createdByUserId),
      eq(spaces.isPersonal, false),
      isNull(spaces.archivedAt),
    ))
    .limit(1)

  if (!sharedMembership) return null
  return { id: destination.id, name: destination.name, destinationUserId: destination.createdByUserId }
}

async function normalizePendingTransferLeg(amount: number, currency: Currency): Promise<Pick<NormalizedMoney, 'amount' | 'amountUsd' | 'exchangeRate'> | { error: string }> {
  if (!Number.isInteger(amount) || amount <= 0) return { error: 'Amount must be a positive integer' }
  if (currency === 'CLP') return { amount, amountUsd: null, exchangeRate: null }

  try {
    const conversion = await convertUsdToClp(amount)
    return { amount: conversion.clpCents, amountUsd: amount, exchangeRate: conversion.rate }
  } catch {
    return { error: 'Error al obtener tipo de cambio' }
  }
}

async function getTransferRootByMovementId(movementId: string) {
  const [transfer] = await db
    .select()
    .from(transfers)
    .where(or(eq(transfers.sourceMovementId, movementId), eq(transfers.destinationMovementId, movementId)))
    .limit(1)
  return transfer ?? null
}

async function getReceivableSettlementByMovementId(movementId: string): Promise<ReceivableSettlement | null> {
  const [settlement] = await db
    .select()
    .from(receivableSettlements)
    .where(or(
      eq(receivableSettlements.receivableId, movementId),
      eq(receivableSettlements.outgoingMovementId, movementId),
      eq(receivableSettlements.incomingMovementId, movementId),
    ))
    .limit(1)
  return settlement ?? null
}

type ReceivableSettlementMovementRole = 'receivable' | 'outgoing' | 'incoming'

async function getReceivableSettlementMovementLink(movementId: string): Promise<{ settlement: ReceivableSettlement; role: ReceivableSettlementMovementRole } | null> {
  const settlement = await getReceivableSettlementByMovementId(movementId)
  if (!settlement) return null
  if (settlement.receivableId === movementId) return { settlement, role: 'receivable' }
  if (settlement.outgoingMovementId === movementId) return { settlement, role: 'outgoing' }
  if (settlement.incomingMovementId === movementId) return { settlement, role: 'incoming' }
  return null
}

async function getReceivableSettlementByReceivableId(receivableId: string): Promise<ReceivableSettlement | null> {
  const [settlement] = await db
    .select()
    .from(receivableSettlements)
    .where(eq(receivableSettlements.receivableId, receivableId))
    .limit(1)
  return settlement ?? null
}

async function movementIsTransfer(movementId: string): Promise<boolean> {
  return Boolean(await getTransferRootByMovementId(movementId))
}

async function movementIsReceivableSettlement(movementId: string): Promise<boolean> {
  return Boolean(await getReceivableSettlementByMovementId(movementId))
}

async function transferIsEmergencySettlement(transferId: string): Promise<boolean> {
  const [payment] = await db
    .select({ id: emergencyPayments.id })
    .from(emergencyPayments)
    .where(eq(emergencyPayments.transferId, transferId))
    .limit(1)
  return Boolean(payment)
}

function transferSideNames(params: {
  sourceSpaceName: string
  destinationSpaceName: string
  sourceAccountName: string
  destinationAccountName: string
  note?: string
}) {
  const isInterSpace = params.sourceSpaceName !== params.destinationSpaceName
  const sourceTarget = isInterSpace ? params.destinationSpaceName : params.destinationAccountName
  const destinationSource = isInterSpace ? params.sourceSpaceName : params.sourceAccountName
  const suffix = params.note?.trim() ? ` · ${params.note.trim()}` : ''
  return {
    sourceName: `Transferencia a ${sourceTarget}${suffix}`,
    destinationName: `Transferencia desde ${destinationSource}${suffix}`,
  }
}

async function getOwnedAccount(spaceId: string, accountId: string | null): Promise<Pick<Account, 'id' | 'currency' | 'bankName'> | null> {
  if (!accountId) return null
  const [account] = await db
    .select({ id: accounts.id, currency: accounts.currency, bankName: accounts.bankName })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.spaceId, spaceId)))
    .limit(1)
  return account ?? null
}

async function ensureOwnedCategory(spaceId: string, categoryId: string | null): Promise<boolean> {
  if (!categoryId) return true
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.spaceId, spaceId)))
    .limit(1)
  return Boolean(category)
}

async function getOwnedMovement(spaceId: string, movementId: string): Promise<Movement | null> {
  const [movement] = await db
    .select()
    .from(movements)
    .where(and(eq(movements.id, movementId), eq(movements.spaceId, spaceId)))
    .limit(1)
  return movement ?? null
}

async function normalizeMoney(spaceId: string, input: Pick<MovementInput, 'amount' | 'amountInputMode' | 'currency' | 'accountId' | 'amountUsd' | 'exchangeRate'>): Promise<NormalizedMoney | { error: string }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { error: 'Amount must be a positive integer' }
  }

  const account = await getOwnedAccount(spaceId, input.accountId)
  if (!account) return { error: 'Invalid account' }

  let amount = input.amount
  let amountUsd = input.amountUsd ?? null
  let exchangeRate = input.exchangeRate ?? null

  if (input.currency === 'USD') {
    if (input.amountInputMode === 'canonicalClp') {
      if (amountUsd != null && (!Number.isInteger(amountUsd) || amountUsd <= 0)) {
        return { error: 'Monto USD inválido' }
      }
      if (exchangeRate != null && (!Number.isInteger(exchangeRate) || exchangeRate <= 0)) {
        return { error: 'Tipo de cambio inválido' }
      }

      if (amountUsd != null && exchangeRate != null) {
        const expectedClp = Math.round(amountUsd * exchangeRate / 100)
        const roundingTolerance = Math.max(1, Math.ceil(exchangeRate / 200))
        if (Math.abs(expectedClp - amount) > roundingTolerance) {
          return { error: 'Monto CLP, monto USD y tipo de cambio no coinciden' }
        }
        return { amount, amountUsd, exchangeRate, account }
      }

      if (amountUsd != null) {
        exchangeRate = Math.round(amount * 100 / amountUsd)
      } else if (exchangeRate != null) {
        amountUsd = Math.round(amount * 100 / exchangeRate)
      } else {
        try {
          exchangeRate = await getUsdToClpRate()
          amountUsd = Math.round(amount * 100 / exchangeRate)
        } catch {
          return { error: 'Error al obtener tipo de cambio' }
        }
      }

      return { amount, amountUsd, exchangeRate, account }
    }

    if (exchangeRate != null) {
      if (!Number.isInteger(exchangeRate) || exchangeRate <= 0) {
        return { error: 'Tipo de cambio inválido' }
      }
      amountUsd = input.amount
      amount = Math.round(input.amount * exchangeRate / 100)
    } else {
      try {
        const conversion = await convertUsdToClp(input.amount)
        amount = conversion.clpCents
        amountUsd = input.amount
        exchangeRate = conversion.rate
      } catch {
        return { error: 'Error al obtener tipo de cambio' }
      }
    }
  } else if (account.currency === 'USD') {
    try {
      const rate = await getUsdToClpRate()
      amountUsd = Math.round(input.amount * 100 / rate)
      exchangeRate = rate
    } catch {
      return { error: 'Error al obtener tipo de cambio' }
    }
  } else {
    amountUsd = null
    exchangeRate = null
  }

  return { amount, amountUsd, exchangeRate, account }
}

async function normalizeTransferLeg(spaceId: string, accountId: string, amount: number, currency: Currency): Promise<NormalizedMoney | { error: string }> {
  const account = await getOwnedAccount(spaceId, accountId)
  if (!account) return { error: 'Invalid account' }
  if (currency !== account.currency) return { error: 'La moneda no coincide con la cuenta' }

  return normalizeMoney(spaceId, { accountId, amount, amountInputMode: 'inputCurrency', currency })
}

function reportableResetFields() {
  return {
    needsReview: false,
    receivable: false,
    received: false,
    receivableId: null,
    emergency: false,
    emergencySettled: false,
    loan: false,
    loanSettled: false,
    loanId: null,
  }
}

async function hasReceivablePayments(spaceId: string, receivableId: string): Promise<boolean> {
  const [result] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(movements)
    .where(and(eq(movements.spaceId, spaceId), eq(movements.receivableId, receivableId)))
  return Number(result?.count ?? 0) > 0
}

async function hasEmergencyPaymentRows(spaceId: string, emergencyId: string): Promise<boolean> {
  const [result] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emergencyPayments)
    .innerJoin(movements, eq(emergencyPayments.emergencyId, movements.id))
    .where(and(eq(emergencyPayments.emergencyId, emergencyId), eq(emergencyPayments.spaceId, spaceId), eq(movements.spaceId, spaceId)))
  return Number(result?.count ?? 0) > 0
}

async function hasLoanPaybackRows(spaceId: string, loanId: string): Promise<boolean> {
  const [result] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(movements)
    .where(and(eq(movements.spaceId, spaceId), eq(movements.type, 'expense'), eq(movements.loanId, loanId)))
  return Number(result?.count ?? 0) > 0
}

function movementDisplayAmount(movement: Pick<Movement, 'amount' | 'amountUsd' | 'currency'>): number {
  return movement.currency === 'USD' ? (movement.amountUsd ?? 0) : movement.amount
}

function movementAmountInCurrency(movement: Pick<Movement, 'amount' | 'amountUsd'>, currency: Currency): number {
  return currency === 'USD' ? (movement.amountUsd ?? 0) : movement.amount
}

function hasAmountInCurrency(movement: Pick<Movement, 'amountUsd'>, currency: Currency): boolean {
  return currency === 'CLP' || movement.amountUsd != null
}

function settlementBounds(requiredClpAmount: number) {
  return {
    min: Math.ceil(requiredClpAmount * (1 - RECEIVABLE_SETTLEMENT_TOLERANCE)),
    max: Math.floor(requiredClpAmount * (1 + RECEIVABLE_SETTLEMENT_TOLERANCE)),
  }
}

function settlementAmountError(prefix: string, availableClpAmount: number, requiredClpAmount: number) {
  const bounds = settlementBounds(requiredClpAmount)
  return `${prefix}: disponible ${formatCurrency(availableClpAmount, 'CLP')}, requerido ${formatCurrency(requiredClpAmount, 'CLP')}, tolerancia ±5% (${formatCurrency(bounds.min, 'CLP')} a ${formatCurrency(bounds.max, 'CLP')})`
}

function isWithinReceivableSettlementTolerance(actualClpAmount: number, requiredClpAmount: number): boolean {
  const bounds = settlementBounds(requiredClpAmount)
  return actualClpAmount >= bounds.min && actualClpAmount <= bounds.max
}

function settlementSafeClassificationError() {
  return 'Receivable settlement expenses only allow name/category review; amount, date, account, currency and workflow type are locked'
}

function settlementIncomingAccountCorrectionError() {
  return 'Receivable settlement income only allows destination account correction; amount, date, name, category, currency and workflow type are locked'
}

function validatesSettlementOutgoingSafeFields(original: Movement, input: ReportableInput): boolean {
  return input.type === 'expense'
    && input.accountId === original.accountId
    && input.date === original.date
    && input.amount === original.amount
    && input.currency === original.currency
    && (input.amountUsd ?? null) === (original.amountUsd ?? null)
    && (input.exchangeRate ?? null) === (original.exchangeRate ?? null)
    && (input.time ?? null) === (original.time ?? null)
    && !input.emergency
    && !input.loan
}

function validatesSettlementIncomingSafeFields(original: Movement, input: ReportableInput): boolean {
  return input.type === 'income'
    && input.name.trim() === original.name
    && (input.categoryId || null) === (original.categoryId ?? null)
    && input.date === original.date
    && input.amount === original.amount
    && input.currency === original.currency
    && (input.amountUsd ?? null) === (original.amountUsd ?? null)
    && (input.exchangeRate ?? null) === (original.exchangeRate ?? null)
    && (input.time ?? null) === (original.time ?? null)
    && !input.emergency
    && !input.loan
}

function proportionalAmount(total: number, ratio: number): number {
  if (ratio >= 1) return total
  return Math.max(1, Math.min(total, Math.round(total * ratio)))
}

function proportionalNullableAmount(total: number | null, ratio: number): number | null {
  if (total == null) return null
  return proportionalAmount(total, ratio)
}

function addNullableAmount(current: number | null, restored: number | null): number | null {
  if (restored == null) return current
  return (current ?? 0) + restored
}

function subtractNullableAmount(current: number | null, consumed: number | null): number | null {
  if (current == null || consumed == null) return current
  return Math.max(0, current - consumed)
}

async function normalizeCanonicalForAccount(
  spaceId: string,
  account: Pick<Account, 'id' | 'currency' | 'bankName'>,
  canonicalClpAmount: number,
  preferredExchangeRate?: number | null,
): Promise<NormalizedMoney | { error: string }> {
  if (account.currency === 'CLP') {
    return normalizeMoney(spaceId, {
      accountId: account.id,
      amount: canonicalClpAmount,
      amountInputMode: 'inputCurrency',
      currency: 'CLP',
    })
  }

  const rate = preferredExchangeRate ?? await getUsdToClpRate()
  const amountUsd = Math.max(1, Math.round(canonicalClpAmount * 100 / rate))
  return normalizeMoney(spaceId, {
    accountId: account.id,
    amount: canonicalClpAmount,
    amountInputMode: 'canonicalClp',
    currency: 'USD',
    amountUsd,
    exchangeRate: rate,
  })
}

async function normalizeEmergencySettlementLeg(
  spaceId: string,
  account: Pick<Account, 'id' | 'currency' | 'bankName'>,
  emergency: Pick<Movement, 'amount' | 'amountUsd' | 'currency' | 'exchangeRate'>,
  paymentAmount: number,
): Promise<NormalizedMoney | { error: string }> {
  if (account.currency === emergency.currency) {
    return normalizeMoney(spaceId, {
      accountId: account.id,
      amount: paymentAmount,
      amountInputMode: 'inputCurrency',
      currency: account.currency,
      exchangeRate: account.currency === 'USD' ? emergency.exchangeRate : null,
    })
  }

  const rate = emergency.currency === 'USD' && emergency.exchangeRate
    ? emergency.exchangeRate
    : await getUsdToClpRate()

  if (account.currency === 'CLP') {
    return normalizeMoney(spaceId, {
      accountId: account.id,
      amount: Math.round(paymentAmount * rate / 100),
      amountInputMode: 'inputCurrency',
      currency: 'CLP',
    })
  }

  return normalizeMoney(spaceId, {
    accountId: account.id,
    amount: Math.round(paymentAmount * 100 / rate),
    amountInputMode: 'inputCurrency',
    currency: 'USD',
    exchangeRate: rate,
  })
}

async function deleteReceivableSettlementRecord(spaceId: string, actorUserId: string, settlementId: string): Promise<LedgerResult> {
  const [settlement] = await db
    .select()
    .from(receivableSettlements)
    .where(eq(receivableSettlements.id, settlementId))
    .limit(1)

  if (!settlement || (settlement.fundedSpaceId !== spaceId && settlement.payingSpaceId !== spaceId)) {
    return fail('Receivable settlement not found')
  }

  const [fundedSpace, payingSpace] = await Promise.all([
    getMemberSpace(actorUserId, settlement.fundedSpaceId),
    getMemberSpace(actorUserId, settlement.payingSpaceId),
  ])
  if (!fundedSpace || !payingSpace) return fail('Necesitas acceso a ambos Spaces para eliminar este cobro')

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wallit:receivable-settlement:${settlement.id}`}, 0))`)
    if (settlement.consumedTransferId) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wallit:transfer-consumption:${settlement.consumedTransferId}`}, 0))`)
    }

    const [lockedSettlement] = await tx
      .select()
      .from(receivableSettlements)
      .where(eq(receivableSettlements.id, settlement.id))
      .limit(1)
    if (!lockedSettlement) return fail('Receivable settlement not found')

    if (lockedSettlement.consumedTransferId) {
      const consumedTransferFields = [
        lockedSettlement.consumedTransferSourceSpaceId,
        lockedSettlement.consumedTransferDestinationSpaceId,
        lockedSettlement.consumedTransferSourceAccountId,
        lockedSettlement.consumedTransferDestinationAccountId,
        lockedSettlement.consumedTransferSourceName,
        lockedSettlement.consumedTransferDestinationName,
        lockedSettlement.consumedTransferDate,
        lockedSettlement.consumedSourceAmount,
        lockedSettlement.consumedSourceCurrency,
        lockedSettlement.consumedDestinationAmount,
        lockedSettlement.consumedDestinationCurrency,
      ]
      if (consumedTransferFields.some((value) => value == null)) {
        return fail('Receivable settlement is missing transfer restoration data')
      }

      const [existingTransfer] = await tx
        .select()
        .from(transfers)
        .where(eq(transfers.id, lockedSettlement.consumedTransferId))
        .limit(1)

      if (existingTransfer) {
        const [sourceMovement, destinationMovement] = await Promise.all([
          tx.select().from(movements).where(eq(movements.id, existingTransfer.sourceMovementId)).limit(1),
          tx.select().from(movements).where(eq(movements.id, existingTransfer.destinationMovementId)).limit(1),
        ])
        const source = sourceMovement[0]
        const destination = destinationMovement[0]
        if (!source || !destination) return fail('Transferencia consumida corrupta')

        await tx.update(movements).set({
          amount: source.amount + lockedSettlement.consumedSourceAmount!,
          amountUsd: addNullableAmount(source.amountUsd, lockedSettlement.consumedSourceAmountUsd),
          updatedAt: new Date(),
        }).where(eq(movements.id, source.id))
        await tx.update(movements).set({
          amount: destination.amount + lockedSettlement.consumedDestinationAmount!,
          amountUsd: addNullableAmount(destination.amountUsd, lockedSettlement.consumedDestinationAmountUsd),
          updatedAt: new Date(),
        }).where(eq(movements.id, destination.id))
      } else {
        const sourceMovementId = generateId()
        const destinationMovementId = generateId()
        const now = new Date()
        await tx.insert(movements).values([
          {
            id: sourceMovementId,
            spaceId: lockedSettlement.consumedTransferSourceSpaceId!,
            createdByUserId: lockedSettlement.createdByUserId ?? actorUserId,
            accountId: lockedSettlement.consumedTransferSourceAccountId!,
            categoryId: null,
            name: lockedSettlement.consumedTransferSourceName!,
            date: lockedSettlement.consumedTransferDate!,
            amount: lockedSettlement.consumedSourceAmount!,
            type: 'expense',
            currency: lockedSettlement.consumedSourceCurrency!,
            amountUsd: lockedSettlement.consumedSourceAmountUsd,
            exchangeRate: lockedSettlement.consumedSourceExchangeRate,
            time: lockedSettlement.consumedTransferSourceTime,
            needsReview: false,
            receivable: false,
            received: false,
            receivableId: null,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: destinationMovementId,
            spaceId: lockedSettlement.consumedTransferDestinationSpaceId!,
            createdByUserId: lockedSettlement.createdByUserId ?? actorUserId,
            accountId: lockedSettlement.consumedTransferDestinationAccountId!,
            categoryId: null,
            name: lockedSettlement.consumedTransferDestinationName!,
            date: lockedSettlement.consumedTransferDate!,
            amount: lockedSettlement.consumedDestinationAmount!,
            type: 'income',
            currency: lockedSettlement.consumedDestinationCurrency!,
            amountUsd: lockedSettlement.consumedDestinationAmountUsd,
            exchangeRate: lockedSettlement.consumedDestinationExchangeRate,
            time: lockedSettlement.consumedTransferDestinationTime,
            needsReview: false,
            receivable: false,
            received: false,
            receivableId: null,
            createdAt: now,
            updatedAt: now,
          },
        ])
        await tx.insert(transfers).values({
          id: lockedSettlement.consumedTransferId,
          sourceSpaceId: lockedSettlement.consumedTransferSourceSpaceId!,
          destinationSpaceId: lockedSettlement.consumedTransferDestinationSpaceId!,
          sourceMovementId,
          destinationMovementId,
          createdByUserId: lockedSettlement.createdByUserId ?? actorUserId,
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    await tx.delete(receivableSettlements).where(eq(receivableSettlements.id, lockedSettlement.id))
    await tx.delete(movements).where(or(
      eq(movements.id, lockedSettlement.outgoingMovementId),
      eq(movements.id, lockedSettlement.incomingMovementId),
    ))
    await tx.update(movements).set({ received: false, updatedAt: new Date() })
      .where(and(eq(movements.id, lockedSettlement.receivableId), eq(movements.spaceId, lockedSettlement.fundedSpaceId)))

    return ok({ settlementId: lockedSettlement.id })
  })
}

async function consumeIncomingTransferForReceivableSettlement(
  spaceId: string,
  actorUserId: string,
  receivableId: string,
  destinationMovementId: string,
  transfer: Transfer,
): Promise<LedgerResult> {
  if (transfer.destinationMovementId !== destinationMovementId || transfer.destinationSpaceId !== spaceId || transfer.sourceSpaceId === transfer.destinationSpaceId) {
    return fail('Selected movement is not an incoming transfer from another Space')
  }
  if (await transferIsEmergencySettlement(transfer.id)) return fail('Esta transferencia está vinculada a otro workflow')

  const [sourceSpace, destinationSpace] = await Promise.all([
    getMemberSpace(actorUserId, transfer.sourceSpaceId),
    getMemberSpace(actorUserId, transfer.destinationSpaceId),
  ])
  if (!sourceSpace || !destinationSpace) return fail('Necesitas acceso a ambos Spaces para usar esta transferencia')

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wallit:receivable-settlement:${spaceId}:${receivableId}`}, 0))`)
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wallit:transfer-consumption:${transfer.id}`}, 0))`)

    const [lockedReceivable] = await tx
      .select()
      .from(movements)
      .where(and(eq(movements.id, receivableId), eq(movements.spaceId, spaceId)))
      .limit(1)
    if (!lockedReceivable) return fail('Receivable not found')
    if (!lockedReceivable.receivable) return fail('Movement is not receivable')
    if (lockedReceivable.received) return fail('Receivable already received')

    const [existingSettlement] = await tx
      .select({ id: receivableSettlements.id })
      .from(receivableSettlements)
      .where(eq(receivableSettlements.receivableId, receivableId))
      .limit(1)
    if (existingSettlement) return fail('Receivable already has a settlement')

    const [lockedTransfer] = await tx
      .select()
      .from(transfers)
      .where(eq(transfers.id, transfer.id))
      .limit(1)
    if (!lockedTransfer || lockedTransfer.destinationMovementId !== destinationMovementId || lockedTransfer.destinationSpaceId !== spaceId || lockedTransfer.sourceSpaceId === lockedTransfer.destinationSpaceId) {
      return fail('Selected movement is not an incoming transfer from another Space')
    }

    const [sourceRows, destinationRows] = await Promise.all([
      tx.select().from(movements).where(and(eq(movements.id, lockedTransfer.sourceMovementId), eq(movements.spaceId, lockedTransfer.sourceSpaceId))).limit(1),
      tx.select().from(movements).where(and(eq(movements.id, lockedTransfer.destinationMovementId), eq(movements.spaceId, lockedTransfer.destinationSpaceId))).limit(1),
    ])
    const sourceMovement = sourceRows[0]
    const destinationMovement = destinationRows[0]
    if (!sourceMovement || !destinationMovement || sourceMovement.type !== 'expense' || destinationMovement.type !== 'income') return fail('Transferencia corrupta')
    if (!sourceMovement.accountId || !destinationMovement.accountId) return fail('Transferencia corrupta')
    if (sourceMovement.needsReview || destinationMovement.needsReview) return fail('La transferencia debe estar revisada antes de usarla para cobrar')
    if (hasDependentWorkflow(sourceMovement) || hasDependentWorkflow(destinationMovement) || sourceMovement.receivable || destinationMovement.receivable || sourceMovement.emergency || destinationMovement.emergency || sourceMovement.loan || destinationMovement.loan) {
      return fail('La transferencia seleccionada ya pertenece a otro workflow')
    }
    if ((sourceMovement.currency === 'USD' && sourceMovement.amountUsd == null) || (destinationMovement.currency === 'USD' && destinationMovement.amountUsd == null)) {
      return fail('La transferencia seleccionada no tiene datos completos de moneda')
    }

    const bounds = settlementBounds(lockedReceivable.amount)
    if (destinationMovement.amount < bounds.min) {
      return fail(settlementAmountError('Monto insuficiente para saldar el por cobrar', destinationMovement.amount, lockedReceivable.amount))
    }

    const consumesWholeTransfer = destinationMovement.amount <= bounds.max
    const consumedDestinationAmount = consumesWholeTransfer ? destinationMovement.amount : lockedReceivable.amount
    const ratio = consumedDestinationAmount / destinationMovement.amount
    const consumedDestinationAmountUsd = proportionalNullableAmount(destinationMovement.amountUsd, ratio)
    const consumedSourceAmount = proportionalAmount(sourceMovement.amount, ratio)
    const consumedSourceAmountUsd = proportionalNullableAmount(sourceMovement.amountUsd, ratio)
    const remainingSourceAmount = sourceMovement.amount - consumedSourceAmount
    const remainingDestinationAmount = destinationMovement.amount - consumedDestinationAmount
    const remainingSourceAmountUsd = subtractNullableAmount(sourceMovement.amountUsd, consumedSourceAmountUsd)
    const remainingDestinationAmountUsd = subtractNullableAmount(destinationMovement.amountUsd, consumedDestinationAmountUsd)
    const fullyConsumed = consumesWholeTransfer ||
      remainingSourceAmount <= 0 ||
      remainingDestinationAmount <= 0 ||
      (sourceMovement.currency === 'USD' && (!remainingSourceAmountUsd || remainingSourceAmountUsd <= 0)) ||
      (destinationMovement.currency === 'USD' && (!remainingDestinationAmountUsd || remainingDestinationAmountUsd <= 0))

    const now = new Date()
    const settlementId = generateId()
    const outgoingMovementId = generateId()
    const incomingMovementId = generateId()

    await tx.insert(movements).values([
      {
        id: outgoingMovementId,
        spaceId: lockedTransfer.sourceSpaceId,
        createdByUserId: actorUserId,
        accountId: sourceMovement.accountId,
        categoryId: null,
        name: lockedReceivable.name,
        date: sourceMovement.date,
        amount: consumedSourceAmount,
        type: 'expense',
        currency: sourceMovement.currency,
        amountUsd: consumedSourceAmountUsd,
        exchangeRate: sourceMovement.exchangeRate,
        time: sourceMovement.time,
        needsReview: true,
        receivable: false,
        received: false,
        receivableId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: incomingMovementId,
        spaceId,
        createdByUserId: actorUserId,
        accountId: destinationMovement.accountId,
        categoryId: null,
        name: `Cobro: ${lockedReceivable.name}`,
        date: destinationMovement.date,
        amount: consumedDestinationAmount,
        type: 'income',
        currency: destinationMovement.currency,
        amountUsd: consumedDestinationAmountUsd,
        exchangeRate: destinationMovement.exchangeRate,
        time: destinationMovement.time,
        needsReview: false,
        receivable: false,
        received: false,
        receivableId,
        createdAt: now,
        updatedAt: now,
      },
    ])

    if (fullyConsumed) {
      await tx.delete(transfers).where(eq(transfers.id, lockedTransfer.id))
      await tx.delete(movements).where(or(eq(movements.id, sourceMovement.id), eq(movements.id, destinationMovement.id)))
    } else {
      await tx.update(movements).set({
        amount: remainingSourceAmount,
        amountUsd: remainingSourceAmountUsd,
        updatedAt: now,
      }).where(and(eq(movements.id, sourceMovement.id), eq(movements.spaceId, lockedTransfer.sourceSpaceId)))
      await tx.update(movements).set({
        amount: remainingDestinationAmount,
        amountUsd: remainingDestinationAmountUsd,
        updatedAt: now,
      }).where(and(eq(movements.id, destinationMovement.id), eq(movements.spaceId, lockedTransfer.destinationSpaceId)))
      await tx.update(transfers).set({ updatedAt: now }).where(eq(transfers.id, lockedTransfer.id))
    }

    await tx.update(movements).set({ received: true, updatedAt: now })
      .where(and(eq(movements.id, receivableId), eq(movements.spaceId, spaceId)))
    await tx.insert(receivableSettlements).values({
      id: settlementId,
      fundedSpaceId: spaceId,
      payingSpaceId: lockedTransfer.sourceSpaceId,
      receivableId,
      outgoingMovementId,
      incomingMovementId,
      consumedTransferId: lockedTransfer.id,
      consumedTransferSourceSpaceId: lockedTransfer.sourceSpaceId,
      consumedTransferDestinationSpaceId: lockedTransfer.destinationSpaceId,
      consumedTransferSourceAccountId: sourceMovement.accountId,
      consumedTransferDestinationAccountId: destinationMovement.accountId,
      consumedTransferSourceName: sourceMovement.name,
      consumedTransferDestinationName: destinationMovement.name,
      consumedTransferDate: destinationMovement.date,
      consumedTransferSourceTime: sourceMovement.time,
      consumedTransferDestinationTime: destinationMovement.time,
      consumedSourceAmount,
      consumedSourceCurrency: sourceMovement.currency,
      consumedSourceAmountUsd,
      consumedSourceExchangeRate: sourceMovement.exchangeRate,
      consumedDestinationAmount,
      consumedDestinationCurrency: destinationMovement.currency,
      consumedDestinationAmountUsd,
      consumedDestinationExchangeRate: destinationMovement.exchangeRate,
      createdByUserId: actorUserId,
      createdAt: now,
      updatedAt: now,
    })

    return ok({ settlementId })
  })
}

export const movementLedger = {
  async recordReportableMovement(spaceId: string, actorUserId: string, input: ReportableInput): Promise<LedgerResult> {
    if (!input.name.trim()) return fail('Name is required')
    const normalized = await normalizeMoney(spaceId, input)
    if ('error' in normalized) return fail(normalized.error)
    if (!(await ensureOwnedCategory(spaceId, input.categoryId))) return fail('Invalid category')
    if (input.emergency && input.type !== 'expense') return fail('Only expenses can be emergency movements')
    if (input.loan && input.type !== 'income') return fail('Only income movements can be loans')
    if (input.emergency && input.loan) return fail('A movement cannot be both emergency and loan')

    await db.insert(movements).values({
      id: generateId(),
      spaceId: spaceId,
      createdByUserId: actorUserId,
      categoryId: input.categoryId || null,
      accountId: normalized.account.id,
      name: input.name.trim(),
      date: input.date,
      amount: normalized.amount,
      type: input.type,
      currency: input.currency,
      amountUsd: normalized.amountUsd,
      exchangeRate: normalized.exchangeRate,
      time: input.time ?? null,
      originalName: input.originalName ?? null,
      ...reportableResetFields(),
      emergency: input.type === 'expense' ? Boolean(input.emergency) : false,
      loan: input.type === 'income' ? Boolean(input.loan) : false,
    })

    return ok()
  },

  async confirmPendingAsReportable(spaceId: string, movementId: string, input: ReportableInput): Promise<LedgerResult> {
    const original = await getOwnedMovement(spaceId, movementId)
    if (!original) return fail('Movement not found')
    if (!original.needsReview) return fail('Movement is not pending review')
    if (hasDependentWorkflow(original) || await movementIsTransfer(original.id)) return fail('Pending movement has dependent relationships')
    const settlementLink = await getReceivableSettlementMovementLink(original.id)
    if (settlementLink) {
      if (settlementLink.role !== 'outgoing') return fail('Receivable settlement operational movements cannot be reviewed here')
      if (!validatesSettlementOutgoingSafeFields(original, input)) return fail(settlementSafeClassificationError())
      if (!input.name.trim()) return fail('Name is required')
      if (!(await ensureOwnedCategory(spaceId, input.categoryId))) return fail('Invalid category')

      await db.update(movements).set({
        name: input.name.trim(),
        categoryId: input.categoryId || null,
        type: 'expense',
        needsReview: false,
        emergency: false,
        emergencySettled: false,
        loan: false,
        loanSettled: false,
        updatedAt: new Date(),
      }).where(and(eq(movements.id, movementId), eq(movements.spaceId, spaceId)))

      return ok()
    }
    if (!input.name.trim()) return fail('Name is required')
    if (input.emergency && input.type !== 'expense') return fail('Only expenses can be emergency movements')
    if (input.loan && input.type !== 'income') return fail('Only income movements can be loans')
    if (input.emergency && input.loan) return fail('A movement cannot be both emergency and loan')

    const normalized = await normalizeMoney(spaceId, input)
    if ('error' in normalized) return fail(normalized.error)
    if (!(await ensureOwnedCategory(spaceId, input.categoryId))) return fail('Invalid category')

    await db.update(movements).set({
      name: input.name.trim(),
      date: input.date,
      amount: normalized.amount,
      type: input.type,
      currency: input.currency,
      accountId: normalized.account.id,
      categoryId: input.categoryId || null,
      amountUsd: normalized.amountUsd,
      exchangeRate: normalized.exchangeRate,
      time: input.time ?? null,
      ...reportableResetFields(),
      emergency: input.type === 'expense' ? Boolean(input.emergency) : false,
      loan: input.type === 'income' ? Boolean(input.loan) : false,
      updatedAt: new Date(),
    }).where(and(eq(movements.id, movementId), eq(movements.spaceId, spaceId)))

    return ok()
  },

  async reclassifyReportableMovement(spaceId: string, movementId: string, input: ReportableInput): Promise<LedgerResult> {
    const original = await getOwnedMovement(spaceId, movementId)
    if (!original) return fail('Movement not found')
    if (original.needsReview) return fail('Confirm pending movements before reclassifying them')
    if (await movementIsTransfer(original.id)) return fail('Transfers must be edited through transfer operations')
    const settlementMovement = await movementIsReceivableSettlement(original.id)
    if (settlementMovement) {
      const settlementLink = await getReceivableSettlementMovementLink(original.id)
      if (!settlementLink) return fail('Receivable settlement link not found')
      if (settlementLink.role === 'incoming') {
        if (!validatesSettlementIncomingSafeFields(original, input)) return fail(settlementIncomingAccountCorrectionError())
        const account = await getOwnedAccount(spaceId, input.accountId)
        if (!account) return fail('Cuenta destino no válida')
        if (account.currency !== original.currency) return fail('La cuenta destino debe usar la misma moneda del settlement')

        await db.update(movements).set({
          accountId: account.id,
          type: 'income',
          needsReview: false,
          emergency: false,
          emergencySettled: false,
          loan: false,
          loanSettled: false,
          updatedAt: new Date(),
        }).where(and(eq(movements.id, movementId), eq(movements.spaceId, spaceId)))

        return ok()
      }
      if (settlementLink.role !== 'outgoing') return fail('Receivable settlement operational movements cannot be edited through reportable movement edits')
      if (!validatesSettlementOutgoingSafeFields(original, input)) return fail(settlementSafeClassificationError())
      if (!input.name.trim()) return fail('Name is required')
      if (!(await ensureOwnedCategory(spaceId, input.categoryId))) return fail('Invalid category')

      await db.update(movements).set({
        name: input.name.trim(),
        categoryId: input.categoryId || null,
        type: 'expense',
        needsReview: false,
        emergency: false,
        emergencySettled: false,
        loan: false,
        loanSettled: false,
        updatedAt: new Date(),
      }).where(and(eq(movements.id, movementId), eq(movements.spaceId, spaceId)))

      return ok()
    }
    if (original.receivableId || original.loanId) return fail('This movement is linked to another workflow')
    if (!input.name.trim()) return fail('Name is required')
    if (input.emergency && input.type !== 'expense') return fail('Only expenses can be emergency movements')
    if (input.loan && input.type !== 'income') return fail('Only income movements can be loans')
    if (input.emergency && input.loan) return fail('A movement cannot be both emergency and loan')

    if (original.receivable && input.type !== 'expense') {
      return fail('Receivables must remain expenses until unmarked')
    }
    if (original.receivable && (input.emergency || input.loan)) {
      return fail('Receivables must be unmarked before starting another workflow')
    }
    if (original.emergency && (!input.emergency || input.type !== 'expense') && await hasEmergencyPaymentRows(spaceId, movementId)) {
      return fail('No se puede desmarcar: ya existen abonos para este gasto de emergencia')
    }
    if (original.loan && (!input.loan || input.type !== 'income') && await hasLoanPaybackRows(spaceId, movementId)) {
      return fail('No se puede desmarcar: ya existen devoluciones vinculadas a este préstamo')
    }

    const normalized = await normalizeMoney(spaceId, input)
    if ('error' in normalized) return fail(normalized.error)
    if (!(await ensureOwnedCategory(spaceId, input.categoryId))) return fail('Invalid category')

    await db.update(movements).set({
      name: input.name.trim(),
      date: input.date,
      amount: normalized.amount,
      type: input.type,
      currency: input.currency,
      accountId: normalized.account.id,
      categoryId: input.categoryId || null,
      amountUsd: normalized.amountUsd,
      exchangeRate: normalized.exchangeRate,
      time: input.time ?? null,
      needsReview: false,
      emergency: input.type === 'expense' ? Boolean(input.emergency) : false,
      emergencySettled: input.type === 'expense' && input.emergency ? original.emergencySettled : false,
      loan: input.type === 'income' ? Boolean(input.loan) : false,
      loanSettled: input.type === 'income' && input.loan ? original.loanSettled : false,
      updatedAt: new Date(),
    }).where(and(eq(movements.id, movementId), eq(movements.spaceId, spaceId)))

    return ok()
  },

  async markAsEmergency(spaceId: string, movementId: string): Promise<LedgerResult> {
    const movement = await getOwnedMovement(spaceId, movementId)
    if (!movement) return fail('Movement not found')
    if (movement.type !== 'expense') return fail('Only expenses can be marked as emergency')
    if ((await movementIsTransfer(movement.id)) || await movementIsReceivableSettlement(movement.id) || (isOperational(movement) && !movement.emergency)) return fail('Movement is already part of another workflow')
    await db.update(movements).set({ emergency: true, needsReview: false, updatedAt: new Date() }).where(and(eq(movements.id, movementId), eq(movements.spaceId, spaceId)))
    return ok()
  },

  async unmarkEmergency(spaceId: string, movementId: string): Promise<LedgerResult> {
    const movement = await getOwnedMovement(spaceId, movementId)
    if (!movement || !movement.emergency) return fail('Gasto de emergencia no encontrado')
    if (await hasEmergencyPaymentRows(spaceId, movementId)) return fail('No se puede desmarcar: ya existen abonos para este gasto de emergencia')
    const [updated] = await db.update(movements)
      .set({ emergency: false, emergencySettled: false, updatedAt: new Date() })
      .where(and(eq(movements.id, movementId), eq(movements.spaceId, spaceId)))
      .returning({ id: movements.id })
    if (!updated) return fail('Gasto de emergencia no encontrado')
    return ok()
  },

  async markAsLoan(spaceId: string, movementId: string): Promise<LedgerResult> {
    const movement = await getOwnedMovement(spaceId, movementId)
    if (!movement) return fail('Movement not found')
    if (movement.type !== 'income') return fail('Only income movements can be marked as loan')
    if ((await movementIsTransfer(movement.id)) || await movementIsReceivableSettlement(movement.id) || (isOperational(movement) && !movement.loan)) return fail('Movement is already part of another workflow')
    await db.update(movements).set({ loan: true, needsReview: false, updatedAt: new Date() }).where(and(eq(movements.id, movementId), eq(movements.spaceId, spaceId)))
    return ok()
  },

  async unmarkLoan(spaceId: string, movementId: string): Promise<LedgerResult> {
    const movement = await getOwnedMovement(spaceId, movementId)
    if (!movement || !movement.loan) return fail('Préstamo no encontrado')
    if (await hasLoanPaybackRows(spaceId, movementId)) return fail('No se puede desmarcar: ya existen devoluciones vinculadas a este préstamo')
    const [updated] = await db.update(movements)
      .set({ loan: false, loanSettled: false, updatedAt: new Date() })
      .where(and(eq(movements.id, movementId), eq(movements.spaceId, spaceId)))
      .returning({ id: movements.id })
    if (!updated) return fail('Préstamo no encontrado')
    return ok()
  },

  async deleteReportableMovement(spaceId: string, actorUserId: string, movementId: string): Promise<LedgerResult> {
    const movement = await getOwnedMovement(spaceId, movementId)
    if (!movement) return fail('Movement not found')
    const settlement = await getReceivableSettlementByMovementId(movement.id)
    if (settlement) return deleteReceivableSettlementRecord(spaceId, actorUserId, settlement.id)
    if (movement.needsReview) return fail('Pending movements must be deleted through review operations')
    if (await movementIsTransfer(movement.id)) return fail('Transfers must be deleted through transfer operations')
    if (movement.receivable && await hasReceivablePayments(spaceId, movementId)) return fail('Unmark receivable before deleting linked payments')
    if (movement.emergency && await hasEmergencyPaymentRows(spaceId, movementId)) return fail('Cannot delete emergency movement with payments')
    if (movement.loan && await hasLoanPaybackRows(spaceId, movementId)) return fail('Cannot delete loan movement with paybacks')
    if (movement.receivableId || movement.loanId) return fail('This movement is linked to another workflow')

    await db.delete(movements).where(and(eq(movements.id, movementId), eq(movements.spaceId, spaceId)))
    return ok()
  },

  async deletePendingMovement(spaceId: string, actorUserId: string, movementId: string): Promise<LedgerResult> {
    const movement = await getOwnedMovement(spaceId, movementId)
    if (!movement) return fail('Movement not found')
    const settlement = await getReceivableSettlementByMovementId(movement.id)
    if (settlement) return deleteReceivableSettlementRecord(spaceId, actorUserId, settlement.id)
    if (!movement.needsReview) return fail('Movement is not pending review')
    if (hasDependentWorkflow(movement) || await movementIsTransfer(movement.id)) return fail('Pending movement has dependent relationships')
    await db.delete(movements).where(and(eq(movements.id, movementId), eq(movements.spaceId, spaceId)))
    return ok()
  },

  async confirmPendingTransfer(spaceId: string, actorUserId: string, transferId: string): Promise<LedgerResult> {
    const [transfer] = await db.select().from(transfers).where(eq(transfers.id, transferId)).limit(1)
    if (!transfer || (transfer.sourceSpaceId !== spaceId && transfer.destinationSpaceId !== spaceId)) return fail('Transferencia pendiente no encontrada')

    const [sourceSpace, destinationSpace, sourceMovement, destinationMovement] = await Promise.all([
      getMemberSpace(actorUserId, transfer.sourceSpaceId),
      getMemberSpace(actorUserId, transfer.destinationSpaceId),
      getOwnedMovement(transfer.sourceSpaceId, transfer.sourceMovementId),
      getOwnedMovement(transfer.destinationSpaceId, transfer.destinationMovementId),
    ])

    if (!sourceSpace || !destinationSpace) return fail('Necesitas acceso a ambos Spaces para revisar esta transferencia')
    if (!sourceMovement || !destinationMovement || sourceMovement.type !== 'expense' || destinationMovement.type !== 'income') return fail('Transferencia corrupta')
    if (!sourceMovement.accountId || !destinationMovement.accountId) return fail('Selecciona la cuenta destino antes de confirmar esta transferencia')
    if (!sourceMovement.needsReview && !destinationMovement.needsReview) return fail('Transferencia no está pendiente de revisión')
    if ((transfer.sourceSpaceId === spaceId && !sourceMovement.needsReview) || (transfer.destinationSpaceId === spaceId && !destinationMovement.needsReview)) return fail('Transferencia no está pendiente de revisión en este Space')
    if (hasDependentWorkflow(sourceMovement) || hasDependentWorkflow(destinationMovement)) return fail('Pending transfer has dependent relationships')

    await db.transaction(async (tx) => {
      await tx.update(movements).set({ needsReview: false, updatedAt: new Date() })
        .where(or(eq(movements.id, transfer.sourceMovementId), eq(movements.id, transfer.destinationMovementId)))
    })
    return ok({ transferId })
  },

  async deletePendingTransfer(spaceId: string, actorUserId: string, transferId: string): Promise<LedgerResult> {
    const partiallyReviewedError = 'La transferencia ya fue revisada parcialmente y no se puede eliminar desde revisión'
    const [transfer] = await db.select().from(transfers).where(eq(transfers.id, transferId)).limit(1)
    if (!transfer || (transfer.sourceSpaceId !== spaceId && transfer.destinationSpaceId !== spaceId)) return fail('Transferencia pendiente no encontrada')
    if (await transferIsEmergencySettlement(transferId)) return fail('Esta transferencia está vinculada a un abono de emergencia y no se puede eliminar desde revisión')

    const [sourceSpace, destinationSpace, sourceMovement, destinationMovement] = await Promise.all([
      getMemberSpace(actorUserId, transfer.sourceSpaceId),
      getMemberSpace(actorUserId, transfer.destinationSpaceId),
      getOwnedMovement(transfer.sourceSpaceId, transfer.sourceMovementId),
      getOwnedMovement(transfer.destinationSpaceId, transfer.destinationMovementId),
    ])

    if (!sourceSpace || !destinationSpace) return fail('Necesitas acceso a ambos Spaces para eliminar esta transferencia')
    if (!sourceMovement || !destinationMovement || sourceMovement.type !== 'expense' || destinationMovement.type !== 'income') return fail('Transferencia corrupta')
    if (!sourceMovement.needsReview || !destinationMovement.needsReview) return fail(partiallyReviewedError)
    if (hasDependentWorkflow(sourceMovement) || hasDependentWorkflow(destinationMovement)) return fail('Pending transfer has dependent relationships')

    try {
      await db.transaction(async (tx) => {
        await tx.delete(transfers).where(eq(transfers.id, transferId))
        const deletedMovements = await tx
          .delete(movements)
          .where(and(
            or(eq(movements.id, transfer.sourceMovementId), eq(movements.id, transfer.destinationMovementId)),
            eq(movements.needsReview, true),
            isNull(movements.receivableId),
            isNull(movements.loanId),
          ))
          .returning({ id: movements.id })
        if (deletedMovements.length !== 2) throw new Error('PENDING_TRANSFER_DELETE_CONFLICT')
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'PENDING_TRANSFER_DELETE_CONFLICT') return fail(partiallyReviewedError)
      throw error
    }
    return ok()
  },

  async markAsReceivable(spaceId: string, movementId: string, reminderText: string): Promise<LedgerResult> {
    const movement = await getOwnedMovement(spaceId, movementId)
    if (!movement) return fail('Movement not found')
    if (hasDependentWorkflow(movement) || await movementIsTransfer(movement.id) || await movementIsReceivableSettlement(movement.id) || movement.receivable || movement.emergency || movement.loan) return fail('Movement is already part of another workflow')
    if (movement.type !== 'expense') return fail('Only expenses can be marked as receivable')
    if (!reminderText.trim()) return fail('Reminder text is required')

    await db.update(movements).set({
      name: reminderText.trim(),
      receivable: true,
      received: false,
      needsReview: false,
      updatedAt: new Date(),
    }).where(and(eq(movements.id, movementId), eq(movements.spaceId, spaceId)))
    return ok()
  },

  async unmarkReceivable(spaceId: string, actorUserId: string, movementId: string): Promise<LedgerResult> {
    const movement = await getOwnedMovement(spaceId, movementId)
    if (!movement) return fail('Movement not found')
    if (!movement.receivable) return fail('Movement is not receivable')

    const settlement = await getReceivableSettlementByReceivableId(movementId)
    if (settlement) {
      const deleted = await deleteReceivableSettlementRecord(spaceId, actorUserId, settlement.id)
      if (!deleted.success) return deleted
    }

    await db.transaction(async (tx) => {
      await tx.delete(movements).where(and(eq(movements.receivableId, movementId), eq(movements.spaceId, spaceId)))
      await tx.update(movements).set({
        receivable: false,
        received: false,
        updatedAt: new Date(),
      }).where(and(eq(movements.id, movementId), eq(movements.spaceId, spaceId)))
    })
    return ok()
  },

  async settleReceivableWithNewMovement(spaceId: string, actorUserId: string, receivableId: string, paymentAccountId?: string): Promise<LedgerResult> {
    const receivable = await getOwnedMovement(spaceId, receivableId)
    if (!receivable) return fail('Receivable not found')
    if (!receivable.receivable) return fail('Movement is not receivable')
    if (receivable.received) return fail('Receivable already received')

    let paymentAccount: Pick<Account, 'id' | 'currency' | 'bankName'> | null = null
    let paymentMoney: NormalizedMoney | null = null
    if (paymentAccountId) {
      paymentAccount = await getOwnedAccount(spaceId, paymentAccountId)
      if (!paymentAccount) return fail('Invalid account')
      const normalizedPayment = await normalizeMoney(spaceId, {
        accountId: paymentAccount.id,
        amount: receivable.amount,
        amountInputMode: 'canonicalClp',
        currency: receivable.currency,
        amountUsd: receivable.amountUsd,
        exchangeRate: receivable.exchangeRate,
      })
      if ('error' in normalizedPayment) return fail(normalizedPayment.error)
      paymentMoney = normalizedPayment
    }

    await db.transaction(async (tx) => {
      await tx.update(movements).set({ received: true, updatedAt: new Date() }).where(and(eq(movements.id, receivableId), eq(movements.spaceId, spaceId)))
      if (paymentAccount) {
        await tx.insert(movements).values({
          id: generateId(),
          spaceId: spaceId,
          createdByUserId: actorUserId,
          categoryId: receivable.categoryId,
          accountId: paymentAccount.id,
          name: `Cobro: ${receivable.name}`,
          date: new Date().toISOString().slice(0, 10),
          amount: paymentMoney!.amount,
          type: 'income',
          currency: receivable.currency,
          amountUsd: paymentMoney!.amountUsd,
          exchangeRate: paymentMoney!.exchangeRate,
          time: receivable.time,
          receivable: false,
          received: false,
          receivableId,
          needsReview: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
    })

    return ok()
  },

  async settleReceivableWithCrossSpacePayment(spaceId: string, actorUserId: string, receivableId: string, input: CrossSpaceReceivableSettlementInput): Promise<LedgerResult> {
    if (!DATE_RE.test(input.date)) return fail('Invalid payment date')
    if (!Number.isInteger(input.amount) || input.amount <= 0) return fail('Amount must be a positive integer')
    if (input.payingSpaceId === spaceId) return fail('Use same-Space income for payments from the current Space')

    const receivable = await getOwnedMovement(spaceId, receivableId)
    if (!receivable) return fail('Receivable not found')
    if (!receivable.receivable) return fail('Movement is not receivable')
    if (receivable.received) return fail('Receivable already received')
    if (await getReceivableSettlementByReceivableId(receivableId)) return fail('Receivable already has a settlement')

    const [fundedSpace, payingSpace, sourceAccount, destinationAccount] = await Promise.all([
      getMemberSpace(actorUserId, spaceId),
      getMemberSpace(actorUserId, input.payingSpaceId),
      getOwnedAccount(input.payingSpaceId, input.sourceAccountId),
      getOwnedAccount(spaceId, input.destinationAccountId),
    ])
    if (!fundedSpace) return fail('No tienes acceso al Space actual')
    if (!payingSpace) return fail('No tienes acceso al Space pagador')
    if (!sourceAccount) return fail('Cuenta origen no válida')
    if (!destinationAccount) return fail('Cuenta destino no válida')

    const destinationMoney = await normalizeTransferLeg(spaceId, destinationAccount.id, input.amount, destinationAccount.currency)
    if ('error' in destinationMoney) return fail(destinationMoney.error)
    if (!isWithinReceivableSettlementTolerance(destinationMoney.amount, receivable.amount)) {
      return fail(settlementAmountError('Monto fuera de tolerancia para saldar el por cobrar', destinationMoney.amount, receivable.amount))
    }

    const sourceMoney = await normalizeCanonicalForAccount(
      input.payingSpaceId,
      sourceAccount,
      destinationMoney.amount,
      destinationMoney.exchangeRate ?? receivable.exchangeRate,
    )
    if ('error' in sourceMoney) return fail(sourceMoney.error)

    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wallit:receivable-settlement:${spaceId}:${receivableId}`}, 0))`)
      const [lockedReceivable] = await tx
        .select()
        .from(movements)
        .where(and(eq(movements.id, receivableId), eq(movements.spaceId, spaceId)))
        .limit(1)
      if (!lockedReceivable) return fail('Receivable not found')
      if (!lockedReceivable.receivable) return fail('Movement is not receivable')
      if (lockedReceivable.received) return fail('Receivable already received')

      const [existingSettlement] = await tx
        .select({ id: receivableSettlements.id })
        .from(receivableSettlements)
        .where(eq(receivableSettlements.receivableId, receivableId))
        .limit(1)
      if (existingSettlement) return fail('Receivable already has a settlement')

      const now = new Date()
      const settlementId = generateId()
      const outgoingMovementId = generateId()
      const incomingMovementId = generateId()

      await tx.insert(movements).values([
        {
          id: outgoingMovementId,
          spaceId: input.payingSpaceId,
          createdByUserId: actorUserId,
          accountId: sourceAccount.id,
          categoryId: null,
          name: lockedReceivable.name,
          date: input.date,
          amount: sourceMoney.amount,
          type: 'expense',
          currency: sourceAccount.currency,
          amountUsd: sourceMoney.amountUsd,
          exchangeRate: sourceMoney.exchangeRate,
          needsReview: true,
          receivable: false,
          received: false,
          receivableId: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: incomingMovementId,
          spaceId,
          createdByUserId: actorUserId,
          accountId: destinationAccount.id,
          categoryId: null,
          name: `Cobro: ${lockedReceivable.name}`,
          date: input.date,
          amount: destinationMoney.amount,
          type: 'income',
          currency: destinationAccount.currency,
          amountUsd: destinationMoney.amountUsd,
          exchangeRate: destinationMoney.exchangeRate,
          needsReview: false,
          receivable: false,
          received: false,
          receivableId,
          createdAt: now,
          updatedAt: now,
        },
      ])
      await tx.update(movements).set({ received: true, updatedAt: now })
        .where(and(eq(movements.id, receivableId), eq(movements.spaceId, spaceId)))
      await tx.insert(receivableSettlements).values({
        id: settlementId,
        fundedSpaceId: spaceId,
        payingSpaceId: input.payingSpaceId,
        receivableId,
        outgoingMovementId,
        incomingMovementId,
        createdByUserId: actorUserId,
        createdAt: now,
        updatedAt: now,
      })

      return ok({ settlementId })
    })
  },

  async settleReceivableWithExistingMovement(spaceId: string, actorUserId: string, receivableId: string, existingIncomeId: string): Promise<LedgerResult> {
    const receivable = await getOwnedMovement(spaceId, receivableId)
    const income = await getOwnedMovement(spaceId, existingIncomeId)
    if (!receivable) return fail('Receivable not found')
    if (!income) return fail('Income movement not found')
    if (!receivable.receivable) return fail('Movement is not receivable')
    if (receivable.received) return fail('Receivable already received')
    if (income.type !== 'income') return fail('Selected movement is not an income')

    const transfer = await getTransferRootByMovementId(income.id)
    if (transfer) return consumeIncomingTransferForReceivableSettlement(spaceId, actorUserId, receivableId, income.id, transfer)

    if (income.needsReview || hasDependentWorkflow(income) || income.loan || income.receivable) return fail('Selected income is already part of another workflow')
    if (await movementIsReceivableSettlement(income.id)) return fail('Selected income is already part of another workflow')
    // Legacy same-Space income matching intentionally remains a simple receivableId link
    // instead of creating receivable_settlements, but it shares the settlement amount invariant.
    if (!isWithinReceivableSettlementTolerance(income.amount, receivable.amount)) {
      return fail(settlementAmountError('Monto fuera de tolerancia para saldar el por cobrar', income.amount, receivable.amount))
    }

    await db.transaction(async (tx) => {
      await tx.update(movements).set({ received: true, updatedAt: new Date() }).where(and(eq(movements.id, receivableId), eq(movements.spaceId, spaceId)))
      await tx.update(movements).set({ receivableId, updatedAt: new Date() }).where(and(eq(movements.id, existingIncomeId), eq(movements.spaceId, spaceId)))
    })

    return ok()
  },

  async splitMovement(spaceId: string, actorUserId: string, originalId: string, splits: { name: string; amount: number }[]): Promise<LedgerResult> {
    if (!Array.isArray(splits) || splits.length < 2 || splits.length > 20) return fail('Splits must contain between 2 and 20 items')
    for (const split of splits) {
      if (typeof split.name !== 'string' || split.name.trim().length === 0 || split.name.length > 200) return fail('Each split must have a valid name (1-200 chars)')
      if (!Number.isInteger(split.amount) || split.amount <= 0) return fail('Each split amount must be a positive integer')
    }

    const original = await getOwnedMovement(spaceId, originalId)
    if (!original) return fail('Movement not found')
    if (hasDependentWorkflow(original) || await movementIsTransfer(original.id) || await movementIsReceivableSettlement(original.id) || original.receivable || original.emergency || original.loan) return fail('Resolve dependent workflow before splitting this movement')

    const splitTotal = splits.reduce((sum, s) => sum + s.amount, 0)
    if (splitTotal !== original.amount) return fail('Split amounts must equal the original amount')

    let usdSplits: (number | null)[] = []
    if (original.currency === 'USD' && original.amountUsd) {
      let usdAllocated = 0
      for (let i = 0; i < splits.length; i++) {
        if (i === splits.length - 1) {
          usdSplits.push(original.amountUsd - usdAllocated)
        } else {
          const usdAmount = Math.round(original.amountUsd * (splits[i].amount / original.amount))
          usdSplits.push(usdAmount)
          usdAllocated += usdAmount
        }
      }
    } else {
      usdSplits = splits.map(() => null)
    }

    await db.transaction(async (tx) => {
      await tx.delete(movements).where(and(eq(movements.id, originalId), eq(movements.spaceId, spaceId)))
      for (let i = 0; i < splits.length; i++) {
        const split = splits[i]
        await tx.insert(movements).values({
          id: generateId(),
          spaceId: spaceId,
          createdByUserId: actorUserId,
          categoryId: original.categoryId,
          accountId: original.accountId,
          name: split.name.trim(),
          date: original.date,
          amount: split.amount,
          type: original.type,
          currency: original.currency,
          amountUsd: usdSplits[i],
          exchangeRate: original.exchangeRate,
          time: original.time,
          originalName: original.originalName,
          needsReview: true,
          receivable: false,
          received: false,
          createdAt: new Date(Date.now() + 1000),
          updatedAt: new Date(),
        })
      }
    })

    return ok()
  },

  async recordTransfer(spaceId: string, actorUserId: string, input: TransferInput): Promise<LedgerResult> {
    const destinationSpaceId = input.destinationSpaceId || spaceId
    const toAccountId = input.toAccountId || null
    if (input.fromAccountId === toAccountId && destinationSpaceId === spaceId) return fail('Las cuentas origen y destino deben ser diferentes')
    if (input.fromAmount <= 0 || input.toAmount <= 0) return fail('Los montos deben ser mayores a 0')

    const [sourceSpace, actorDestinationSpace, pendingMemberDestination, fromAccount] = await Promise.all([
      getMemberSpace(actorUserId, spaceId),
      getMemberSpace(actorUserId, destinationSpaceId),
      toAccountId ? Promise.resolve(null) : getPendingMemberPersonalDestination(actorUserId, spaceId, destinationSpaceId),
      getAccountInSpace(spaceId, input.fromAccountId),
    ])
    if (!sourceSpace) return fail('No tienes acceso al Space origen')
    if (!fromAccount) return fail('Cuenta origen no válida')

    const isPendingMemberDestination = Boolean(pendingMemberDestination && !actorDestinationSpace && !toAccountId)
    if (sourceSpace.isPersonal && isPendingMemberDestination) return fail('Solo puedes enviar a un miembro desde un Space compartido')
    if (!actorDestinationSpace && !isPendingMemberDestination) return fail('No tienes acceso al Space destino')
    if (isPendingMemberDestination && toAccountId) return fail('La cuenta destino debe quedar pendiente para el receptor')

    const toAccount = isPendingMemberDestination ? null : await getAccountInSpace(destinationSpaceId, toAccountId)
    if (!isPendingMemberDestination && !toAccount) return fail('Cuenta destino no válida')
    if (input.fromCurrency !== fromAccount.currency || (!isPendingMemberDestination && toAccount && input.toCurrency !== toAccount.currency)) {
      return fail('La moneda no coincide con la cuenta')
    }

    const fromMoney = await normalizeTransferLeg(spaceId, input.fromAccountId, input.fromAmount, input.fromCurrency)
    if ('error' in fromMoney) return fail(fromMoney.error)
    const toMoney = isPendingMemberDestination
      ? await normalizePendingTransferLeg(input.toAmount, input.toCurrency)
      : await normalizeTransferLeg(destinationSpaceId, toAccountId!, input.toAmount, input.toCurrency)
    if ('error' in toMoney) return fail(toMoney.error)

    const transferId = generateId()
    const fromMovementId = generateId()
    const toMovementId = generateId()
    const destinationSpaceName = isPendingMemberDestination ? 'Personal del receptor' : actorDestinationSpace!.name
    const names = transferSideNames({
      sourceSpaceName: sourceSpace.name,
      destinationSpaceName,
      sourceAccountName: fromAccount.bankName,
      destinationAccountName: toAccount?.bankName ?? 'Cuenta por confirmar',
      note: input.note,
    })

    await db.transaction(async (tx) => {
      await tx.insert(movements).values([
        {
          id: fromMovementId,
          spaceId,
          createdByUserId: actorUserId,
          accountId: fromAccount.id,
          categoryId: null,
          name: names.sourceName,
          date: input.date,
          amount: fromMoney.amount,
          type: 'expense',
          currency: fromAccount.currency,
          amountUsd: fromMoney.amountUsd,
          exchangeRate: fromMoney.exchangeRate,
          needsReview: false,
        },
        {
          id: toMovementId,
          spaceId: destinationSpaceId,
          createdByUserId: actorUserId,
          accountId: toAccount?.id ?? null,
          categoryId: null,
          name: names.destinationName,
          date: input.date,
          amount: toMoney.amount,
          type: 'income',
          currency: isPendingMemberDestination ? input.toCurrency : toAccount!.currency,
          amountUsd: toMoney.amountUsd,
          exchangeRate: toMoney.exchangeRate,
          needsReview: isPendingMemberDestination,
        },
      ])
      await tx.insert(transfers).values({
        id: transferId,
        sourceSpaceId: spaceId,
        destinationSpaceId,
        sourceMovementId: fromMovementId,
        destinationMovementId: toMovementId,
        createdByUserId: actorUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })

    return ok({ transferId })
  },

  async updateTransfer(spaceId: string, actorUserId: string, transferId: string, input: Omit<TransferInput, 'fromAccountId'> & { fromAccountId?: string }): Promise<LedgerResult> {
    const [transfer] = await db.select().from(transfers).where(eq(transfers.id, transferId)).limit(1)
    if (!transfer || (transfer.sourceSpaceId !== spaceId && transfer.destinationSpaceId !== spaceId)) return fail('Transferencia no encontrada')
    if (await transferIsEmergencySettlement(transferId)) return fail('Esta transferencia está vinculada a un abono de emergencia y no se puede editar desde el flujo normal de transferencias')

    const newDestinationSpaceId = input.destinationSpaceId || transfer.destinationSpaceId
    const [sourceSpace, previousDestinationSpace, destinationSpace, sourceMovement, destinationMovement] = await Promise.all([
      getMemberSpace(actorUserId, transfer.sourceSpaceId),
      getMemberSpace(actorUserId, transfer.destinationSpaceId),
      getMemberSpace(actorUserId, newDestinationSpaceId),
      getOwnedMovement(transfer.sourceSpaceId, transfer.sourceMovementId),
      getOwnedMovement(transfer.destinationSpaceId, transfer.destinationMovementId),
    ])
    if (!sourceSpace || !previousDestinationSpace || !destinationSpace) return fail('Necesitas acceso a ambos Spaces para editar esta transferencia')
    if (!sourceMovement || !destinationMovement || sourceMovement.type !== 'expense' || destinationMovement.type !== 'income') return fail('Transferencia corrupta')

    const sourceAccountId = input.fromAccountId || sourceMovement.accountId
    const destinationAccountId = input.toAccountId
    if (!sourceAccountId || !destinationAccountId) return fail('Transferencia corrupta')
    if (sourceAccountId === destinationAccountId && transfer.sourceSpaceId === newDestinationSpaceId) return fail('Las cuentas origen y destino deben ser diferentes')

    const [fromAccount, toAccount] = await Promise.all([
      getAccountInSpace(transfer.sourceSpaceId, sourceAccountId),
      getAccountInSpace(newDestinationSpaceId, destinationAccountId),
    ])
    if (!fromAccount) return fail('Cuenta origen no válida')
    if (!toAccount) return fail('Cuenta destino no válida')
    if (input.fromCurrency !== fromAccount.currency || input.toCurrency !== toAccount.currency) return fail('La moneda no coincide con la cuenta')

    const fromMoney = await normalizeTransferLeg(transfer.sourceSpaceId, sourceAccountId, input.fromAmount, input.fromCurrency)
    if ('error' in fromMoney) return fail(fromMoney.error)
    const toMoney = await normalizeTransferLeg(newDestinationSpaceId, destinationAccountId, input.toAmount, input.toCurrency)
    if ('error' in toMoney) return fail(toMoney.error)
    const names = transferSideNames({
      sourceSpaceName: sourceSpace.name,
      destinationSpaceName: destinationSpace.name,
      sourceAccountName: fromAccount.bankName,
      destinationAccountName: toAccount.bankName,
      note: input.note,
    })

    await db.transaction(async (tx) => {
      await tx.update(movements).set({
        name: names.sourceName,
        date: input.date,
        accountId: fromAccount.id,
        amount: fromMoney.amount,
        currency: fromAccount.currency,
        amountUsd: fromMoney.amountUsd,
        exchangeRate: fromMoney.exchangeRate,
        categoryId: null,
        needsReview: false,
        updatedAt: new Date(),
      }).where(and(eq(movements.id, sourceMovement.id), eq(movements.spaceId, transfer.sourceSpaceId)))
      await tx.update(movements).set({
        name: names.destinationName,
        date: input.date,
        spaceId: newDestinationSpaceId,
        accountId: toAccount.id,
        amount: toMoney.amount,
        currency: toAccount.currency,
        amountUsd: toMoney.amountUsd,
        exchangeRate: toMoney.exchangeRate,
        categoryId: null,
        needsReview: false,
        updatedAt: new Date(),
      }).where(and(eq(movements.id, destinationMovement.id), eq(movements.spaceId, transfer.destinationSpaceId)))
      await tx.update(transfers).set({
        destinationSpaceId: newDestinationSpaceId,
        updatedAt: new Date(),
      }).where(eq(transfers.id, transferId))
    })

    return ok()
  },

  async deleteTransfer(spaceId: string, actorUserId: string, transferId: string): Promise<LedgerResult> {
    const [transfer] = await db.select().from(transfers).where(eq(transfers.id, transferId)).limit(1)
    if (!transfer || (transfer.sourceSpaceId !== spaceId && transfer.destinationSpaceId !== spaceId)) return fail('Transferencia no encontrada')
    if (await transferIsEmergencySettlement(transferId)) return fail('Esta transferencia está vinculada a un abono de emergencia y no se puede eliminar desde el flujo normal de transferencias')
    const [sourceSpace, destinationSpace] = await Promise.all([
      getMemberSpace(actorUserId, transfer.sourceSpaceId),
      getMemberSpace(actorUserId, transfer.destinationSpaceId),
    ])
    if (!sourceSpace || !destinationSpace) return fail('Necesitas acceso a ambos Spaces para eliminar esta transferencia')

    await db.transaction(async (tx) => {
      await tx.delete(transfers).where(eq(transfers.id, transferId))
      await tx.delete(movements).where(or(eq(movements.id, transfer.sourceMovementId), eq(movements.id, transfer.destinationMovementId)))
    })
    return ok()
  },

  async transformToTransfer(spaceId: string, actorUserId: string, input: TransformToTransferInput): Promise<LedgerResult> {
    const destinationSpaceId = input.destinationSpaceId || spaceId
    const original = await getOwnedMovement(spaceId, input.movementId)
    if (!original) return fail('Movimiento no encontrado')
    if (input.requirePending && !original.needsReview) return fail('Movement is not pending review')
    if (await movementIsTransfer(original.id)) return fail('Este movimiento ya es una transferencia')
    if (await movementIsReceivableSettlement(original.id)) return fail('Receivable settlement movements cannot be transformed to transfer')
    if (hasDependentWorkflow(original) || original.receivable || original.emergency || original.loan) return fail('Resolve dependent workflow before transforming')
    if (input.source.type !== 'expense') return fail('Transfer source must be an expense')
    if (!input.source.accountId) return fail('El movimiento debe tener una cuenta asignada')
    if (input.source.accountId === input.toAccountId && destinationSpaceId === spaceId) return fail('Las cuentas origen y destino deben ser diferentes')
    if (input.toAmount <= 0) return fail('El monto destino debe ser mayor a 0')

    const [sourceSpace, destinationSpace, fromAccount, toAccount] = await Promise.all([
      getMemberSpace(actorUserId, spaceId),
      getMemberSpace(actorUserId, destinationSpaceId),
      getAccountInSpace(spaceId, input.source.accountId),
      getAccountInSpace(destinationSpaceId, input.toAccountId),
    ])
    if (!sourceSpace) return fail('No tienes acceso al Space origen')
    if (!destinationSpace) return fail('No tienes acceso al Space destino')
    if (!fromAccount) return fail('Cuenta origen no válida')
    if (!toAccount) return fail('Cuenta destino no válida')
    if (input.source.currency !== fromAccount.currency || input.toCurrency !== toAccount.currency) {
      return fail('La moneda no coincide con la cuenta')
    }

    const sourceMoney = await normalizeMoney(spaceId, input.source)
    if ('error' in sourceMoney) return fail(sourceMoney.error)
    const toMoney = await normalizeTransferLeg(destinationSpaceId, input.toAccountId, input.toAmount, input.toCurrency)
    if ('error' in toMoney) return fail(toMoney.error)

    const transferId = generateId()
    const pairedMovementId = generateId()
    const names = transferSideNames({
      sourceSpaceName: sourceSpace.name,
      destinationSpaceName: destinationSpace.name,
      sourceAccountName: fromAccount.bankName,
      destinationAccountName: toAccount.bankName,
      note: input.note,
    })

    await db.transaction(async (tx) => {
      await tx.update(movements).set({
        name: names.sourceName,
        date: input.source.date,
        amount: sourceMoney.amount,
        type: 'expense',
        currency: fromAccount.currency,
        accountId: fromAccount.id,
        categoryId: null,
        amountUsd: sourceMoney.amountUsd,
        exchangeRate: sourceMoney.exchangeRate,
        time: input.source.time ?? null,
        needsReview: false,
        receivable: false,
        received: false,
        receivableId: null,
        emergency: false,
        emergencySettled: false,
        loan: false,
        loanSettled: false,
        loanId: null,
        updatedAt: new Date(),
      }).where(and(eq(movements.id, input.movementId), eq(movements.spaceId, spaceId)))
      await tx.insert(movements).values({
        id: pairedMovementId,
        spaceId: destinationSpaceId,
        createdByUserId: actorUserId,
        accountId: toAccount.id,
        categoryId: null,
        name: names.destinationName,
        date: input.source.date,
        amount: toMoney.amount,
        type: 'income',
        currency: toAccount.currency,
        amountUsd: toMoney.amountUsd,
        exchangeRate: toMoney.exchangeRate,
        time: input.source.time ?? null,
        needsReview: false,
      })
      await tx.insert(transfers).values({
        id: transferId,
        sourceSpaceId: spaceId,
        destinationSpaceId,
        sourceMovementId: input.movementId,
        destinationMovementId: pairedMovementId,
        createdByUserId: actorUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })

    return ok({ transferId })
  },

  async confirmPendingAsTransfer(spaceId: string, actorUserId: string, input: TransformToTransferInput): Promise<LedgerResult> {
    return this.transformToTransfer(spaceId, actorUserId, { ...input, requirePending: true })
  },

  async settleEmergencyPartially(spaceId: string, actorUserId: string, emergencyId: string, fromAccountId: string, toAccountId: string, amount: number, date: string): Promise<LedgerResult> {
    if (!Number.isInteger(amount) || amount <= 0) return fail('El monto debe ser mayor a 0')
    const emergency = await getOwnedMovement(spaceId, emergencyId)
    if (!emergency || !emergency.emergency) return fail('Gasto de emergencia no encontrado')
    if (emergency.emergencySettled) return fail('Este gasto de emergencia ya está saldado')
    const [fromAccount, toAccount] = await Promise.all([getOwnedAccount(spaceId, fromAccountId), getOwnedAccount(spaceId, toAccountId)])
    if (!fromAccount) return fail('Cuenta origen no válida')
    if (!toAccount) return fail('Cuenta destino no válida')

    let fromMoney: NormalizedMoney | null = null
    let toMoney: NormalizedMoney | null = null
    if (fromAccountId !== toAccountId) {
      const normalizedFrom = await normalizeEmergencySettlementLeg(spaceId, fromAccount, emergency, amount)
      if ('error' in normalizedFrom) return fail(normalizedFrom.error)
      const normalizedTo = await normalizeEmergencySettlementLeg(spaceId, toAccount, emergency, amount)
      if ('error' in normalizedTo) return fail(normalizedTo.error)
      fromMoney = normalizedFrom
      toMoney = normalizedTo
    }

    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wallit:emergency-settlement:${spaceId}:${emergencyId}`}, 0))`)

      const [lockedEmergency] = await tx
        .select()
        .from(movements)
        .where(and(eq(movements.id, emergencyId), eq(movements.spaceId, spaceId)))
        .limit(1)

      if (!lockedEmergency || !lockedEmergency.emergency) return fail('Gasto de emergencia no encontrado')
      if (lockedEmergency.emergencySettled) return fail('Este gasto de emergencia ya está saldado')

      const emergencyTotal = movementDisplayAmount(lockedEmergency)
      const [existingPaidResult] = await tx
        .select({ total: sql<number>`COALESCE(SUM(amount), 0)` })
        .from(emergencyPayments)
        .where(and(eq(emergencyPayments.emergencyId, emergencyId), eq(emergencyPayments.spaceId, spaceId)))

      const existingPaid = Number(existingPaidResult?.total ?? 0)
      const currentRemaining = emergencyTotal - existingPaid
      if (currentRemaining <= 0) return fail('Este gasto de emergencia ya está saldado')
      if (amount > currentRemaining) return fail('El abono no puede ser mayor al saldo restante')

      let transferId: string | null = null
      if (fromAccountId !== toAccountId) {
        transferId = generateId()
        const fromMovementId = generateId()
        const toMovementId = generateId()
        await tx.insert(movements).values([
          {
            id: fromMovementId,
            spaceId: spaceId,
            createdByUserId: actorUserId,
            accountId: fromAccount.id,
            categoryId: null,
            name: `Abono emergencia: pago`,
            date,
            amount: fromMoney!.amount,
            type: 'expense',
            currency: fromMoney!.account.currency,
            amountUsd: fromMoney!.amountUsd,
            exchangeRate: fromMoney!.exchangeRate,
            needsReview: false,
          },
          {
            id: toMovementId,
            spaceId: spaceId,
            createdByUserId: actorUserId,
            accountId: toAccount.id,
            categoryId: null,
            name: `Abono emergencia: recibido`,
            date,
            amount: toMoney!.amount,
            type: 'income',
            currency: toMoney!.account.currency,
            amountUsd: toMoney!.amountUsd,
            exchangeRate: toMoney!.exchangeRate,
            needsReview: false,
          },
        ])
        await tx.insert(transfers).values({
          id: transferId,
          sourceSpaceId: spaceId,
          destinationSpaceId: spaceId,
          sourceMovementId: fromMovementId,
          destinationMovementId: toMovementId,
          createdByUserId: actorUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
      await tx.insert(emergencyPayments).values({ id: generateId(), spaceId: spaceId, emergencyId, fromAccountId, toAccountId, amount, date, transferId })
      const [totalResult] = await tx
        .select({ total: sql<number>`COALESCE(SUM(amount), 0)` })
        .from(emergencyPayments)
        .where(and(eq(emergencyPayments.emergencyId, emergencyId), eq(emergencyPayments.spaceId, spaceId)))
      const totalPaid = Number(totalResult?.total ?? 0)
      const remaining = emergencyTotal - totalPaid
      const settled = remaining <= 0
      if (settled) {
        await tx.update(movements).set({ emergencySettled: true, updatedAt: new Date() }).where(and(eq(movements.id, emergencyId), eq(movements.spaceId, spaceId)))
      }

      return ok({ remaining: Math.max(0, remaining), settled, totalPaid })
    })
  },

  async settleEmergencyDirectly(spaceId: string, emergencyId: string): Promise<LedgerResult> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wallit:emergency-settlement:${spaceId}:${emergencyId}`}, 0))`)
      const [emergency] = await tx
        .select()
        .from(movements)
        .where(and(eq(movements.id, emergencyId), eq(movements.spaceId, spaceId)))
        .limit(1)
      if (!emergency || !emergency.emergency) return fail('Gasto de emergencia no encontrado')
      if (emergency.emergencySettled) return fail('Este gasto de emergencia ya está saldado')
      const [updated] = await tx.update(movements)
        .set({ emergencySettled: true, updatedAt: new Date() })
        .where(and(eq(movements.id, emergencyId), eq(movements.spaceId, spaceId)))
        .returning({ id: movements.id })
      if (!updated) return fail('Gasto de emergencia no encontrado')
      return ok()
    })
  },

  async settleLoanWithCash(spaceId: string, loanId: string): Promise<LedgerResult> {
    const loan = await getOwnedMovement(spaceId, loanId)
    if (!loan || loan.type !== 'income' || !loan.loan) return fail('Préstamo no encontrado')
    if (loan.loanSettled) return fail('Este préstamo ya está saldado')
    await db.update(movements).set({ loanSettled: true, updatedAt: new Date() }).where(and(eq(movements.id, loanId), eq(movements.spaceId, spaceId)))
    return ok({ remaining: 0, settled: true, totalPaid: movementDisplayAmount(loan) })
  },

  async settleLoanWithExistingMovement(spaceId: string, loanId: string, expenseMovementId: string, _date: string): Promise<LedgerResult> {
    void _date
    const loan = await getOwnedMovement(spaceId, loanId)
    const expense = await getOwnedMovement(spaceId, expenseMovementId)
    if (!loan || loan.type !== 'income' || !loan.loan) return fail('Préstamo no encontrado')
    if (loan.loanSettled) return fail('Este préstamo ya está saldado')
    if (!expense) return fail('Gasto no encontrado')
    if (expense.type !== 'expense') return fail('El movimiento seleccionado no es un gasto')
    if (expense.loanId === loanId) return fail('Este gasto ya está vinculado a este préstamo')
    if (expense.loanId) return fail('Este gasto ya está vinculado a otro préstamo')
    if (expense.needsReview || await movementIsTransfer(expense.id) || expense.receivable || expense.receivableId || expense.emergency || expense.loan) return fail('El gasto seleccionado ya pertenece a otro workflow')
    if (!hasAmountInCurrency(expense, loan.currency as Currency)) return fail('El gasto seleccionado no tiene monto en la moneda del préstamo')

    await db.update(movements).set({ loanId, updatedAt: new Date() }).where(and(eq(movements.id, expenseMovementId), eq(movements.spaceId, spaceId)))

    const paybacks = await db.select({ amount: movements.amount, amountUsd: movements.amountUsd })
      .from(movements)
      .where(and(eq(movements.spaceId, spaceId), eq(movements.type, 'expense'), eq(movements.loanId, loanId)))
    const loanCurrency = loan.currency as Currency
    const loanAmount = movementDisplayAmount(loan)
    const totalPaid = paybacks.reduce((sum, payback) => sum + movementAmountInCurrency(payback, loanCurrency), 0)
    const remaining = Math.max(0, loanAmount - totalPaid)
    const settled = remaining <= 0
    await db.update(movements).set({ loanSettled: settled, updatedAt: new Date() }).where(and(eq(movements.id, loanId), eq(movements.spaceId, spaceId)))
    return ok({ remaining, settled, totalPaid })
  },
}
