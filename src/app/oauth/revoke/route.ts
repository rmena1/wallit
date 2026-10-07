import { boundedBody, oauthJson } from '@/lib/mcp/http'
import { revokeToken } from '@/lib/mcp/oauth'
export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return oauthJson({ error: 'invalid_request' }, 400)
  try { await revokeToken(new URLSearchParams(await boundedBody(request))); return oauthJson({}) }
  catch { return oauthJson({ error: 'server_error' }, 500) }
}
