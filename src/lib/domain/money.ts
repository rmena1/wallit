export const USD_CLP_DISCREPANCY_TOLERANCE_CENTS = 1_000

export type UsdClpAmounts = {
  amount: number
  amountUsd: number
  exchangeRate: number
}

export type UsdClpValidation = {
  valid: boolean
  expectedClp: number
  discrepancy: number
  error?: string
}

function formatClpCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('es-CL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function expectedClpCents(amountUsd: number, exchangeRate: number): number {
  if (!Number.isSafeInteger(amountUsd) || amountUsd <= 0) {
    throw new RangeError('Monto USD inválido')
  }
  if (!Number.isSafeInteger(exchangeRate) || exchangeRate <= 0) {
    throw new RangeError('Tipo de cambio inválido')
  }

  // Keep the multiplication exact. Multiplying two individually safe JS
  // integers can still exceed Number.MAX_SAFE_INTEGER before rounding.
  const rounded = (BigInt(amountUsd) * BigInt(exchangeRate) + BigInt(50)) / BigInt(100)
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Monto CLP fuera de rango')
  }
  return Number(rounded)
}

export function validateUsdClpAmounts(input: UsdClpAmounts): UsdClpValidation {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    return { valid: false, expectedClp: 0, discrepancy: 0, error: 'Monto CLP inválido' }
  }
  if (!Number.isSafeInteger(input.amountUsd) || input.amountUsd <= 0) {
    return { valid: false, expectedClp: 0, discrepancy: 0, error: 'Monto USD inválido' }
  }
  if (!Number.isSafeInteger(input.exchangeRate) || input.exchangeRate <= 0) {
    return { valid: false, expectedClp: 0, discrepancy: 0, error: 'Tipo de cambio inválido' }
  }

  let expectedClp: number
  try {
    expectedClp = expectedClpCents(input.amountUsd, input.exchangeRate)
  } catch (error) {
    return {
      valid: false,
      expectedClp: 0,
      discrepancy: 0,
      error: error instanceof Error ? error.message : 'Montos USD/CLP inválidos',
    }
  }
  const discrepancy = Math.abs(input.amount - expectedClp)
  if (discrepancy > USD_CLP_DISCREPANCY_TOLERANCE_CENTS) {
    return {
      valid: false,
      expectedClp,
      discrepancy,
      error: `Monto CLP, monto USD y tipo de cambio no coinciden: esperado ${formatClpCents(expectedClp)}, diferencia ${formatClpCents(discrepancy)}, tolerancia ${formatClpCents(USD_CLP_DISCREPANCY_TOLERANCE_CENTS)}`,
    }
  }

  return { valid: true, expectedClp, discrepancy }
}
