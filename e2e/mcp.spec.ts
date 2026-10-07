import { test, expect, request as api, type APIRequestContext } from '@playwright/test'
import postgres from 'postgres'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { hash as hashPassword } from 'bcryptjs'

const origin = 'http://127.0.0.1:3217'
const databaseUrl = process.env.MCP_TEST_DATABASE_URL!
const database = new URL(databaseUrl)
if (!['127.0.0.1', 'localhost'].includes(database.hostname) || !database.pathname.startsWith('/wallit_mcp_test')) throw new Error('Refusing non-fixture database')
const sql = postgres(databaseUrl, { max: 1 })
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const key = () => randomBytes(16).toString('hex')
let sequence = 0
const exercised = new Set<string>()
type Fixture = { userId: string; session: string; spaceId: string; accountId: string; otherAccountId: string; usdAccountId: string; categoryId: string }

async function fixture(): Promise<Fixture> {
  const userId = `mcp-fixture-${key()}`, session = key(), spaceId = key(), accountId = key(), otherAccountId = key(), usdAccountId = key(), categoryId = key()
  await sql`INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (${userId}, ${userId + '@example.test'}, 'fixture-unusable-password', now(), now())`
  await sql`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (${session}, ${userId}, now() + interval '1 day', now())`
  await sql`INSERT INTO spaces (id, name, normalized_name, emoji, is_personal, created_by_user_id, created_at, updated_at) VALUES (${spaceId}, 'Personal', 'personal', '👤', true, ${userId}, now(), now())`
  await sql`INSERT INTO space_memberships (id, space_id, user_id, role, created_at) VALUES (${key()}, ${spaceId}, ${userId}, 'owner', now())`
  for (const [id, currency, lastFour] of [[accountId, 'CLP', '8080'], [otherAccountId, 'CLP', '9090'], [usdAccountId, 'USD', '1164']]) await sql`INSERT INTO accounts (id, space_id, created_by_user_id, bank_name, account_type, last_four_digits, currency, initial_balance, created_at, updated_at) VALUES (${id}, ${spaceId}, ${userId}, 'bci', 'Corriente', ${lastFour}, ${currency}, 1000000, now(), now())`
  await sql`INSERT INTO categories (id, space_id, created_by_user_id, name, emoji, created_at, updated_at) VALUES (${categoryId}, ${spaceId}, ${userId}, 'Test', '🧪', now(), now())`
  await sql`INSERT INTO exchange_rates (id, from_currency, to_currency, rate, source, fetched_at) VALUES (${key()}, 'USD', 'CLP', 95000, 'fixture', now())`
  return { userId, session, spaceId, accountId, otherAccountId, usdAccountId, categoryId }
}
async function browserSession(f: Fixture) {
  return api.newContext({ baseURL: origin, storageState: { cookies: [{ name: 'wallit_session', value: f.session, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] } })
}
async function grant(f: Fixture, scopes = 'wallit:read wallit:write wallit:review wallit:admin', selected?: string[]) {
  const browser = await browserSession(f)
  const registration = await browser.post('/oauth/register', { data: { client_name: 'Fixture Codex', redirect_uris: ['https://client.example.test/callback'], token_endpoint_auth_method: 'none' } })
  expect(registration.status()).toBe(201)
  const clientId: string = (await registration.json()).client_id
  const verifier = randomBytes(32).toString('base64url')
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: 'https://client.example.test/callback', response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: `${origin}/api/mcp`, state: 'fixture-state', scope: scopes })
  const page = await browser.get(`/oauth/authorize?${params}`)
  expect(page.status()).toBe(200)
  const html = await page.text()
  const consent = html.match(/name="consent" value="([^"]+)"/)![1]
  const csrf = html.match(/name="csrf" value="([^"]+)"/)![1]
  const form = new URLSearchParams({ consent, csrf, confirm: 'yes', decision: 'allow', spaceAccess: selected ? 'selected' : 'all' })
  selected?.forEach(id => form.append('spaceId', id))
  const allow = await browser.post('/oauth/authorize', { headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, data: form.toString(), maxRedirects: 0 })
  expect(allow.status()).toBe(303)
  const callback = new URL(allow.headers().location)
  expect(callback.searchParams.get('iss')).toBe(origin)
  expect(callback.searchParams.get('state')).toBe('fixture-state')
  const code = callback.searchParams.get('code')!
  const tokenRequest = { client_id: clientId, grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: 'https://client.example.test/callback', resource: `${origin}/api/mcp` }
  const invalidPkce = await browser.post('/oauth/token', { form: { ...tokenRequest, code_verifier: randomBytes(32).toString('base64url') } })
  expect(invalidPkce.status()).toBe(400)
  const invalidResource = await browser.post('/oauth/token', { form: { ...tokenRequest, resource: 'https://other.example.test/api/mcp' } })
  expect(invalidResource.status()).toBe(400)
  const invalidRedirect = await browser.post('/oauth/token', { form: { ...tokenRequest, redirect_uri: 'https://attacker.example.test/callback' } })
  expect(invalidRedirect.status()).toBe(400)
  const tokenResponse = await browser.post('/oauth/token', { form: tokenRequest })
  expect(tokenResponse.status()).toBe(200)
  const tokens = await tokenResponse.json()
  await browser.dispose()
  return { token: tokens.access_token as string, refresh: tokens.refresh_token as string, clientId, tokenRequest }
}
async function rpc(ctx: APIRequestContext, token: string, method: string, params?: unknown) {
  return ctx.post('/api/mcp', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, data: { jsonrpc: '2.0', id: ++sequence, method, params } })
}
async function call(ctx: APIRequestContext, token: string, name: string, args: Record<string, unknown>, expectError = false) {
  const response = await rpc(ctx, token, 'tools/call', { name, arguments: args })
  expect(response.status(), `${name} HTTP status`).toBe(200)
  const envelope = await response.json()
  expect(Boolean(envelope.result?.isError), `${name} ${envelope.result?.content?.[0]?.text ?? JSON.stringify(envelope.error)}`).toBe(expectError)
  exercised.add(name)
  try { return JSON.parse(envelope.result.content[0].text) } catch { return { code: 'invalid_input', message: envelope.result.content[0].text } }
}
const money = (f: Fixture, extra = {}) => ({ name: 'Fixture expense', date: '2026-10-06', amount: 10000, type: 'expense', currency: 'CLP', accountId: f.accountId, categoryId: f.categoryId, ...extra })
const write = (f: Fixture, extra = {}) => ({ spaceId: f.spaceId, idempotencyKey: key(), ...extra })
test.afterAll(async () => {
  // Delete financial records before users: imported movements require creator identity.
  await sql`DELETE FROM spaces WHERE created_by_user_id IN (SELECT id FROM users WHERE id LIKE 'mcp-fixture-%')`
  await sql`DELETE FROM users WHERE id LIKE 'mcp-fixture-%'`
  await sql`DELETE FROM mcp_clients WHERE name = 'Fixture Codex'`
  await sql`DELETE FROM exchange_rates WHERE source = 'fixture'`
  await sql.end()
})

