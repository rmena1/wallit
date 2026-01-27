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
 * Format cents as currency string
 */
export function formatMoney(cents: number): string {
  const dollars = cents / 100
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(dollars)
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
