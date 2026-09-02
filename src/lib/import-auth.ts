import { createHash, timingSafeEqual } from 'node:crypto'

const IMPORT_AUTH_DOMAIN = 'wallit-email-import-v1'

export function getImportServiceToken(): string {
  const explicit = process.env.WALLIT_IMPORT_TOKEN?.trim()
  if (explicit) return explicit

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required for import service authentication')
  const password = new URL(databaseUrl).password
  if (!password) throw new Error('DATABASE_URL must contain a password or WALLIT_IMPORT_TOKEN must be set')
  return createHash('sha256').update(`${IMPORT_AUTH_DOMAIN}\0${password}`).digest('hex')
}

export function authorizeImportRequest(authorization: string | null): boolean {
  if (!authorization?.startsWith('Bearer ')) return false
  const provided = Buffer.from(authorization.slice('Bearer '.length), 'utf8')
  const expected = Buffer.from(getImportServiceToken(), 'utf8')
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}
