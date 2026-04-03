const OPENING_TRACKED_VALUE_WINDOW_MS = 5 * 60 * 1000

type TimestampValue = Date | string | null | undefined

export interface InvestmentPerformanceInput {
  initialBalance: number
  openingTrackedValue?: number | null
  openingTrackedValueRecordedAt?: TimestampValue
  accountCreatedAt?: TimestampValue
  transferIn?: number
  transferOut?: number
  currentValue?: number | null
}

export interface InvestmentPerformance {
  trackedBaseline: number
  totalDeposited: number
  gainLoss: number
  gainLossPercent: number
  currentValue: number
}

function toValidDate(value: TimestampValue): Date | null {
  if (!value) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function hasOpeningTrackedValue({
  openingTrackedValue,
  openingTrackedValueRecordedAt,
  accountCreatedAt,
}: Pick<InvestmentPerformanceInput, 'openingTrackedValue' | 'openingTrackedValueRecordedAt' | 'accountCreatedAt'>): boolean {
  if (openingTrackedValue == null) {
    return false
  }

  const openingTrackedValueRecordedAtDate = toValidDate(openingTrackedValueRecordedAt)
  const accountCreatedAtDate = toValidDate(accountCreatedAt)

  if (!openingTrackedValueRecordedAtDate || !accountCreatedAtDate) {
    return false
  }

  // Legacy manual accounts only started creating snapshots after a later value update.
  // Treat a snapshot as the opening tracked baseline only when it was captured right as
  // tracking started, or fall back to the stored initial balance.
  return Math.abs(openingTrackedValueRecordedAtDate.getTime() - accountCreatedAtDate.getTime()) <= OPENING_TRACKED_VALUE_WINDOW_MS
}

export function calculateInvestmentPerformance({
  initialBalance,
  openingTrackedValue = null,
  openingTrackedValueRecordedAt = null,
  accountCreatedAt = null,
  transferIn = 0,
  transferOut = 0,
  currentValue = null,
}: InvestmentPerformanceInput): InvestmentPerformance {
  const hasTransferHistory = transferIn !== 0 || transferOut !== 0
  const shouldUseTrackedOpeningValue = hasOpeningTrackedValue({
    openingTrackedValue,
    openingTrackedValueRecordedAt,
    accountCreatedAt,
  }) || (openingTrackedValue != null && initialBalance <= 0 && hasTransferHistory)

  const trackedBaseline = shouldUseTrackedOpeningValue
    ? openingTrackedValue!
    : initialBalance

  const normalizedCurrentValue = currentValue ?? trackedBaseline
  const totalDeposited = trackedBaseline + transferIn - transferOut
  const gainLoss = normalizedCurrentValue - totalDeposited
  const gainLossPercent = totalDeposited > 0
    ? (gainLoss / totalDeposited) * 100
    : 0

  return {
    trackedBaseline,
    totalDeposited,
    gainLoss,
    gainLossPercent,
    currentValue: normalizedCurrentValue,
  }
}
