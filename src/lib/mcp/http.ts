import { publicOrigin, resourceUri, MCP_SCOPES } from './oauth-policy'

export const noStore = { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' }
// Chromium checks form-action against the post-submit redirect as well.
// Only the redirect validated against the registered client is allowed here.
export function consentCsp(registeredRedirect: string) {
  return `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(registeredRedirect).origin}; frame-ancestors 'none'; base-uri 'none';`
}
export function oauthJson(value: unknown, status = 200) { return Response.json(value, { status, headers: noStore }) }
export function challenge(scope = MCP_SCOPES.join(' '), status = 401) {
  return Response.json({ error: status === 401 ? 'unauthorized' : 'insufficient_scope' }, { status, headers: {
    ...noStore,
    'WWW-Authenticate': `Bearer resource_metadata="${publicOrigin()}/.well-known/oauth-protected-resource/api/mcp", scope="${scope}"${status === 403 ? ', error="insufficient_scope"' : ''}`,
  } })
}
export async function boundedBody(request: Request, limit = 16_384) {
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw new Error('Request too large')
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new Error('Request too large') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}
export function authMetadata() {
  const origin = publicOrigin()
  return {
    issuer: origin, authorization_response_iss_parameter_supported: true, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`, revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'],
    scopes_supported: ['wallit:read', 'wallit:write', 'wallit:review', 'wallit:admin'],
  }
}
export function protectedMetadata() {
  return { resource: resourceUri(), authorization_servers: [publicOrigin()], scopes_supported: ['wallit:read', 'wallit:write', 'wallit:review', 'wallit:admin'], bearer_methods_supported: ['header'], resource_name: 'Wallit' }
}
