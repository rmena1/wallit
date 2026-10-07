import { z } from 'zod'
import { db, mcpClients } from '@/lib/db'
import { randomToken, validRedirect, MCP_SCOPES } from '@/lib/mcp/oauth-policy'
import { boundedBody, oauthJson } from '@/lib/mcp/http'
import { isRateLimited } from '@/lib/rate-limit'
export const dynamic = 'force-dynamic'
const registration = z.object({
  client_name: z.string().trim().min(1).max(200),
  redirect_uris: z.array(z.string().max(2048).refine(validRedirect)).min(1).max(10),
  grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).optional(),
  response_types: z.array(z.literal('code')).optional(), token_endpoint_auth_method: z.literal('none').default('none'),
})
export async function POST(request: Request) {
  if (isRateLimited('mcp:registration', { maxAttempts: 20, windowMs: 60_000 })) return oauthJson({ error: 'temporarily_unavailable' }, 429)
  try {
    const input = registration.parse(JSON.parse(await boundedBody(request)))
    const clientId = randomToken()
    await db.insert(mcpClients).values({ id: clientId, name: input.client_name, redirectUris: input.redirect_uris })
    return oauthJson({ client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: input.client_name, redirect_uris: input.redirect_uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: MCP_SCOPES.join(' ') }, 201)
  } catch { return oauthJson({ error: 'invalid_client_metadata' }, 400) }
}
