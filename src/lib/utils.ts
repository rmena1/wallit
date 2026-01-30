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
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: TIMEZONE,
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
 * Parse a money string to cents
 */
export function parseMoney(value: string): number {
  // Remove currency symbols and commas
  const cleaned = value.replace(/[$,]/g, '').trim()
  const dollars = parseFloat(cleaned)
  if (isNaN(dollars)) return 0
  return Math.round(dollars * 100)
}
