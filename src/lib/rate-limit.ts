/**
 * Simple in-memory rate limiter for server actions.
 * Limits by key (e.g., IP or email) using a sliding window.
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key)
    }
  }
}, 5 * 60 * 1000)

export interface RateLimitConfig {
  /** Max attempts in the window */
  maxAttempts: number
  /** Window duration in milliseconds */
  windowMs: number
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
}

/**
 * Check if a key is rate limited. Returns true if the action should be blocked.
 */
export function isRateLimited(key: string, config: RateLimitConfig = DEFAULT_CONFIG): boolean {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + config.windowMs })
    return false
  }

  entry.count++
  if (entry.count > config.maxAttempts) {
    return true
  }

  return false
}