test('anonymous MCP methods challenge with 401 and standards discovery', async ({ request }) => {
  for (const method of ['GET', 'POST', 'DELETE', 'OPTIONS']) {
    const response = await request.fetch('/api/mcp', { method, data: method === 'POST' ? {} : undefined })
    expect(response.status()).toBe(401)
    expect(response.headers()['www-authenticate']).toContain('/.well-known/oauth-protected-resource/api/mcp')
  }
  const resource = await request.get('/.well-known/oauth-protected-resource/api/mcp')
  expect(resource.status()).toBe(200)
  expect((await resource.json()).resource).toBe(`${origin}/api/mcp`)
  const discovery = await request.get('/.well-known/oauth-authorization-server')
  expect((await discovery.json()).code_challenge_methods_supported).toEqual(['S256'])
  const invalid = await request.post('/api/mcp', { headers: { Authorization: 'Bearer invalid' }, data: {} })
  expect(invalid.status()).toBe(401)
  const connections = await request.get('/oauth/connections')
  expect(connections.status()).toBe(401)
})
test('OAuth consent, PKCE, one-use code, refresh rotation, replay revocation and stored hashes', async ({ request }) => {
  const f = await fixture(), auth = await grant(f)
  const initialized = await rpc(request, auth.token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Fixture', version: '1' } })
  expect(initialized.status()).toBe(200)
  expect((await initialized.json()).result.serverInfo.name).toBe('Wallit')
  const rows = await sql`SELECT hash FROM mcp_tokens WHERE hash IN (${hash(auth.token)}, ${hash(auth.refresh)})`
  expect(rows.length).toBe(2)
  const wrong = await request.post('/oauth/token', { form: { ...auth.tokenRequest, code_verifier: randomBytes(32).toString('base64url') } })
  // A consumed authorization code is treated as replay and revokes the family.
  expect(wrong.status()).toBe(400)
  expect((await rpc(request, auth.token, 'ping')).status()).toBe(401)
  const fresh = await grant(f)
  const refreshRequest = { client_id: fresh.clientId, grant_type: 'refresh_token', refresh_token: fresh.refresh, resource: `${origin}/api/mcp` }
  const rotation = await request.post('/oauth/token', { form: refreshRequest })
  expect(rotation.status()).toBe(200)
  const rotated = await rotation.json()
  expect((await rpc(request, rotated.access_token, 'ping')).status()).toBe(200)
  const replay = await request.post('/oauth/token', { form: refreshRequest })
  expect(replay.status()).toBe(400)
  expect((await rpc(request, rotated.access_token, 'ping')).status()).toBe(401)
  const revocable = await grant(f)
  await request.post('/oauth/revoke', { form: { token: revocable.refresh, client_id: revocable.clientId } })
  expect((await rpc(request, revocable.token, 'ping')).status()).toBe(401)
})
test('MCP income/expense, USD, bulk and every transfer leg remain pending; retries are durable', async ({ request }) => {
  const f = await fixture(), auth = await grant(f)
  const args = write(f, money(f))
  const created = await call(request, auth.token, 'wallit_movement_create', args)
  expect(created.createdMovementIds.length).toBe(1)
  const repeated = await call(request, auth.token, 'wallit_movement_create', args)
  expect(repeated.operationId).toBe(created.operationId)
  await call(request, auth.token, 'wallit_movement_create', { ...args, name: 'Changed retry' }, true)
  await call(request, auth.token, 'wallit_movement_create', write(f, { ...money(f), needsReview: false }), true)
  await call(request, auth.token, 'wallit_movement_create', write(f, money(f, { currency: 'USD', accountId: f.usdAccountId, amount: 100 })))
  const bulk = await call(request, auth.token, 'wallit_movements_create_bulk', write(f, { items: [money(f), money(f, { type: 'income' })] }))
  expect(bulk.createdMovementIds.length).toBe(2)
  const transfer = await call(request, auth.token, 'wallit_transfer_create', write(f, { fromAccountId: f.accountId, toAccountId: f.otherAccountId, fromAmount: 10000, toAmount: 10000, fromCurrency: 'CLP', toCurrency: 'CLP', date: '2026-10-06' }))
  expect(transfer.createdMovementIds.length).toBe(2)
  const rows = await sql`SELECT needs_review FROM movements WHERE created_by_user_id = ${f.userId}`
  expect(rows.length).toBe(6)
  expect(rows.every(row => row.needs_review)).toBe(true)
  const id = created.createdMovementIds[0]
  await call(request, auth.token, 'wallit_pending_edit', write(f, { id, ...money(f, { name: 'Corrected' }) }))
  await call(request, auth.token, 'wallit_review_confirm', write(f, { id, ...money(f, { name: 'Reviewed' }) }))
  expect((await sql`SELECT needs_review FROM movements WHERE id = ${id}`)[0].needs_review).toBe(false)
  await call(request, auth.token, 'wallit_transfer_confirm', write(f, { transferId: transfer.result.transferId }))
  expect((await sql`SELECT needs_review FROM movements WHERE id IN (${transfer.createdMovementIds[0]}, ${transfer.createdMovementIds[1]})`).every(row => row.needs_review === false)).toBe(true)
  const [audit] = await sql`SELECT tool, arguments FROM mcp_operations WHERE id = ${created.operationId}`
  expect(audit.tool).toBe('wallit_movement_create')
  expect(audit.arguments.name).toBe('Fixture expense')
})
test('scopes, cross-user references, Space access loss, selected grants and owner permissions', async ({ request }) => {
  const a = await fixture(), b = await fixture(), auth = await grant(a), readOnly = await grant(a, 'wallit:read')
  const denied = await rpc(request, readOnly.token, 'tools/call', { name: 'wallit_movement_create', arguments: write(a, money(a)) })
  expect(denied.status()).toBe(403)
  await call(request, auth.token, 'wallit_accounts_list', { spaceId: b.spaceId }, true)
  await call(request, auth.token, 'wallit_movement_create', write(a, money(a, { accountId: b.accountId })), true)
  const shared = await call(request, auth.token, 'wallit_space_create', write(a, { name: 'Shared fixture', emoji: '🏠' }))
  await call(request, auth.token, 'wallit_member_add', { ...write(a), spaceId: shared.result.id, email: b.userId + '@example.test' })
  const bAuth = await grant(b)
  await call(request, bAuth.token, 'wallit_space_update', { ...write(b), spaceId: shared.result.id, name: 'Unauthorized rename', emoji: '🏠' }, true)
  const scoped = await grant(a, 'wallit:read wallit:write', [a.spaceId])
  await call(request, scoped.token, 'wallit_accounts_list', { spaceId: shared.result.id }, true)
  await call(request, auth.token, 'wallit_member_remove', { ...write(a), spaceId: shared.result.id, userId: b.userId })
  await call(request, bAuth.token, 'wallit_categories_list', { spaceId: shared.result.id }, true)
  const spaces = await call(request, auth.token, 'wallit_spaces_list', {})
  expect(spaces.some((space: { id: string }) => space.id === b.spaceId)).toBe(false)
})
test('bulk failure rolls back all writes, errors omit database details, expired tokens and invalid origins fail', async ({ request }) => {
  const f = await fixture(), auth = await grant(f)
  await call(request, auth.token, 'wallit_movements_create_bulk', write(f, { items: [money(f), money(f, { categoryId: 'missing-category' })] }), true)
  expect(Number((await sql`SELECT count(*) AS n FROM movements WHERE created_by_user_id = ${f.userId}`)[0].n)).toBe(0)
  const invalid = await request.post('/api/mcp', { headers: { Authorization: `Bearer ${auth.token}`, Origin: 'https://evil.example', Accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'ping' } })
  expect(invalid.status()).toBe(403)
  const nullBody = await request.post('/api/mcp', { headers: { Authorization: `Bearer ${auth.token}` }, data: 'null' })
  expect(nullBody.status()).toBe(400)
  const oversized = await request.post('/api/mcp', { headers: { Authorization: `Bearer ${auth.token}` }, data: 'x'.repeat(262145) })
  expect(oversized.status()).toBe(413)
  await sql`UPDATE mcp_tokens SET expires_at = now() - interval '1 second' WHERE hash = ${hash(auth.token)}`
  expect((await rpc(request, auth.token, 'ping')).status()).toBe(401)
})

test('narrow grants hide historical labels, linked Space data and duplicate import identities', async ({ request }) => {
  const f = await fixture(), auth = await grant(f)
  const shared = await call(request, auth.token, 'wallit_space_create', write(f, { name: 'Private fixture Space', emoji: '🔒' }))
  const second = { ...f, spaceId: shared.result.id }
  const account = await call(request, auth.token, 'wallit_account_create', write(second, { bankName: 'bci', accountType: 'Corriente', lastFourDigits: '3131', currency: 'CLP' }))
  second.accountId = account.result.account.id
  second.categoryId = (await call(request, auth.token, 'wallit_categories_list', { spaceId: second.spaceId }))[0].id
  const emailId = key() + '@fixture.test'
  await call(request, auth.token, 'wallit_import_movement', write(second, { ...money(second), sourceEmailProvider: 'bci', sourceEmailId: emailId }))
  const duplicateArgs = write(f, { ...money(f), sourceEmailProvider: 'bci', sourceEmailId: emailId })
  const duplicate = await call(request, auth.token, 'wallit_import_movement', duplicateArgs)
  expect(duplicate.createdMovementIds).toEqual([])
  const movement = await call(request, auth.token, 'wallit_movement_create', write(f, money(f)))
  // Simulate a historical category link retained by Wallit's migration/domain rules.
  await sql`UPDATE categories SET name = 'Private fixture category' WHERE id = ${second.categoryId}`
  await sql`UPDATE movements SET category_id = ${second.categoryId}, needs_review = false WHERE id = ${movement.createdMovementIds[0]}`
  const transfer = await call(request, auth.token, 'wallit_transfer_create', write(f, { fromAccountId: f.accountId, toAccountId: second.accountId, destinationSpaceId: second.spaceId, fromAmount: 10000, toAmount: 10000, fromCurrency: 'CLP', toCurrency: 'CLP', date: '2026-10-06' }))
  const narrow = await grant(f, 'wallit:read wallit:write wallit:review', [f.spaceId])
  await call(request, narrow.token, 'wallit_transfer_get', { spaceId: f.spaceId, movementId: transfer.createdMovementIds[0] }, true)
  await call(request, narrow.token, 'wallit_transfer_confirm', write(f, { transferId: transfer.result.transferId }), true)
  await call(request, narrow.token, 'wallit_import_movement', write(f, { ...money(f), sourceEmailProvider: 'bci', sourceEmailId: emailId }), true)
  await call(request, narrow.token, 'wallit_import_movement', duplicateArgs, true)
  const reports = await call(request, narrow.token, 'wallit_reports', { spaceId: f.spaceId, startDate: '2026-10-01', endDate: '2026-10-31' })
  const timeline = await call(request, narrow.token, 'wallit_movements_list', { spaceId: f.spaceId })
  const queue = await call(request, narrow.token, 'wallit_review_list', { spaceId: f.spaceId })
  for (const result of [reports, timeline, queue]) {
    expect(JSON.stringify(result)).not.toContain('Private fixture category')
  }
  // Own movement descriptions remain historical facts; joined private Space labels do not.
  expect(timeline.data.find((item: { transferId?: string }) => item.transferId === transfer.result.transferId).transferOtherSpaceName).toBeNull()
  expect(queue.items.find((item: { transferId?: string }) => item.transferId === transfer.result.transferId).transferDestinationMovement).toBeNull()
  const secondOnly = await grant(f, 'wallit:read wallit:write', [second.spaceId])
  await call(request, secondOnly.token, 'wallit_category_delete', write(second, { id: second.categoryId }), true)
  expect((await sql`SELECT category_id FROM movements WHERE id = ${movement.createdMovementIds[0]}`)[0].category_id).toBe(second.categoryId)
})

test('financial parity: categories, account settings, investments, reports, imports and operational workflows', async ({ request }) => {
  const f = await fixture(), auth = await grant(f)
  const createdCategory = await call(request, auth.token, 'wallit_category_create', write(f, { name: 'New fixture', emoji: '🧪' }))
  const categoryId = createdCategory.result.category?.id ?? (await sql`SELECT id FROM categories WHERE space_id = ${f.spaceId} AND name = 'New fixture'`)[0].id
  await call(request, auth.token, 'wallit_category_update', write(f, { id: categoryId, name: 'Updated fixture', emoji: '✅' }))
  const accountSettings = { bankName: 'Fixture Fund', accountType: 'Investment', lastFourDigits: '5555', initialBalance: 10000, creditLimit: null, currency: 'CLP', isInvestment: true }
  const createdAccount = await call(request, auth.token, 'wallit_account_create', write(f, accountSettings))
  const accountId = createdAccount.result.account.id
  await call(request, auth.token, 'wallit_account_update', write(f, { ...accountSettings, id: accountId, bankName: 'Updated Fund' }))
  await call(request, auth.token, 'wallit_accounts_reorder', write(f, { accountIds: [accountId, f.accountId, f.otherAccountId, f.usdAccountId] }))
  await call(request, auth.token, 'wallit_investment_value_update', write(f, { accountId, value: 12000 }))
  const snapshots = await call(request, auth.token, 'wallit_investment_snapshots', { spaceId: f.spaceId, accountId })
  expect(snapshots.snapshots.length).toBe(2)
  await call(request, auth.token, 'wallit_investment_snapshot_delete', write(f, { accountId, snapshotId: snapshots.snapshots[0].id }))

  const make = async (extra = {}) => (await call(request, auth.token, 'wallit_movement_create', write(f, money(f, extra)))).createdMovementIds[0] as string
  const ordinary = await make()
  await call(request, auth.token, 'wallit_review_confirm', write(f, { id: ordinary, ...money(f) }))
  await call(request, auth.token, 'wallit_movement_edit', write(f, { id: ordinary, ...money(f, { name: 'Edited fixture' }) }))
  const split = await make()
  const splits = await call(request, auth.token, 'wallit_movement_split', write(f, { id: split, splits: [{ name: 'A', amount: 4000 }, { name: 'B', amount: 6000 }] }))
  expect(splits.createdMovementIds.length).toBe(2)
  const receivable = await make()
  await call(request, auth.token, 'wallit_receivable_mark', write(f, { id: receivable, reminderText: 'Fixture debtor' }))
  const collected = await call(request, auth.token, 'wallit_receivable_settle_new', write(f, { id: receivable, paymentAccountId: f.otherAccountId }))
  expect(collected.createdMovementIds.length).toBe(1)
  await call(request, auth.token, 'wallit_review_confirm_operational', write(f, { id: collected.createdMovementIds[0] }))
  await call(request, auth.token, 'wallit_receivable_unmark', write(f, { id: receivable }))
  const receivable2 = await make()
  await call(request, auth.token, 'wallit_receivable_mark', write(f, { id: receivable2, reminderText: 'Existing payment debtor' }))
  const income = await make({ type: 'income', amount: 20000 })
  await call(request, auth.token, 'wallit_review_confirm', write(f, { id: income, ...money(f, { type: 'income', amount: 20000 }) }))
  await call(request, auth.token, 'wallit_receivable_settle_existing', write(f, { receivableId: receivable2, existingIncomeId: income }))
  const emergencyId = await make({ emergency: true })
  const emergencyPayment = await call(request, auth.token, 'wallit_emergency_pay', write(f, { id: emergencyId, fromAccountId: f.otherAccountId, toAccountId: f.accountId, amount: 4000, date: '2026-10-06' }))
  expect(emergencyPayment.createdMovementIds.length).toBe(2)
  await call(request, auth.token, 'wallit_emergency_settle_direct', write(f, { id: emergencyId }))
  const loanId = await make({ type: 'income', loan: true })
  await call(request, auth.token, 'wallit_loan_settle', write(f, { id: loanId, expenseMovementId: null, date: '2026-10-06' }))
  const pending = await make()
  await call(request, auth.token, 'wallit_pending_delete', write(f, { id: pending }))
  await call(request, auth.token, 'wallit_movement_delete', write(f, { id: ordinary }))
  const transferArgs = { fromAccountId: f.accountId, toAccountId: f.otherAccountId, fromAmount: 10000, toAmount: 10000, fromCurrency: 'CLP', toCurrency: 'CLP', date: '2026-10-06' }
  const transfer = await call(request, auth.token, 'wallit_transfer_create', write(f, transferArgs))
  await call(request, auth.token, 'wallit_transfer_get', { spaceId: f.spaceId, movementId: transfer.createdMovementIds[0] })
  await call(request, auth.token, 'wallit_transfer_update', write(f, { ...transferArgs, transferId: transfer.result.transferId, note: 'Edited transfer' }))
  expect((await sql`SELECT needs_review FROM movements WHERE id IN (${transfer.createdMovementIds[0]}, ${transfer.createdMovementIds[1]})`).every(row => row.needs_review)).toBe(true)
  await call(request, auth.token, 'wallit_transfer_pending_delete', write(f, { transferId: transfer.result.transferId }))
  const convert = await make()
  const converted = await call(request, auth.token, 'wallit_movement_to_transfer', write(f, { movementId: convert, source: money(f), toAccountId: f.otherAccountId, toAmount: 10000, toCurrency: 'CLP' }))
  await call(request, auth.token, 'wallit_transfer_delete', write(f, { transferId: converted.result.transferId }))
  await call(request, auth.token, 'wallit_import_movement', write(f, { ...money(f), sourceEmailProvider: 'bci', sourceEmailId: key() + '@fixture.test' }))
  await call(request, auth.token, 'wallit_import_transfer', write(f, { fromAccountId: f.accountId, toAccountId: f.otherAccountId, currency: 'CLP', amount: 10000, date: '2026-10-06', sourceEmailProvider: 'bci', sourceEmailId: key() + '@fixture.test' }))
  await call(request, auth.token, 'wallit_import_own_bank_transfer', write(f, { amount: 10000, date: '2026-10-06', from: { bank: 'bci', number: '12348080', product: null, accountId: f.accountId }, to: { bank: 'tenpo', number: null, product: 'wallet', accountId: null }, operationTime: null, reference: null, sourceEmailProvider: 'bci', sourceEmailId: key() + '@fixture.test' }))
  for (const [name, args] of [
    ['wallit_profile', {}], ['wallit_categories_list', {}], ['wallit_accounts_list', {}], ['wallit_members_list', {}], ['wallit_balances', {}],
    ['wallit_account_movements', { accountId: f.accountId }], ['wallit_movements_list', {}], ['wallit_movement_get', { id: receivable }],
    ['wallit_review_list', {}], ['wallit_emergencies_list', {}], ['wallit_emergency_get', { id: emergencyId }],
    ['wallit_loans_list', {}], ['wallit_loan_get', { id: loanId }], ['wallit_reports', { startDate: '2026-10-01', endDate: '2026-10-31' }],
    ['wallit_report_category_movements', { startDate: '2026-10-01', endDate: '2026-10-31', categoryId: f.categoryId }],
    ['wallit_exchange_rate', {}], ['wallit_bank_imports_list', {}], ['wallit_audit_list', {}],
  ] as [string, Record<string, unknown>][]) await call(request, auth.token, name, name === 'wallit_profile' ? args : { spaceId: f.spaceId, ...args })
  await call(request, auth.token, 'wallit_account_delete', write(f, { id: accountId }))
  await call(request, auth.token, 'wallit_category_delete', write(f, { id: categoryId }))
})

test('cross-Space settlements, consumed transfers and restored legs preserve review and currency invariants', async ({ request }) => {
  const f = await fixture(), auth = await grant(f)
  const shared = (await call(request, auth.token, 'wallit_space_create', write(f, { name: 'Settlement fixture', emoji: '🏠' }))).result.id
  const sharedCategory = (await call(request, auth.token, 'wallit_categories_list', { spaceId: shared }))[0].id
  const created = await call(request, auth.token, 'wallit_account_create', { ...write(f), spaceId: shared, bankName: 'Fixture Paying', accountType: 'Corriente', lastFourDigits: '4444', initialBalance: 0, creditLimit: null, currency: 'CLP', isInvestment: false })
  const sourceAccountId = created.result.account.id
  const makeReceivable = async () => {
    const id = (await call(request, auth.token, 'wallit_movement_create', write(f, money(f)))).createdMovementIds[0]
    await call(request, auth.token, 'wallit_receivable_mark', write(f, { id, reminderText: 'Cross-Space debtor' }))
    return id
  }
  const direct = await makeReceivable()
  const paid = await call(request, auth.token, 'wallit_receivable_settle_cross_space', write(f, { receivableId: direct, payingSpaceId: shared, sourceAccountId, destinationAccountId: f.accountId, amount: 10000, date: '2026-10-06' }))
  expect(paid.createdMovementIds.length).toBe(2)
  expect((await sql`SELECT needs_review FROM movements WHERE id IN (${paid.createdMovementIds[0]}, ${paid.createdMovementIds[1]})`).every(row => row.needs_review)).toBe(true)
  await call(request, auth.token, 'wallit_receivable_unmark', write(f, { id: direct }))
  const receivableId = await makeReceivable()
  const transferArgs = { ...write(f), spaceId: shared, fromAccountId: sourceAccountId, toAccountId: f.accountId, destinationSpaceId: f.spaceId, fromAmount: 10000, toAmount: 10000, fromCurrency: 'CLP', toCurrency: 'CLP', date: '2026-10-06', source: { categoryId: sharedCategory }, destination: { categoryId: f.categoryId } }
  const transfer = await call(request, auth.token, 'wallit_transfer_create', transferArgs)
  await call(request, auth.token, 'wallit_transfer_confirm', { ...write(f), spaceId: shared, transferId: transfer.result.transferId })
  await call(request, auth.token, 'wallit_receivable_settle_existing', write(f, { receivableId, existingIncomeId: transfer.createdMovementIds[1] }))
  const settlement = (await sql`SELECT * FROM receivable_settlements WHERE receivable_id = ${receivableId}`)[0]
  await call(request, auth.token, 'wallit_review_confirm_operational', write(f, { id: settlement.incoming_movement_id }))
  await call(request, auth.token, 'wallit_settlement_confirm_transfer', { ...write(f), spaceId: shared, id: settlement.outgoing_movement_id })
  const member = await fixture(), memberAuth = await grant(member)
  await call(request, auth.token, 'wallit_member_add', { ...write(f), spaceId: shared, email: member.userId + '@example.test' })
  await call(request, memberAuth.token, 'wallit_space_leave', { ...write(member), spaceId: shared })
  await call(request, auth.token, 'wallit_space_archive', { ...write(f), spaceId: shared })
})

test('browser login returns to OAuth; consent is explicit, CSRF-protected and revocable', async ({ page, request }) => {
  let callbackReached = false
  const callback = createServer((_req, res) => {
    callbackReached = true
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<h1>Fixture callback</h1>')
  })
  await new Promise<void>(resolve => callback.listen(0, '127.0.0.1', resolve))
  const address = callback.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture callback address')
  const callbackOrigin = `http://127.0.0.1:${address.port}`
  try {
  const f = await fixture(), password = 'local-mcp-fixture-password'
  await sql`UPDATE users SET password_hash = ${await hashPassword(password, 10)} WHERE id = ${f.userId}`
  const registration = await request.post('/oauth/register', { data: { client_name: 'Fixture Codex', redirect_uris: [`${callbackOrigin}/callback`] } })
  expect(registration.status()).toBe(201)
  const clientId = (await registration.json()).client_id
  const verifier = randomBytes(32).toString('base64url')
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: `${callbackOrigin}/callback`, response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: `${origin}/api/mcp`, state: 'fixture-state', scope: 'wallit:read' })
  for (const invalid of [{ redirect_uri: 'https://attacker.example.test' }, { code_challenge_method: 'plain' }, { scope: 'wallit:superuser' }]) {
    const invalidParams = new URLSearchParams(params)
    Object.entries(invalid).forEach(([key, value]) => invalidParams.set(key, value))
    expect((await request.get(`/oauth/authorize?${invalidParams}`)).status()).toBe(400)
  }
  await page.goto(`/oauth/authorize?${params}`)
  await expect(page).toHaveURL(/\/login\?returnTo=/)
  await page.getByLabel('Email').fill(f.userId + '@example.test')
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: /Iniciar sesión/ }).click()
  await expect(page.getByRole('heading', { name: 'Conectar Fixture Codex' })).toBeVisible()
  const consentPage = await page.reload()
  expect(consentPage!.headers()['content-security-policy']).toContain(`form-action 'self' ${callbackOrigin};`)
  expect(consentPage!.headers()['content-security-policy']).not.toContain("form-action 'self';")
  await expect(page.locator('input[name="confirm"]')).not.toBeChecked()
  const signed = await page.locator('input[name="consent"]').inputValue()
  const csrf = await page.locator('input[name="csrf"]').inputValue()
  const consentBody = { consent: signed, csrf, confirm: 'yes', decision: 'allow', spaceAccess: 'all' }
  expect((await page.request.post('/oauth/authorize', { headers: { Origin: 'https://attacker.example.test' }, form: consentBody })).status()).toBe(400)
  expect((await page.request.post('/oauth/authorize', { headers: { Origin: origin }, form: { ...consentBody, csrf: 'wrong' } })).status()).toBe(400)
  expect(Number((await sql`SELECT count(*) AS n FROM mcp_grants WHERE user_id = ${f.userId}`)[0].n)).toBe(0)
  await page.screenshot({ path: '/tmp/wallit-mcp-consent-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '/tmp/wallit-mcp-consent-mobile.png', fullPage: true })
  await page.locator('input[name="confirm"]').check()
  const approvalResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/oauth/authorize' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Autorizar conexión' }).click()
  expect((await approvalResponse).status()).toBe(303)
  await expect.poll(() => callbackReached).toBe(true)
  await expect(page).toHaveURL(url => url.origin === callbackOrigin)
  expect(Number((await sql`SELECT count(*) AS n FROM mcp_grants WHERE user_id = ${f.userId}`)[0].n)).toBe(1)
  const replay = await page.request.post(`${origin}/oauth/authorize`, { headers: { Origin: origin }, form: consentBody, maxRedirects: 0 })
  expect(replay.status()).toBe(400)
  await page.goto('/oauth/connections')
  await expect(page.getByRole('heading', { name: 'Conexiones', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Revocar conexión' }).click()
  await expect(page.getByText('No tienes conexiones activas.')).toBeVisible()
  expect((await sql`SELECT revoked_at FROM mcp_grants WHERE user_id = ${f.userId}`)[0].revoked_at).not.toBeNull()
  } finally {
    await new Promise<void>((resolve, reject) => callback.close(error => error ? reject(error) : resolve()))
  }
})

