import { boundedBody, oauthJson } from '@/lib/mcp/http'
import { exchangeToken } from '@/lib/mcp/oauth'
import { isRateLimited } from '@/lib/rate-limit'
export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  if (isRateLimited('mcp:token', { maxAttempts: 200, windowMs: 60_000 })) return oauthJson({ error: 'temporarily_unavailable' }, 429)
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return oauthJson({ error: 'invalid_request' }, 400)
  try {
    const params = new URLSearchParams(await boundedBody(request))
    if ([...params.keys()].some(key => params.getAll(key).length > 1)) return oauthJson({ error: 'invalid_request' }, 400)
    const result = await exchangeToken(params)
    return oauthJson(result, 'error' in result ? 400 : 200)
  } catch { return oauthJson({ error: 'server_error' }, 500) }
}
