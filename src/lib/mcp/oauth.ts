import { and, eq, gt, isNull } from 'drizzle-orm'
import { db, mcpClients, mcpCodes, mcpGrants, mcpTokens, users } from '@/lib/db'
import { randomToken, tokenHash, resourceUri, pkceChallenge } from './oauth-policy'

type Grant = typeof mcpGrants.$inferSelect
export type McpPrincipal = { user: { id: string; email: string }; grant: Grant }
const ACCESS_SECONDS = 900
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000

async function issueTokens(tx: Pick<typeof db, 'insert'>, grant: Grant) {
  const access = randomToken(), refresh = randomToken()
  const now = Date.now()
  await tx.insert(mcpTokens).values([
    { hash: tokenHash(access), kind: 'access', grantId: grant.id, expiresAt: new Date(Math.min(now + ACCESS_SECONDS * 1000, grant.expiresAt.getTime())) },
    { hash: tokenHash(refresh), kind: 'refresh', grantId: grant.id, expiresAt: new Date(Math.min(now + REFRESH_MS, grant.expiresAt.getTime())) },
  ])
  return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: ACCESS_SECONDS, scope: grant.scopes.join(' ') }
}

export async function authenticateMcp(header: string | null): Promise<McpPrincipal | null> {
  if (!header || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) return null
  const [row] = await db.select({ grant: mcpGrants, user: { id: users.id, email: users.email } })
    .from(mcpTokens).innerJoin(mcpGrants, eq(mcpTokens.grantId, mcpGrants.id)).innerJoin(users, eq(mcpGrants.userId, users.id))
    .where(and(eq(mcpTokens.hash, tokenHash(header.slice(7))), eq(mcpTokens.kind, 'access'), gt(mcpTokens.expiresAt, new Date()), isNull(mcpGrants.revokedAt), gt(mcpGrants.expiresAt, new Date()), eq(mcpGrants.resource, resourceUri()))).limit(1)
  return row ?? null
}

/** Grant locking makes code redemption and refresh rotation single use across replicas. */
export async function exchangeToken(form: URLSearchParams) {
  if (form.get('resource') !== resourceUri()) return { error: 'invalid_target' }
  const clientId = form.get('client_id')
  const [client] = clientId ? await db.select().from(mcpClients).where(eq(mcpClients.id, clientId)).limit(1) : []
  if (!client) return { error: 'invalid_client' }
  if (form.has('client_secret')) return { error: 'invalid_client' }
  const kind = form.get('grant_type')
  if (kind !== 'authorization_code' && kind !== 'refresh_token') return { error: 'unsupported_grant_type' }
  const raw = form.get(kind === 'authorization_code' ? 'code' : 'refresh_token') ?? ''
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return { error: 'invalid_grant' }
  return db.transaction(async tx => {
    const [credential] = kind === 'authorization_code'
      ? await tx.select().from(mcpCodes).where(eq(mcpCodes.hash, tokenHash(raw))).limit(1)
      : await tx.select().from(mcpTokens).where(and(eq(mcpTokens.hash, tokenHash(raw)), eq(mcpTokens.kind, 'refresh'))).limit(1)
    if (!credential) return { error: 'invalid_grant' }
    const [grant] = await tx.select().from(mcpGrants).where(eq(mcpGrants.id, credential.grantId)).for('update')
    if (!grant || grant.clientId !== client.id || grant.resource !== resourceUri() || grant.revokedAt || grant.expiresAt.getTime() <= Date.now()) return { error: 'invalid_grant' }
    // Re-read after locking: another request may have consumed it while we waited.
    const [fresh] = kind === 'authorization_code'
      ? await tx.select().from(mcpCodes).where(eq(mcpCodes.hash, credential.hash))
      : await tx.select().from(mcpTokens).where(eq(mcpTokens.hash, credential.hash))
    if (!fresh || fresh.expiresAt.getTime() <= Date.now()) return { error: 'invalid_grant' }
    if (fresh.usedAt) {
      await tx.update(mcpGrants).set({ revokedAt: new Date() }).where(eq(mcpGrants.id, grant.id))
      return { error: 'invalid_grant' }
    }
    if (kind === 'authorization_code') {
      const code = fresh as typeof mcpCodes.$inferSelect
      const verifier = form.get('code_verifier') ?? ''
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || pkceChallenge(verifier) !== code.challenge || form.get('redirect_uri') !== code.redirectUri) return { error: 'invalid_grant' }
      await tx.update(mcpCodes).set({ usedAt: new Date() }).where(eq(mcpCodes.hash, code.hash))
    } else {
      if (form.has('scope') && form.get('scope') !== grant.scopes.join(' ')) return { error: 'invalid_scope' }
      await tx.update(mcpTokens).set({ usedAt: new Date() }).where(eq(mcpTokens.hash, credential.hash))
    }
    return issueTokens(tx, grant)
  })
}

export async function revokeToken(form: URLSearchParams) {
  const raw = form.get('token') ?? ''
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return
  await db.transaction(async tx => {
    const [token] = await tx.select().from(mcpTokens).where(eq(mcpTokens.hash, tokenHash(raw)))
    if (!token) return
    const [grant] = await tx.select().from(mcpGrants).where(eq(mcpGrants.id, token.grantId)).for('update')
    if (grant?.clientId === form.get('client_id')) await tx.update(mcpGrants).set({ revokedAt: new Date() }).where(eq(mcpGrants.id, grant.id))
  })
}
