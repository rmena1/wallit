import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const MCP_SCOPES = ['wallit:read', 'wallit:write', 'wallit:review', 'wallit:admin'] as const
export function publicOrigin(): string {
  const origin = process.env.MCP_ORIGIN ?? 'https://wallit.libt.app'
  const url = new URL(origin)
  if (url.origin !== origin || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Invalid MCP origin configuration')
  return origin
}
export const resourceUri = () => `${publicOrigin()}/api/mcp`
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex')
export const randomToken = () => randomBytes(32).toString('base64url')
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')
export function parseScopes(value: string): string[] {
  const scopes = [...new Set(value.split(' ').filter(Boolean))]
  if (!scopes.length || scopes.some(scope => !MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number]))) throw new Error('invalid_scope')
  return scopes
}
export function validRedirect(value: string): boolean {
  try {
    const url = new URL(value)
    return !url.hash && !url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
  } catch { return false }
}
export function signConsent(data: Record<string, unknown>): string {
  const secret = process.env.MCP_OAUTH_SECRET ?? process.env.AUTH_SECRET
  if (!secret || secret.length < 32) throw new Error('OAuth signing unavailable')
  const body = Buffer.from(JSON.stringify(data)).toString('base64url')
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}
export function verifyConsent(token: string): Record<string, unknown> | null {
  try {
    const [body, signature, extra] = token.split('.')
    if (extra || !body || !signature || token.length > 12000) return null
    const expected = signConsent(JSON.parse(Buffer.from(body, 'base64url').toString())).split('.')[1]
    const a = Buffer.from(signature), b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const value = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (typeof value.expires !== 'number' || value.expires <= Date.now()) return null
    return value
  } catch { return null }
}
