import { and, eq, sql } from 'drizzle-orm'
import { accounts, categories, db, emergencyPayments, movements, type Account, type Movement } from '@/lib/db'
import { convertUsdToClp, getUsdToClpRate } from '@/lib/exchange-rate'
import { generateId } from '@/lib/utils'

export type LedgerResult = { success: boolean; error?: string; transferId?: string; remaining?: number; settled?: boolean; totalPaid?: number }
export type Currency = 'CLP' | 'USD'
export type MovementType = 'income' | 'expense'
export type AmountInputMode = 'inputCurrency' | 'canonicalClp'


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
  toAccountId: string
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
  toAmount: number
  toCurrency: Currency
  note?: string
  requirePending?: boolean
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
    movement.transferId ||
    movement.transferPairId ||
    movement.receivableId ||
    movement.loanId
  )
}

function isOperational(movement: Pick<Movement, 'needsReview' | 'transferId' | 'transferPairId' | 'receivable' | 'receivableId' | 'emergency' | 'loan' | 'loanId'>): boolean {
  return Boolean(
    movement.needsReview ||
    movement.transferId ||
    movement.transferPairId ||
    movement.receivable ||
    movement.receivableId ||
    movement.emergency ||
    movement.loan ||
    movement.loanId
  )
}

async function getOwnedAccount(userId: string, accountId: string | null): Promise<Pick<Account, 'id' | 'currency' | 'bankName'> | null> {
  if (!accountId) return null
  const [account] = await db
    .select({ id: accounts.id, currency: accounts.currency, bankName: accounts.bankName })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .limit(1)
  return account ?? null
}

async function ensureOwnedCategory(userId: string, categoryId: string | null): Promise<boolean> {
  if (!categoryId) return true
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1)
  return Boolean(category)
}

async function getOwnedMovement(userId: string, movementId: string): Promise<Movement | null> {
  const [movement] = await db
    .select()
    .from(movements)
    .where(and(eq(movements.id, movementId), eq(movements.userId, userId)))
    .limit(1)
  return movement ?? null
}

async function normalizeMoney(userId: string, input: Pick<MovementInput, 'amount' | 'amountInputMode' | 'currency' | 'accountId' | 'amountUsd' | 'exchangeRate'>): Promise<NormalizedMoney | { error: string }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { error: 'Amount must be a positive integer' }
  }

  const account = await getOwnedAccount(userId, input.accountId)
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

async function normalizeTransferLeg(userId: string, accountId: string, amount: number, currency: Currency): Promise<NormalizedMoney | { error: string }> {
  const account = await getOwnedAccount(userId, accountId)
  if (!account) return { error: 'Invalid account' }
  if (currency !== account.currency) return { error: 'La moneda no coincide con la cuenta' }

  return normalizeMoney(userId, { accountId, amount, amountInputMode: 'inputCurrency', currency })
}

function reportableResetFields() {
  return {
    needsReview: false,
    receivable: false,
    received: false,
    receivableId: null,
    transferId: null,
    transferPairId: null,
    emergency: false,
    emergencySettled: false,
    loan: false,
    loanSettled: false,
    loanId: null,
  }
}

async function hasReceivablePayments(userId: string, receivableId: string): Promise<boolean> {
  const [result] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(movements)
    .where(and(eq(movements.userId, userId), eq(movements.receivableId, receivableId)))
  return Number(result?.count ?? 0) > 0
}

async function hasEmergencyPaymentRows(userId: string, emergencyId: string): Promise<boolean> {
  const [result] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emergencyPayments)
    .innerJoin(movements, eq(emergencyPayments.emergencyId, movements.id))
    .where(and(eq(emergencyPayments.emergencyId, emergencyId), eq(movements.userId, userId)))
  return Number(result?.count ?? 0) > 0
}

