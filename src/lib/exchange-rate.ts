import { db, exchangeRates } from '@/lib/db'
import { and, eq, desc } from 'drizzle-orm'
import { generateId } from '@/lib/utils'

const API_URL = 'https://open.er-api.com/v6/latest/USD'
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Get the current USD→CLP exchange rate.
 * Returns rate as integer with 2 decimal precision (e.g. 950.50 → 95050).
 * Caches in DB for 24h. Thread-safe with race condition protection.
 */
export async function getUsdToClpRate(): Promise<number> {
  // Check for a recent cached rate
  const cached = await db
    .select()
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.fromCurrency, 'USD'),
        eq(exchangeRates.toCurrency, 'CLP')
      )
    )
    .orderBy(desc(exchangeRates.fetchedAt))
    .limit(1)

  if (cached.length > 0) {
    const age = Date.now() - cached[0].fetchedAt.getTime()
    if (age < CACHE_DURATION_MS) {
      return cached[0].rate
    }
  }

  // Use a unique key to prevent race conditions - only one fetch per minute window
  const fetchWindow = Math.floor(Date.now() / (60 * 1000)) // 1-minute windows
  const raceKey = `USD_CLP_${fetchWindow}`

  try {
    // Fetch fresh rate
    const res = await fetch(API_URL, { next: { revalidate: 0 } })
    if (!res.ok) {
      // If fetch fails but we have a cached rate, use it
      if (cached.length > 0) return cached[0].rate
      throw new Error('Failed to fetch exchange rate')
    }

    const data = await res.json()
    const clpRate: number = data.rates?.CLP
    if (!clpRate) {
      if (cached.length > 0) return cached[0].rate
      throw new Error('CLP rate not found in API response')
    }

    // Store as integer with 2 decimal precision
    const rateInt = Math.round(clpRate * 100)

    try {
      // Try to insert - use race key as unique ID to prevent duplicates
      await db.insert(exchangeRates).values({
        id: raceKey, // Use deterministic key instead of random nanoid
        fromCurrency: 'USD',
        toCurrency: 'CLP',
        rate: rateInt,
        source: 'open.er-api.com',
        fetchedAt: new Date(),
      })
    } catch (error) {
      // If insert fails due to duplicate key (race condition), fetch the existing record
      const existing = await db
        .select()
        .from(exchangeRates)
        .where(eq(exchangeRates.id, raceKey))
        .limit(1)
      
      if (existing.length > 0) {
        return existing[0].rate
      }
      // If we still can't find it but have cached data, use that
      if (cached.length > 0) return cached[0].rate
      throw error
    }

    return rateInt
  } catch (error) {
    // If all fails but we have cached data, use it (graceful degradation)
    if (cached.length > 0) return cached[0].rate
    throw error
  }
}

/**
 * Convert USD cents to CLP cents using current exchange rate.
 */
export async function convertUsdToClp(amountUsdCents: number): Promise<{ clpCents: number; rate: number }> {
  const rate = await getUsdToClpRate()
  // rate is CLP per 1 USD * 100 (e.g. 95050 means 950.50 CLP/USD)
  // clpCents = usdCents * (rate / 100)
  const clpCents = Math.round(amountUsdCents * rate / 100)
  return { clpCents, rate }
}