test('shared-Space member sends create pending recipient legs without private access', async ({ request }) => {
  const a = await fixture(), b = await fixture(), auth = await grant(a)
  const shared = await call(request, auth.token, 'wallit_space_create', write(a, { name: 'Member payment fixture', emoji: '🏠' }))
  const source = { ...a, spaceId: shared.result.id }
  await call(request, auth.token, 'wallit_member_add', write(source, { email: b.userId + '@example.test' }))
  source.accountId = (await call(request, auth.token, 'wallit_account_create', write(source, { bankName: 'bci', accountType: 'Corriente', lastFourDigits: '4444', currency: 'CLP' }))).result.account.id
  const sent = await call(request, auth.token, 'wallit_transfer_send_to_member', write(source, { memberUserId: b.userId, fromAccountId: source.accountId, fromAmount: 3_000_000_000, toAmount: 3_000_000_000, fromCurrency: 'CLP', toCurrency: 'CLP', date: '2026-10-06' }))
  expect(sent.createdMovementIds.length).toBe(1)
  const rows = await sql`SELECT id, needs_review, space_id, account_id FROM movements WHERE id IN (SELECT source_movement_id FROM transfers WHERE id = ${sent.result.transferId}) OR id IN (SELECT destination_movement_id FROM transfers WHERE id = ${sent.result.transferId})`
  expect(rows.length).toBe(2)
  expect(rows.every(row => row.needs_review)).toBe(true)
  expect(rows.find(row => row.space_id === b.spaceId).account_id).toBeNull()
  await call(request, auth.token, 'wallit_accounts_list', { spaceId: b.spaceId }, true)
  await call(request, auth.token, 'wallit_transfer_get', { spaceId: source.spaceId, movementId: sent.createdMovementIds[0] }, true)
  const recipient = await grant(b)
  const queue = await call(request, recipient.token, 'wallit_review_list', { spaceId: b.spaceId })
  expect(queue.items.some((row: { transferId?: string }) => row.transferId === sent.result.transferId)).toBe(true)
  await call(request, auth.token, 'wallit_member_remove', write(source, { userId: b.userId }))
  await call(request, auth.token, 'wallit_transfer_send_to_member', write(source, { memberUserId: b.userId, fromAccountId: source.accountId, fromAmount: 10000, toAmount: 10000, fromCurrency: 'CLP', toCurrency: 'CLP', date: '2026-10-06' }), true)
})

test('concurrent callers serialize retries without duplicate creation or lost pending status', async ({ request }) => {
  const f = await fixture(), auth = await grant(f), args = write(f, money(f))
  const results = await Promise.all([call(request, auth.token, 'wallit_movement_create', args), call(request, auth.token, 'wallit_movement_create', args)])
  expect(results[0].operationId).toBe(results[1].operationId)
  const [count] = await sql`SELECT count(*) AS n FROM movements WHERE created_by_user_id = ${f.userId}`
  expect(Number(count.n)).toBe(1)
  const all = await rpc(request, auth.token, 'tools/list')
  const definitions = (await all.json()).result.tools
  const names = definitions.map((tool: { name: string }) => tool.name).sort()
  expect([...exercised].sort()).toEqual(names)
  expect(definitions.every((tool: { securitySchemes: unknown[] }) => tool.securitySchemes.length === 1)).toBe(true)
  const profile = definitions.find((tool: { name: string }) => tool.name === 'wallit_profile')
  expect(profile._meta['openai/profile']).toBe(true)
  expect(profile.outputSchema.required).toContain('id')
})
