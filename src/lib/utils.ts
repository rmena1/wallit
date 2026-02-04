import { customAlphabet } from 'nanoid'

// ============================================================================
// ID GENERATION
// ============================================================================
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
const nanoid = customAlphabet(alphabet, 21)

export function generateId(): string {
  return nanoid()
}

// ============================================================================
// DATE UTILITIES
// ============================================================================
const TIMEZONE = 'America/Santiago'

/**
 * Get today's date as YYYY-MM-DD in configured timezone
 */
export function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE })
}

/**
 * Format date for display (e.g., "Mon, Jan 27")
 */
export function formatDateDisplay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

// ============================================================================
// MONEY UTILITIES
// ============================================================================

/**
 * Format cents as currency string (old, use formatCurrency instead)
 */
export function formatMoney(cents: number): string {
  return formatCurrency(cents, 'CLP')
}

/**
 * Format cents as Chilean currency string
 * CLP: $350.887 (dot thousands, no decimals)
 * USD: US$1.218,17 (dot thousands, comma decimals)
 */
export function formatCurrency(cents: number, currency: 'CLP' | 'USD'): string {
  if (currency === 'USD') {
    const value = cents / 100
    const parts = Math.abs(value).toFixed(2).split('.')
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    const decPart = parts[1]
    const sign = value < 0 ? '-' : ''
    return `${sign}US$${intPart},${decPart}`
  } else {
    // CLP: no decimals, dot as thousands separator
    const value = Math.round(Math.abs(cents / 100))
    const formatted = value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    const sign = cents < 0 ? '-' : ''
    return `${sign}$${formatted}`
  }
}

/**
 * Parse a money string to cents.
 * Handles both US format (1,000.50) and Chilean format (1.000,50 or 1.000).
 * Rule: if dots are present and the last dot-separated segment is exactly 3 digits
 * (with no comma before it), treat dots as thousands separators.
 */
export function parseMoney(value: string): number {
  // Remove currency symbols, whitespace, and "US" prefix
  let cleaned = value.replace(/US\$|\$|€/g, '').trim()
  if (!cleaned) return 0

  // Detect Chilean format: dots as thousands separators
  // Cases: "15.000" "1.500.000" "15.000,50"
  const hasComma = cleaned.includes(',')
  const hasDot = cleaned.includes('.')

  if (hasDot && hasComma) {
    // Mixed: determine which is decimal separator
    const lastComma = cleaned.lastIndexOf(',')
    const lastDot = cleaned.lastIndexOf('.')
    if (lastComma > lastDot) {
      // Format: 1.000,50 (Chilean/European) — dots are thousands, comma is decimal
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      // Format: 1,000.50 (US) — commas are thousands, dot is decimal
      cleaned = cleaned.replace(/,/g, '')
    }
  } else if (hasDot && !hasComma) {
    // Only dots: check if it looks like thousands separator
    // "15.000" → last segment is 3 digits → thousands separator
    // "15.50" → last segment is 2 digits → decimal
    // "1.500.000" → multiple dots → thousands separator
    const parts = cleaned.split('.')
    if (parts.length > 2) {
      // Multiple dots = thousands separators (e.g. "1.500.000")
      cleaned = cleaned.replace(/\./g, '')
    } else if (parts.length === 2 && parts[1].length === 3) {
      // Single dot with exactly 3 digits after = thousands separator (e.g. "15.000")
      cleaned = cleaned.replace('.', '')
    }
    // Otherwise keep dot as decimal (e.g. "15.50")
  } else if (hasComma && !hasDot) {
    // Only commas: could be thousands or decimal
    const parts = cleaned.split(',')
    if (parts.length === 2 && (parts[1].length === 1 || parts[1].length === 2)) {
      // "15,5" or "15,50" → comma is decimal
      cleaned = cleaned.replace(',', '.')
    } else {
      // "15,000" or "1,500,000" → commas are thousands
      cleaned = cleaned.replace(/,/g, '')
    }
  }

  const dollars = parseFloat(cleaned)
  if (isNaN(dollars)) return 0
  return Math.round(dollars * 100)
}
