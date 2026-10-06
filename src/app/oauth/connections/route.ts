import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db, mcpClients, mcpGrants } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { publicOrigin, signConsent, verifyConsent, tokenHash } from '@/lib/mcp/oauth-policy'
import { boundedBody, noStore, oauthJson } from '@/lib/mcp/http'
import { consentPage, escapeHtml as esc } from '@/lib/mcp/consent-view'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  const user = await getSession()
  if (!user) return oauthJson({ error: 'unauthorized' }, 401)
  const grants = await db.select({ grant: mcpGrants, name: mcpClients.name }).from(mcpGrants).innerJoin(mcpClients, eq(mcpGrants.clientId, mcpClients.id)).where(and(eq(mcpGrants.userId, user.id), isNull(mcpGrants.revokedAt)))
  const forms = grants.map(({ grant, name }) => {
    const csrf = signConsent({ userId: user.id, grantId: grant.id, session: tokenHash(request.cookies.get('wallit_session')?.value ?? ''), expires: Date.now() + 10 * 60_000 })
    return `<section><h2>${esc(name)}</h2><p>${grant.scopes.map(scope => `<span class="pill">${esc(scope)}</span>`).join('')}</p><p>Vence: ${esc(grant.expiresAt.toISOString().slice(0, 10))}</p><form method="post"><input type="hidden" name="csrf" value="${csrf}"><button class="secondary">Revocar conexión</button></form></section>`
  }).join('')
  return new NextResponse(consentPage(`<span class="eyebrow">Tu cuenta</span><h1>Conexiones</h1><p>${esc(user.email)} · Al revocar, dejan de funcionar inmediatamente todos los tokens de esa conexión.</p>${forms || '<section><p>No tienes conexiones activas.</p></section>'}<a href="/settings">Volver a ajustes</a>`), { headers: { ...noStore, 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer' } })
}
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== publicOrigin()) return oauthJson({ error: 'invalid_request' }, 400)
  const user = await getSession()
  if (!user) return oauthJson({ error: 'unauthorized' }, 401)
  try {
    const form = new URLSearchParams(await boundedBody(request))
    const csrf = verifyConsent(form.get('csrf') ?? '')
    if (!csrf || csrf.userId !== user.id || csrf.session !== tokenHash(request.cookies.get('wallit_session')?.value ?? '') || typeof csrf.grantId !== 'string') return oauthJson({ error: 'invalid_request' }, 400)
    await db.update(mcpGrants).set({ revokedAt: new Date() }).where(and(eq(mcpGrants.id, csrf.grantId), eq(mcpGrants.userId, user.id)))
    return NextResponse.redirect(`${publicOrigin()}/oauth/connections`, 303)
  } catch { return oauthJson({ error: 'invalid_request' }, 400) }
}