async function hasLoanPaybackRows(userId: string, loanId: string): Promise<boolean> {
  const [result] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(movements)
    .where(and(eq(movements.userId, userId), eq(movements.type, 'expense'), eq(movements.loanId, loanId)))
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

async function normalizeEmergencySettlementLeg(
  userId: string,
  account: Pick<Account, 'id' | 'currency' | 'bankName'>,
  emergency: Pick<Movement, 'amount' | 'amountUsd' | 'currency' | 'exchangeRate'>,
  paymentAmount: number,
): Promise<NormalizedMoney | { error: string }> {
  if (account.currency === emergency.currency) {
    return normalizeMoney(userId, {
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
    return normalizeMoney(userId, {
      accountId: account.id,
      amount: Math.round(paymentAmount * rate / 100),
      amountInputMode: 'inputCurrency',
      currency: 'CLP',
    })
  }

  return normalizeMoney(userId, {
    accountId: account.id,
    amount: Math.round(paymentAmount * 100 / rate),
    amountInputMode: 'inputCurrency',
    currency: 'USD',
    exchangeRate: rate,
  })
}

export const movementLedger = {
  async recordReportableMovement(userId: string, input: ReportableInput): Promise<LedgerResult> {
    if (!input.name.trim()) return fail('Name is required')
    const normalized = await normalizeMoney(userId, input)
    if ('error' in normalized) return fail(normalized.error)
    if (!(await ensureOwnedCategory(userId, input.categoryId))) return fail('Invalid category')
    if (input.emergency && input.type !== 'expense') return fail('Only expenses can be emergency movements')
    if (input.loan && input.type !== 'income') return fail('Only income movements can be loans')
    if (input.emergency && input.loan) return fail('A movement cannot be both emergency and loan')

    await db.insert(movements).values({
      id: generateId(),
      userId,
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

  async confirmPendingAsReportable(userId: string, movementId: string, input: ReportableInput): Promise<LedgerResult> {
    const original = await getOwnedMovement(userId, movementId)
    if (!original) return fail('Movement not found')
    if (!original.needsReview) return fail('Movement is not pending review')
    if (hasDependentWorkflow(original)) return fail('Pending movement has dependent relationships')
    if (!input.name.trim()) return fail('Name is required')
    if (input.emergency && input.type !== 'expense') return fail('Only expenses can be emergency movements')
    if (input.loan && input.type !== 'income') return fail('Only income movements can be loans')
    if (input.emergency && input.loan) return fail('A movement cannot be both emergency and loan')

    const normalized = await normalizeMoney(userId, input)
    if ('error' in normalized) return fail(normalized.error)
    if (!(await ensureOwnedCategory(userId, input.categoryId))) return fail('Invalid category')

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
    }).where(and(eq(movements.id, movementId), eq(movements.userId, userId)))

    return ok()
  },

  async reclassifyReportableMovement(userId: string, movementId: string, input: ReportableInput): Promise<LedgerResult> {
    const original = await getOwnedMovement(userId, movementId)
    if (!original) return fail('Movement not found')
    if (original.needsReview) return fail('Confirm pending movements before reclassifying them')
    if (original.transferId || original.transferPairId) return fail('Transfers must be edited through transfer operations')
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
    if (original.emergency && (!input.emergency || input.type !== 'expense') && await hasEmergencyPaymentRows(userId, movementId)) {
      return fail('No se puede desmarcar: ya existen abonos para este gasto de emergencia')
    }
    if (original.loan && (!input.loan || input.type !== 'income') && await hasLoanPaybackRows(userId, movementId)) {
      return fail('No se puede desmarcar: ya existen devoluciones vinculadas a este préstamo')
    }

    const normalized = await normalizeMoney(userId, input)
    if ('error' in normalized) return fail(normalized.error)
    if (!(await ensureOwnedCategory(userId, input.categoryId))) return fail('Invalid category')

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
    }).where(and(eq(movements.id, movementId), eq(movements.userId, userId)))

    return ok()
  },

  async markAsEmergency(userId: string, movementId: string): Promise<LedgerResult> {
    const movement = await getOwnedMovement(userId, movementId)
    if (!movement) return fail('Movement not found')
    if (movement.type !== 'expense') return fail('Only expenses can be marked as emergency')
    if (isOperational(movement) && !movement.emergency) return fail('Movement is already part of another workflow')
    await db.update(movements).set({ emergency: true, needsReview: false, updatedAt: new Date() }).where(and(eq(movements.id, movementId), eq(movements.userId, userId)))
    return ok()
  },

  async unmarkEmergency(userId: string, movementId: string): Promise<LedgerResult> {
    if (await hasEmergencyPaymentRows(userId, movementId)) return fail('No se puede desmarcar: ya existen abonos para este gasto de emergencia')
    await db.update(movements).set({ emergency: false, emergencySettled: false, updatedAt: new Date() }).where(and(eq(movements.id, movementId), eq(movements.userId, userId)))
    return ok()
  },

  async markAsLoan(userId: string, movementId: string): Promise<LedgerResult> {
    const movement = await getOwnedMovement(userId, movementId)
    if (!movement) return fail('Movement not found')
    if (movement.type !== 'income') return fail('Only income movements can be marked as loan')
    if (isOperational(movement) && !movement.loan) return fail('Movement is already part of another workflow')
    await db.update(movements).set({ loan: true, needsReview: false, updatedAt: new Date() }).where(and(eq(movements.id, movementId), eq(movements.userId, userId)))
    return ok()
  },

  async unmarkLoan(userId: string, movementId: string): Promise<LedgerResult> {
    if (await hasLoanPaybackRows(userId, movementId)) return fail('No se puede desmarcar: ya existen devoluciones vinculadas a este préstamo')
    await db.update(movements).set({ loan: false, loanSettled: false, updatedAt: new Date() }).where(and(eq(movements.id, movementId), eq(movements.userId, userId)))
    return ok()
  },

  async deleteReportableMovement(userId: string, movementId: string): Promise<LedgerResult> {
    const movement = await getOwnedMovement(userId, movementId)
    if (!movement) return fail('Movement not found')
    if (movement.needsReview) return fail('Pending movements must be deleted through review operations')
    if (movement.transferId || movement.transferPairId) return fail('Transfers must be deleted through transfer operations')
    if (movement.receivable && await hasReceivablePayments(userId, movementId)) return fail('Unmark receivable before deleting linked payments')
    if (movement.emergency && await hasEmergencyPaymentRows(userId, movementId)) return fail('Cannot delete emergency movement with payments')
    if (movement.loan && await hasLoanPaybackRows(userId, movementId)) return fail('Cannot delete loan movement with paybacks')
    if (movement.receivableId || movement.loanId) return fail('This movement is linked to another workflow')

    await db.delete(movements).where(and(eq(movements.id, movementId), eq(movements.userId, userId)))
    return ok()
  },

  async deletePendingMovement(userId: string, movementId: string): Promise<LedgerResult> {
    const movement = await getOwnedMovement(userId, movementId)
    if (!movement) return fail('Movement not found')
    if (!movement.needsReview) return fail('Movement is not pending review')
    if (hasDependentWorkflow(movement)) return fail('Pending movement has dependent relationships')
    await db.delete(movements).where(and(eq(movements.id, movementId), eq(movements.userId, userId)))
    return ok()
  },

  async markAsReceivable(userId: string, movementId: string, reminderText: string): Promise<LedgerResult> {
    const movement = await getOwnedMovement(userId, movementId)
    if (!movement) return fail('Movement not found')
    if (hasDependentWorkflow(movement) || movement.receivable || movement.emergency || movement.loan) return fail('Movement is already part of another workflow')
    if (movement.type !== 'expense') return fail('Only expenses can be marked as receivable')
    if (!reminderText.trim()) return fail('Reminder text is required')

    await db.update(movements).set({
      name: reminderText.trim(),
      receivable: true,
      received: false,
      needsReview: false,
      updatedAt: new Date(),
    }).where(and(eq(movements.id, movementId), eq(movements.userId, userId)))
    return ok()
  },

  async unmarkReceivable(userId: string, movementId: string): Promise<LedgerResult> {
    const movement = await getOwnedMovement(userId, movementId)
    if (!movement) return fail('Movement not found')
    if (!movement.receivable) return fail('Movement is not receivable')

    await db.transaction(async (tx) => {
      await tx.delete(movements).where(and(eq(movements.receivableId, movementId), eq(movements.userId, userId)))
      await tx.update(movements).set({
        receivable: false,
        received: false,
        updatedAt: new Date(),
      }).where(and(eq(movements.id, movementId), eq(movements.userId, userId)))
    })
    return ok()
  },

  async settleReceivableWithNewMovement(userId: string, receivableId: string, paymentAccountId?: string): Promise<LedgerResult> {
    const receivable = await getOwnedMovement(userId, receivableId)
    if (!receivable) return fail('Receivable not found')
    if (!receivable.receivable) return fail('Movement is not receivable')
    if (receivable.received) return fail('Receivable already received')

    let paymentAccount: Pick<Account, 'id' | 'currency' | 'bankName'> | null = null
    let paymentMoney: NormalizedMoney | null = null
    if (paymentAccountId) {
      paymentAccount = await getOwnedAccount(userId, paymentAccountId)
      if (!paymentAccount) return fail('Invalid account')
      const normalizedPayment = await normalizeMoney(userId, {
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
      await tx.update(movements).set({ received: true, updatedAt: new Date() }).where(and(eq(movements.id, receivableId), eq(movements.userId, userId)))
      if (paymentAccount) {
        await tx.insert(movements).values({
          id: generateId(),
          userId,
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

  async settleReceivableWithExistingMovement(userId: string, receivableId: string, existingIncomeId: string): Promise<LedgerResult> {
    const receivable = await getOwnedMovement(userId, receivableId)
    const income = await getOwnedMovement(userId, existingIncomeId)
    if (!receivable) return fail('Receivable not found')
    if (!income) return fail('Income movement not found')
    if (!receivable.receivable) return fail('Movement is not receivable')
    if (receivable.received) return fail('Receivable already received')
    if (income.type !== 'income') return fail('Selected movement is not an income')
    if (income.needsReview || hasDependentWorkflow(income) || income.loan || income.receivable) return fail('Selected income is already part of another workflow')

    await db.transaction(async (tx) => {
      await tx.update(movements).set({ received: true, updatedAt: new Date() }).where(and(eq(movements.id, receivableId), eq(movements.userId, userId)))
      await tx.update(movements).set({ receivableId, updatedAt: new Date() }).where(and(eq(movements.id, existingIncomeId), eq(movements.userId, userId)))
    })

    return ok()
  },

  async splitMovement(userId: string, originalId: string, splits: { name: string; amount: number }[]): Promise<LedgerResult> {
    if (!Array.isArray(splits) || splits.length < 2 || splits.length > 20) return fail('Splits must contain between 2 and 20 items')
    for (const split of splits) {
      if (typeof split.name !== 'string' || split.name.trim().length === 0 || split.name.length > 200) return fail('Each split must have a valid name (1-200 chars)')
      if (!Number.isInteger(split.amount) || split.amount <= 0) return fail('Each split amount must be a positive integer')
    }

    const original = await getOwnedMovement(userId, originalId)
    if (!original) return fail('Movement not found')
    if (hasDependentWorkflow(original) || original.receivable || original.emergency || original.loan) return fail('Resolve dependent workflow before splitting this movement')

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
      await tx.delete(movements).where(and(eq(movements.id, originalId), eq(movements.userId, userId)))
      for (let i = 0; i < splits.length; i++) {
        const split = splits[i]
        await tx.insert(movements).values({
          id: generateId(),
          userId,
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

  async recordTransfer(userId: string, input: TransferInput): Promise<LedgerResult> {
    if (input.fromAccountId === input.toAccountId) return fail('Las cuentas origen y destino deben ser diferentes')
    if (input.fromAmount <= 0 || input.toAmount <= 0) return fail('Los montos deben ser mayores a 0')

    const [fromAccount, toAccount] = await Promise.all([
      getOwnedAccount(userId, input.fromAccountId),
      getOwnedAccount(userId, input.toAccountId),
    ])
    if (!fromAccount) return fail('Cuenta origen no válida')
    if (!toAccount) return fail('Cuenta destino no válida')
    if (input.fromCurrency !== fromAccount.currency || input.toCurrency !== toAccount.currency) {
      return fail('La moneda no coincide con la cuenta')
    }

    const fromMoney = await normalizeTransferLeg(userId, input.fromAccountId, input.fromAmount, input.fromCurrency)
    if ('error' in fromMoney) return fail(fromMoney.error)
    const toMoney = await normalizeTransferLeg(userId, input.toAccountId, input.toAmount, input.toCurrency)
    if ('error' in toMoney) return fail(toMoney.error)

    const transferId = generateId()
    const fromMovementId = generateId()
    const toMovementId = generateId()
    const transferName = input.note?.trim() || `Transferencia a ${toAccount.bankName}`
    const receiveTransferName = input.note?.trim() || `Transferencia desde ${fromAccount.bankName}`

    await db.transaction(async (tx) => {
      await tx.insert(movements).values([
        {
          id: fromMovementId,
          userId,
          accountId: fromAccount.id,
          categoryId: null,
          name: transferName,
          date: input.date,
          amount: fromMoney.amount,
          type: 'expense',
          currency: fromAccount.currency,
          amountUsd: fromMoney.amountUsd,
          exchangeRate: fromMoney.exchangeRate,
          transferId,
          transferPairId: toMovementId,
          needsReview: false,
        },
        {
          id: toMovementId,
          userId,
          accountId: toAccount.id,
          categoryId: null,
          name: receiveTransferName,
          date: input.date,
          amount: toMoney.amount,
          type: 'income',
          currency: toAccount.currency,
          amountUsd: toMoney.amountUsd,
          exchangeRate: toMoney.exchangeRate,
          transferId,
          transferPairId: fromMovementId,
          needsReview: false,
        },
      ])
    })

    return ok({ transferId })
  },

  async updateTransfer(userId: string, transferId: string, input: Omit<TransferInput, 'fromAccountId' | 'toAccountId'>): Promise<LedgerResult> {
    const transferMovements = await db.select().from(movements).where(and(eq(movements.transferId, transferId), eq(movements.userId, userId)))
    if (transferMovements.length !== 2) return fail('Transferencia no encontrada')
    const expenseMovement = transferMovements.find((m) => m.type === 'expense')
    const incomeMovement = transferMovements.find((m) => m.type === 'income')
    if (!expenseMovement || !incomeMovement || expenseMovement.transferPairId !== incomeMovement.id || incomeMovement.transferPairId !== expenseMovement.id) {
      return fail('Transferencia corrupta')
    }
    if (!expenseMovement.accountId || !incomeMovement.accountId) return fail('Transferencia corrupta')

    const [fromAccount, toAccount] = await Promise.all([
      getOwnedAccount(userId, expenseMovement.accountId),
      getOwnedAccount(userId, incomeMovement.accountId),
    ])
    if (!fromAccount || !toAccount) return fail('Transferencia corrupta')
    if (input.fromCurrency !== fromAccount.currency || input.toCurrency !== toAccount.currency) {
      return fail('La moneda no coincide con la cuenta')
    }

    const fromMoney = await normalizeTransferLeg(userId, expenseMovement.accountId, input.fromAmount, input.fromCurrency)
    if ('error' in fromMoney) return fail(fromMoney.error)
    const toMoney = await normalizeTransferLeg(userId, incomeMovement.accountId, input.toAmount, input.toCurrency)
    if ('error' in toMoney) return fail(toMoney.error)
    const transferName = input.note?.trim() || `Transferencia a ${toAccount.bankName}`
    const receiveTransferName = input.note?.trim() || `Transferencia desde ${fromAccount.bankName}`

    await db.transaction(async (tx) => {
      await tx.update(movements).set({
        name: transferName,
        date: input.date,
        amount: fromMoney.amount,
        currency: fromAccount.currency,
        amountUsd: fromMoney.amountUsd,
        exchangeRate: fromMoney.exchangeRate,
        updatedAt: new Date(),
      }).where(and(eq(movements.id, expenseMovement.id), eq(movements.userId, userId)))
      await tx.update(movements).set({
        name: receiveTransferName,
        date: input.date,
        amount: toMoney.amount,
        currency: toAccount.currency,
        amountUsd: toMoney.amountUsd,
        exchangeRate: toMoney.exchangeRate,
        updatedAt: new Date(),
      }).where(and(eq(movements.id, incomeMovement.id), eq(movements.userId, userId)))
    })

    return ok()
  },

  async deleteTransfer(userId: string, transferId: string): Promise<LedgerResult> {
    const transferMovements = await db.select({ id: movements.id, type: movements.type, transferPairId: movements.transferPairId }).from(movements).where(and(eq(movements.transferId, transferId), eq(movements.userId, userId)))
    if (transferMovements.length !== 2) return fail('Transferencia no encontrada')
    const expenseMovement = transferMovements.find((m) => m.type === 'expense')
    const incomeMovement = transferMovements.find((m) => m.type === 'income')
    if (!expenseMovement || !incomeMovement || expenseMovement.transferPairId !== incomeMovement.id || incomeMovement.transferPairId !== expenseMovement.id) {
      return fail('Transferencia corrupta')
    }
    await db.delete(movements).where(and(eq(movements.transferId, transferId), eq(movements.userId, userId)))
    return ok()
  },

  async transformToTransfer(userId: string, input: TransformToTransferInput): Promise<LedgerResult> {
    const original = await getOwnedMovement(userId, input.movementId)
    if (!original) return fail('Movimiento no encontrado')
    if (input.requirePending && !original.needsReview) return fail('Movement is not pending review')
    if (original.transferId || original.transferPairId) return fail('Este movimiento ya es una transferencia')
    if (hasDependentWorkflow(original) || original.receivable || original.emergency || original.loan) return fail('Resolve dependent workflow before transforming')
    if (input.source.type !== 'expense') return fail('Transfer source must be an expense')
    if (!input.source.accountId) return fail('El movimiento debe tener una cuenta asignada')
    if (input.source.accountId === input.toAccountId) return fail('Las cuentas origen y destino deben ser diferentes')
    if (input.toAmount <= 0) return fail('El monto destino debe ser mayor a 0')

    const [fromAccount, toAccount] = await Promise.all([
      getOwnedAccount(userId, input.source.accountId),
      getOwnedAccount(userId, input.toAccountId),
    ])
    if (!fromAccount) return fail('Cuenta origen no válida')
    if (!toAccount) return fail('Cuenta destino no válida')
    if (input.source.currency !== fromAccount.currency || input.toCurrency !== toAccount.currency) {
      return fail('La moneda no coincide con la cuenta')
    }

    const sourceMoney = await normalizeMoney(userId, input.source)
    if ('error' in sourceMoney) return fail(sourceMoney.error)
    const toMoney = await normalizeTransferLeg(userId, input.toAccountId, input.toAmount, input.toCurrency)
    if ('error' in toMoney) return fail(toMoney.error)

    const transferId = generateId()
    const pairedMovementId = generateId()
    const expenseName = input.note?.trim() || `Transferencia a ${toAccount.bankName}`
    const incomeName = input.note?.trim() || `Transferencia desde ${fromAccount.bankName}`

    await db.transaction(async (tx) => {
      await tx.update(movements).set({
        name: expenseName,
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
        transferId,
        transferPairId: pairedMovementId,
        updatedAt: new Date(),
      }).where(and(eq(movements.id, input.movementId), eq(movements.userId, userId)))
      await tx.insert(movements).values({
        id: pairedMovementId,
        userId,
        accountId: toAccount.id,
        categoryId: null,
        name: incomeName,
        date: input.source.date,
        amount: toMoney.amount,
        type: 'income',
        currency: toAccount.currency,
        amountUsd: toMoney.amountUsd,
        exchangeRate: toMoney.exchangeRate,
        transferId,
        transferPairId: input.movementId,
        time: input.source.time ?? null,
        needsReview: false,
      })
    })

    return ok({ transferId })
  },

  async confirmPendingAsTransfer(userId: string, input: TransformToTransferInput): Promise<LedgerResult> {
    return this.transformToTransfer(userId, { ...input, requirePending: true })
  },

  async settleEmergencyPartially(userId: string, emergencyId: string, fromAccountId: string, toAccountId: string, amount: number, date: string): Promise<LedgerResult> {
    if (!Number.isInteger(amount) || amount <= 0) return fail('El monto debe ser mayor a 0')
    const emergency = await getOwnedMovement(userId, emergencyId)
    if (!emergency || !emergency.emergency) return fail('Gasto de emergencia no encontrado')
    if (emergency.emergencySettled) return fail('Este gasto de emergencia ya está saldado')
    const [fromAccount, toAccount] = await Promise.all([getOwnedAccount(userId, fromAccountId), getOwnedAccount(userId, toAccountId)])
    if (!fromAccount) return fail('Cuenta origen no válida')
    if (!toAccount) return fail('Cuenta destino no válida')

    let fromMoney: NormalizedMoney | null = null
    let toMoney: NormalizedMoney | null = null
    if (fromAccountId !== toAccountId) {
      const normalizedFrom = await normalizeEmergencySettlementLeg(userId, fromAccount, emergency, amount)
      if ('error' in normalizedFrom) return fail(normalizedFrom.error)
      const normalizedTo = await normalizeEmergencySettlementLeg(userId, toAccount, emergency, amount)
      if ('error' in normalizedTo) return fail(normalizedTo.error)
      fromMoney = normalizedFrom
      toMoney = normalizedTo
    }

    let transferId: string | null = null
    const emergencyTotal = movementDisplayAmount(emergency)
    const [existingPaidResult] = await db.select({ total: sql<number>`COALESCE(SUM(amount), 0)` }).from(emergencyPayments).where(eq(emergencyPayments.emergencyId, emergencyId))
    const existingPaid = Number(existingPaidResult?.total ?? 0)
    const currentRemaining = emergencyTotal - existingPaid
    if (currentRemaining <= 0) return fail('Este gasto de emergencia ya está saldado')
    if (amount > currentRemaining) return fail('El abono no puede ser mayor al saldo restante')

    let totalPaid = existingPaid
    let remaining = emergencyTotal
    let settled = false
    await db.transaction(async (tx) => {
      if (fromAccountId !== toAccountId) {
        transferId = generateId()
        const fromMovementId = generateId()
        const toMovementId = generateId()
        await tx.insert(movements).values([
          {
            id: fromMovementId,
            userId,
            accountId: fromAccount.id,
            categoryId: null,
            name: `Abono emergencia: pago`,
            date,
            amount: fromMoney!.amount,
            type: 'expense',
            currency: fromMoney!.account.currency,
            amountUsd: fromMoney!.amountUsd,
            exchangeRate: fromMoney!.exchangeRate,
            transferId,
            transferPairId: toMovementId,
            needsReview: false,
          },
          {
            id: toMovementId,
            userId,
            accountId: toAccount.id,
            categoryId: null,
            name: `Abono emergencia: recibido`,
            date,
            amount: toMoney!.amount,
            type: 'income',
            currency: toMoney!.account.currency,
            amountUsd: toMoney!.amountUsd,
            exchangeRate: toMoney!.exchangeRate,
            transferId,
            transferPairId: fromMovementId,
            needsReview: false,
          },
        ])
      }
      await tx.insert(emergencyPayments).values({ id: generateId(), emergencyId, fromAccountId, toAccountId, amount, date, transferId })
      const [totalResult] = await tx.select({ total: sql<number>`COALESCE(SUM(amount), 0)` }).from(emergencyPayments).where(eq(emergencyPayments.emergencyId, emergencyId))
      totalPaid = Number(totalResult?.total ?? 0)
      remaining = emergencyTotal - totalPaid
      settled = remaining <= 0
      if (settled) {
        await tx.update(movements).set({ emergencySettled: true, updatedAt: new Date() }).where(and(eq(movements.id, emergencyId), eq(movements.userId, userId)))
      }
    })

    return ok({ remaining: Math.max(0, remaining), settled, totalPaid })
  },

  async settleEmergencyDirectly(userId: string, emergencyId: string): Promise<LedgerResult> {
    const emergency = await getOwnedMovement(userId, emergencyId)
    if (!emergency || !emergency.emergency) return fail('Gasto de emergencia no encontrado')
    if (emergency.emergencySettled) return fail('Este gasto de emergencia ya está saldado')
    await db.update(movements).set({ emergencySettled: true, updatedAt: new Date() }).where(and(eq(movements.id, emergencyId), eq(movements.userId, userId)))
    return ok()
  },

  async settleLoanWithCash(userId: string, loanId: string): Promise<LedgerResult> {
    const loan = await getOwnedMovement(userId, loanId)
    if (!loan || loan.type !== 'income' || !loan.loan) return fail('Préstamo no encontrado')
    if (loan.loanSettled) return fail('Este préstamo ya está saldado')
    await db.update(movements).set({ loanSettled: true, updatedAt: new Date() }).where(and(eq(movements.id, loanId), eq(movements.userId, userId)))
    return ok({ remaining: 0, settled: true, totalPaid: movementDisplayAmount(loan) })
  },

  async settleLoanWithExistingMovement(userId: string, loanId: string, expenseMovementId: string, _date: string): Promise<LedgerResult> {
    void _date
    const loan = await getOwnedMovement(userId, loanId)
    const expense = await getOwnedMovement(userId, expenseMovementId)
    if (!loan || loan.type !== 'income' || !loan.loan) return fail('Préstamo no encontrado')
    if (loan.loanSettled) return fail('Este préstamo ya está saldado')
    if (!expense) return fail('Gasto no encontrado')
    if (expense.type !== 'expense') return fail('El movimiento seleccionado no es un gasto')
    if (expense.loanId === loanId) return fail('Este gasto ya está vinculado a este préstamo')
    if (expense.loanId) return fail('Este gasto ya está vinculado a otro préstamo')
    if (expense.needsReview || expense.transferId || expense.transferPairId || expense.receivable || expense.receivableId || expense.emergency || expense.loan) return fail('El gasto seleccionado ya pertenece a otro workflow')
    if (!hasAmountInCurrency(expense, loan.currency as Currency)) return fail('El gasto seleccionado no tiene monto en la moneda del préstamo')

    await db.update(movements).set({ loanId, updatedAt: new Date() }).where(and(eq(movements.id, expenseMovementId), eq(movements.userId, userId)))

    const paybacks = await db.select({ amount: movements.amount, amountUsd: movements.amountUsd })
      .from(movements)
      .where(and(eq(movements.userId, userId), eq(movements.type, 'expense'), eq(movements.loanId, loanId)))
    const loanCurrency = loan.currency as Currency
    const loanAmount = movementDisplayAmount(loan)
    const totalPaid = paybacks.reduce((sum, payback) => sum + movementAmountInCurrency(payback, loanCurrency), 0)
    const remaining = Math.max(0, loanAmount - totalPaid)
    const settled = remaining <= 0
    await db.update(movements).set({ loanSettled: settled, updatedAt: new Date() }).where(and(eq(movements.id, loanId), eq(movements.userId, userId)))
    return ok({ remaining, settled, totalPaid })
  },
}
