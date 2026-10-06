import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { authenticateMcp } from '@/lib/mcp/oauth'
import { boundedBody, challenge, noStore, oauthJson } from '@/lib/mcp/http'
import { executeTool, McpError, toolFor } from '@/lib/mcp/execute'
import { mcpTools } from '@/lib/mcp/tools'
import { publicOrigin } from '@/lib/mcp/oauth-policy'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handle(request: Request) {
  try {
    const principal = await authenticateMcp(request.headers.get('authorization'))
    if (!principal) return challenge()
    const origin = request.headers.get('origin')
    if (origin && origin !== publicOrigin()) return oauthJson({ error: 'invalid_origin' }, 403)
    if (request.method !== 'POST') return oauthJson({ error: 'method_not_allowed' }, 405)
    let body: string
    try { body = await boundedBody(request, 262_144) } catch { return oauthJson({ error: 'invalid_request' }, 413) }
    let message: { method?: string; params?: { name?: string } }
    try { message = JSON.parse(body) } catch { return oauthJson({ error: 'invalid_json' }, 400) }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return oauthJson({ error: 'invalid_request' }, 400)
    const tool = message.method === 'tools/call' ? toolFor(message.params?.name ?? '') : undefined
    if (tool && !principal.grant.scopes.includes(tool.scope)) return challenge(tool.scope, 403)
    const server = new McpServer({ name: 'Wallit', version: '1.0.0' })
    const profileSchema = z.strictObject({ id: z.string().min(1), email: z.email() })
    for (const definition of mcpTools) {
      server.registerTool(definition.name, {
        description: `${definition.description} ${definition.write ? 'Requires a unique idempotencyKey; reuse exactly the same input on retries.' : ''}`,
        inputSchema: definition.schema,
        ...(definition.name === 'wallit_profile' ? { outputSchema: profileSchema } : {}),
        _meta: { securitySchemes: [{ type: 'oauth2', scopes: [definition.scope] }], ...(definition.name === 'wallit_profile' ? { 'openai/profile': true } : {}) },
        annotations: { readOnlyHint: !definition.write, destructiveHint: definition.write, idempotentHint: true, openWorldHint: false },
      }, async input => {
        try {
          const result = await executeTool(principal, definition.name, input)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], ...(result && typeof result === 'object' && !Array.isArray(result) ? { structuredContent: result as Record<string, unknown> } : {}) }
        } catch (error) {
          const safe = error instanceof McpError ? { code: error.code, message: error.message } : { code: 'operation_failed', message: 'Operation failed; retry with the same idempotencyKey.' }
          return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(safe) }], ...(error instanceof McpError && ['unauthorized', 'insufficient_scope'].includes(error.code) ? { _meta: { 'mcp/www_authenticate': [challenge(definition.scope, error.code === 'unauthorized' ? 401 : 403).headers.get('WWW-Authenticate')!] } } : {}) }
        }
      })
    }
    // The current SDK preserves _meta but has no top-level securitySchemes field.
    // Publish the OpenAI auth declaration alongside the standard MCP descriptor.
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcpTools.map(definition => ({
      name: definition.name, description: definition.description,
      inputSchema: z.toJSONSchema(definition.schema, { io: 'input' }) as { type: 'object'; properties: Record<string, unknown> },
      ...(definition.name === 'wallit_profile' ? { outputSchema: z.toJSONSchema(profileSchema) as { type: 'object' } } : {}),
      annotations: { readOnlyHint: !definition.write, destructiveHint: definition.write, idempotentHint: true, openWorldHint: false },
      securitySchemes: [{ type: 'oauth2', scopes: [definition.scope] }],
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: [definition.scope] }], ...(definition.name === 'wallit_profile' ? { 'openai/profile': true } : {}) },
    })) }))
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    try {
      const response = await transport.handleRequest(new Request(request.url, { method: request.method, headers: request.headers, body }))
      for (const [key, value] of Object.entries(noStore)) response.headers.set(key, value)
      return response
    } finally { await server.close() }
  } catch { return oauthJson({ error: 'server_error' }, 500) }
}
export const POST = handle
export const GET = handle
export const DELETE = handle
export const OPTIONS = handle
