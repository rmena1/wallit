import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, mcpClients, mcpCodes, mcpGrants } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { getAvailableSpaces } from '@/lib/spaces'
import { parseScopes, resourceUri, publicOrigin, signConsent, verifyConsent, randomToken, tokenHash } from '@/lib/mcp/oauth-policy'
import { boundedBody, noStore, oauthJson } from '@/lib/mcp/http'
import { consentPage, escapeHtml as esc } from '@/lib/mcp/consent-view'

export const dynamic = 'force-dynamic'
const cookieName = 'wallit_mcp_consent'
async function validate(params: URLSearchParams) {
  if ([...params.keys()].some(key => params.getAll(key).length > 1) || params.toString().length > 10000) throw new Error('invalid_request')
  const clientId = params.get('client_id') ?? ''
  const [client] = await db.select().from(mcpClients).where(eq(mcpClients.id, clientId)).limit(1)
  const redirect = params.get('redirect_uri') ?? ''
  if (!client || !client.redirectUris.includes(redirect)) throw new Error('invalid_request')
  if (params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') ?? '') || params.get('resource') !== resourceUri()) throw new Error('invalid_request')
  const state = params.get('state')
  if (!state || state.length > 2000) throw new Error('invalid_request')
  const scopes = parseScopes(params.get('scope') ?? 'wallit:read')
  return { client, redirect, scopes, state, challenge: params.get('code_challenge')! }
}
export async function GET(request: NextRequest) {
  try {
    const input = await validate(request.nextUrl.searchParams)
    const user = await getSession()
    if (!user) return NextResponse.redirect(`${publicOrigin()}/login?returnTo=${encodeURIComponent(`/oauth/authorize?${request.nextUrl.searchParams}`)}`)
    const spaces = await getAvailableSpaces(user.id)
    const csrf = randomToken()
    const signed = signConsent({ userId: user.id, session: tokenHash(request.cookies.get('wallit_session')?.value ?? ''), params: request.nextUrl.searchParams.toString(), csrf, expires: Date.now() + 10 * 60_000 })
    const descriptions: Record<string, string> = { 'wallit:read': 'Leer tus datos financieros y reportes.', 'wallit:write': 'Crear, editar y eliminar datos. Los movimientos nuevos quedan por revisar.', 'wallit:review': 'Confirmar movimientos mediante una acción explícita posterior.', 'wallit:admin': 'Administrar Spaces y sus miembros, respetando tus permisos.' }
    const response = new NextResponse(consentPage(`<section><span class="eyebrow">Conexión MCP</span><h1>Conectar ${esc(input.client.name)}</h1><p>Cuenta: <strong>${esc(user.email)}</strong></p><ul>${input.scopes.map(scope => `<li>${descriptions[scope]}</li>`).join('')}</ul><small>Destino de retorno: ${esc(input.redirect)}</small><form method="post" action="/oauth/authorize"><input type="hidden" name="consent" value="${signed}"><input type="hidden" name="csrf" value="${csrf}"><fieldset><legend>Spaces autorizados</legend><label><input type="radio" name="spaceAccess" value="all" checked>Todos mis Spaces actuales y futuros</label><label><input type="radio" name="spaceAccess" value="selected">Solo los seleccionados abajo</label>${spaces.map(space => `<label><input type="checkbox" name="spaceId" value="${esc(space.id)}">${esc(space.emoji)} ${esc(space.name)}</label>`).join('')}</fieldset><p class="note">Al autorizar se guardará una conexión OAuth revocable por 90 días. El acceso vence en 15 minutos y se renueva mientras la conexión siga activa. Puedes revocarla en <a href="/oauth/connections">Conexiones</a>.</p><label><input type="checkbox" name="confirm" value="yes" required>Autorizo a esta aplicación y el almacenamiento de esta conexión.</label><div class="actions"><button class="secondary" name="decision" value="deny" formnovalidate>Cancelar</button><button name="decision" value="allow">Autorizar conexión</button></div></form></section>`), { headers: { ...noStore, 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer' } })
    response.cookies.set(cookieName, tokenHash(signed), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/oauth/authorize', maxAge: 600 })
    return response
  } catch { return oauthJson({ error: 'invalid_request' }, 400) }
}
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== publicOrigin()) return oauthJson({ error: 'invalid_request' }, 400)
  try {
    const form = new URLSearchParams(await boundedBody(request))
    if (['consent', 'csrf', 'decision', 'confirm', 'spaceAccess'].some(key => form.getAll(key).length > 1)) return oauthJson({ error: 'invalid_request' }, 400)
    const signed = form.get('consent') ?? ''
    const data = verifyConsent(signed)
    const user = await getSession()
    if (!data || !user || data.userId !== user.id || data.csrf !== form.get('csrf') || data.session !== tokenHash(request.cookies.get('wallit_session')?.value ?? '') || request.cookies.get(cookieName)?.value !== tokenHash(signed) || typeof data.params !== 'string') return oauthJson({ error: 'invalid_request' }, 400)
    const input = await validate(new URLSearchParams(data.params))
    const destination = new URL(input.redirect)
    destination.searchParams.set('iss', publicOrigin())
    destination.searchParams.set('state', input.state)
    if (form.get('decision') === 'deny') destination.searchParams.set('error', 'access_denied')
    else {
      if (form.get('decision') !== 'allow' || form.get('confirm') !== 'yes') return oauthJson({ error: 'invalid_request' }, 400)
      const available = await getAvailableSpaces(user.id)
      if (!['all', 'selected'].includes(form.get('spaceAccess') ?? '')) return oauthJson({ error: 'invalid_request' }, 400)
      const spaceIds = form.get('spaceAccess') === 'all' ? null : [...new Set(form.getAll('spaceId'))]
      if (spaceIds && (!spaceIds.length || spaceIds.some(id => !available.some(space => space.id === id)))) return oauthJson({ error: 'invalid_request' }, 400)
      const code = randomToken()
      const grantId = randomToken()
      await db.transaction(async tx => {
        await tx.insert(mcpGrants).values({ id: grantId, consentHash: tokenHash(signed), userId: user.id, clientId: input.client.id, scopes: input.scopes, spaceIds, resource: resourceUri(), expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60_000) })
        await tx.insert(mcpCodes).values({ hash: tokenHash(code), grantId, redirectUri: input.redirect, challenge: input.challenge, expiresAt: new Date(Date.now() + 5 * 60_000) })
      })
      destination.searchParams.set('code', code)
    }
    const response = NextResponse.redirect(destination, 303)
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.cookies.set(cookieName, '', { path: '/oauth/authorize', maxAge: 0, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' })
    return response
  } catch { return oauthJson({ error: 'invalid_request' }, 400) }
}
