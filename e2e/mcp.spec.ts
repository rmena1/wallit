import { test, expect, request as api, chromium, type APIRequestContext } from '@playwright/test'
import postgres from 'postgres'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
// Respect the production DCR limit as the fixture suite grows.
const registrationTimes: number[] = []
async function registerClient(browser: APIRequestContext, redirectUri: string) {
  if (registrationTimes.length >= 20) {
    const wait = registrationTimes.shift()! + 60_100 - Date.now()
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  }
  const response = await browser.post('/oauth/register', { data: { client_name: 'Fixture Codex', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' } })
  registrationTimes.push(Date.now())
  return response
}
async function grant(f: Fixture, scopes = 'wallit:read wallit:write wallit:review wallit:admin', selected?: string[], compatibility?: { resource: string | null; state: string | null }) {
  const browser = await browserSession(f)
  const registration = await registerClient(browser, 'https://client.example.test/callback')
  expect(registration.status()).toBe(201)
  const clientId: string = (await registration.json()).client_id
  const verifier = randomBytes(32).toString('base64url')
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: 'https://client.example.test/callback', response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: `${origin}/api/mcp`, state: 'fixture-state', scope: scopes })
  if (compatibility) {
    for (const [name, value] of Object.entries(compatibility)) {
      if (value === null) params.delete(name)
      else params.set(name, value)
    }
  }
  if (compatibility) for (const invalid of [{ resource: 'https://other.example.test/api/mcp' }, { resource: origin }, { resource: '' }, { code_challenge: '' }, { code_challenge_method: 'plain' }]) {
    const invalidParams = new URLSearchParams(params)
    for (const [name, value] of Object.entries(invalid)) invalidParams.set(name, value)
    const rejected = await browser.get(`/oauth/authorize?${invalidParams}`)
    expect(rejected.status()).toBe(400)
  }
  const page = await browser.get(`/oauth/authorize?${params}`)
  expect(page.status()).toBe(200)
  const html = await page.text()
  const consent = html.match(/name="consent" value="([^"]+)"/)![1]
  const csrf = html.match(/name="csrf" value="([^"]+)"/)![1]
  const form = new URLSearchParams({ consent, csrf, confirm: 'yes', decision: 'allow', spaceAccess: selected ? 'selected' : 'all' })
  selected?.forEach(id => form.append('spaceId', id))
  const allow = await browser.post('/oauth/authorize', { headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, data: form.toString(), maxRedirects: 0 })
  expect(allow.status()).toBe(200)
  const callback = new URL((await allow.text()).match(/http-equiv="refresh" content="0;url=([^"]+)"/)![1].replaceAll('&amp;', '&'))
  expect(callback.searchParams.get('iss')).toBe(origin)
  expect(callback.searchParams.get('state')).toBe(compatibility ? compatibility.state : 'fixture-state')
  const code = callback.searchParams.get('code')!
  const tokenRequest: Record<string, string> = { client_id: clientId, grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: 'https://client.example.test/callback', resource: `${origin}/api/mcp` }
  if (compatibility?.resource === null) delete tokenRequest.resource
  else if (compatibility) tokenRequest.resource = compatibility.resource
  const invalidPkce = await browser.post('/oauth/token', { form: { ...tokenRequest, code_verifier: randomBytes(32).toString('base64url') } })
  expect(invalidPkce.status()).toBe(400)
  const invalidResource = await browser.post('/oauth/token', { form: { ...tokenRequest, resource: 'https://other.example.test/api/mcp' } })
  expect(invalidResource.status()).toBe(400)
  const invalidRedirect = await browser.post('/oauth/token', { form: { ...tokenRequest, redirect_uri: 'https://attacker.example.test/callback' } })
  expect(invalidRedirect.status()).toBe(400)
  const tokenResponse = await browser.post('/oauth/token', { form: tokenRequest })
  expect(tokenResponse.status()).toBe(200)
  const tokens = await tokenResponse.json()
  expect(tokens.scope).toBe([...new Set(scopes.split(' ').filter(scope => ['wallit:read', 'wallit:write', 'wallit:review', 'wallit:admin'].includes(scope)))].join(' '))
  const [stored] = await sql`SELECT resource, scopes FROM mcp_grants WHERE client_id = ${clientId}`
  expect(stored.resource).toBe(`${origin}/api/mcp`)
  expect(stored.scopes.join(' ')).toBe(tokens.scope)
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
  await sql`DELETE FROM bank_email_decisions WHERE run_id IN (SELECT id FROM bank_email_runs WHERE user_id LIKE 'mcp-fixture-%')`
  await sql`DELETE FROM bank_email_runs WHERE user_id LIKE 'mcp-fixture-%'`
  // Delete financial records before users: imported movements require creator identity.
  await sql`DELETE FROM spaces WHERE created_by_user_id IN (SELECT id FROM users WHERE id LIKE 'mcp-fixture-%')`
  await sql`DELETE FROM users WHERE id LIKE 'mcp-fixture-%'`
  await sql`DELETE FROM mcp_clients WHERE name = 'Fixture Codex'`
  await sql`DELETE FROM exchange_rates WHERE source = 'fixture'`
  await sql.end()
})

test('worker status is read-only, scoped to identity, redacted and searchable', async ({ request }) => {
  const f = await fixture(), other = await fixture()
  const auth = await grant(f), readOnly = await grant(f, 'wallit:read'), restricted = await grant(f, 'wallit:admin', [f.spaceId])
  const name = 'wallit_admin_bank_email_status'
  const runId = key(), otherRun = key(), messageId = 'notice-fixture@example.test'
  for (const [id, user] of [[runId, f.userId], [otherRun, other.userId]]) {
    await sql`INSERT INTO bank_email_runs (id, user_id, outcome, finished_at, last_successful_uid) VALUES (${id}, ${user}, 'completed', now(), 5)`
    for (const [index, decision, reason] of [[1, 'imported', 'imported'], [2, 'skipped', 'authentication_failed'], [3, 'unresolved', 'account_unresolved'], [4, 'duplicate', 'duplicate_success']]) {
      await sql`INSERT INTO bank_email_decisions (run_id, uid, message_id_hash, email_date, sender, decision, reason, alert)
        VALUES (${id}, ${index}, ${hash(messageId)}, '2026-10-19T14:28:21Z', 'info@mercadopago.cl', ${decision}, ${reason}, ${decision === 'unresolved'})`
    }
  }
  // Deliberately poisoned telemetry must not expose arbitrary text.
  await sql`INSERT INTO bank_email_decisions (run_id, uid, message_id_hash, sender, decision, reason)
    VALUES (${runId}, 5, 'sensitive-canary', 'sensitive-canary', 'sensitive-canary', 'sensitive-canary')`
  expect((await rpc(request, readOnly.token, 'tools/call', { name, arguments: {} })).status()).toBe(403)
  await call(request, restricted.token, name, {}, true)
  const before = await sql`SELECT count(*)::int AS n FROM mcp_operations WHERE user_id = ${f.userId}`
  const status = await call(request, auth.token, name, {})
  expect(status.runs).toHaveLength(1)
  expect(status.runs[0].id).toBe(runId)
  expect(status.emails).toHaveLength(5)
  expect(JSON.stringify(status)).not.toContain('sensitive-canary')
  expect(JSON.stringify(status)).not.toContain(messageId)
  expect(Object.keys(status.emails[0]).sort()).toEqual(['runId', 'uid', 'messageIdHash', 'emailDate', 'sender', 'decision', 'reason', 'alert', 'recordedAt'].sort())
  expect(Object.keys(status.runs[0]).sort()).toEqual(['id', 'startedAt', 'finishedAt', 'outcome', 'lastSuccessfulUid'].sort())
  const filtered = await call(request, auth.token, name, { messageId: `<${messageId}>`, sender: 'info@mercadopago.cl', dateFrom: '2026-10-19', dateTo: '2026-10-19' })
  expect(filtered.emails).toHaveLength(4)
  expect(filtered.emails.find((e: { decision: string }) => e.decision === 'unresolved').alert).toBe(true)
  expect((await call(request, auth.token, name, { dateTo: '2026-10-18' })).emails).toEqual([])
  expect((await call(request, auth.token, name, { messageId: 'unseen@example.test' })).emails).toEqual([])
  expect((await call(request, auth.token, name, { limit: 1, offset: 1 })).emails).toHaveLength(1)
  expect(await sql`SELECT count(*)::int AS n FROM mcp_operations WHERE user_id = ${f.userId}`).toEqual(before)
  const catalog = await (await rpc(request, auth.token, 'tools/list')).json()
  expect(catalog.result.tools.find((t: { name: string }) => t.name === name).annotations.readOnlyHint).toBe(true)
})

test('own-bank import matches another shared-Space member manual pair once, preserving retries and rejecting distinct evidence', async ({ request }) => {
  const f = await fixture(), creator = await fixture(), auth = await grant(f)
  await sql`UPDATE spaces SET is_personal = false, name = 'Shared bank fixture', normalized_name = 'shared bank fixture' WHERE id = ${f.spaceId}`
  await sql`INSERT INTO space_memberships (id, space_id, user_id, role, created_at) VALUES (${key()}, ${f.spaceId}, ${creator.userId}, 'member', now())`
  await sql`UPDATE accounts SET bank_name = 'mercadopago', last_four_digits = '6991' WHERE id = ${f.otherAccountId}`
  for (const [date, amount] of [['2026-10-17', 50000000], ['2026-10-19', 36000000]] as const) {
    const source = key(), destination = key(), transfer = key()
    for (const [id, account, type] of [[source, f.otherAccountId, 'expense'], [destination, f.accountId, 'income']]) {
      await sql`INSERT INTO movements (id, space_id, created_by_user_id, account_id, name, date, amount, type, currency, needs_review, reportable, created_at, updated_at)
        VALUES (${id}, ${f.spaceId}, ${creator.userId}, ${account}, 'Manual fixture', ${date}, ${amount}, ${type}, 'CLP', false, false, now(), now())`
    }
    await sql`INSERT INTO transfers (id, source_space_id, destination_space_id, source_movement_id, destination_movement_id, created_by_user_id)
      VALUES (${transfer}, ${f.spaceId}, ${f.spaceId}, ${source}, ${destination}, ${creator.userId})`
    const before = await sql`SELECT * FROM movements WHERE id IN (${source}, ${destination}) ORDER BY id`
    const input = write(f, { amount, date, from: { bank: 'mercadopago', number: '6991', product: 'wallet', accountId: f.otherAccountId },
      to: { bank: 'Banco BCI/MACH', number: '99998080', product: null, accountId: f.accountId }, operationTime: null, reference: null,
      sourceEmailProvider: 'mercadopago', sourceEmailId: key() + '@example.test' })
    for (let retry = 0; retry < 2; retry++) {
      const result = await call(request, auth.token, 'wallit_import_own_bank_transfer', { ...input, idempotencyKey: key() })
      expect(result.result).toMatchObject({ duplicate: true, transferId: transfer })
      expect(result.createdMovementIds).toEqual([])
    }
    // A second distinct email cannot consume the same manual pair just because its facts coincide.
    await call(request, auth.token, 'wallit_import_own_bank_transfer', {
      ...input, idempotencyKey: key(), sourceEmailId: key() + '@example.test',
    }, true)
    expect((await sql`SELECT count(*)::int AS n FROM own_bank_transfer_imports WHERE transfer_id = ${transfer}`)[0].n).toBe(1)
    expect(await sql`SELECT * FROM movements WHERE id IN (${source}, ${destination}) ORDER BY id`).toEqual(before)
    expect((await sql`SELECT count(*)::int AS n FROM own_bank_transfer_receipts WHERE email_id = ${input.sourceEmailId}`)[0].n).toBe(1)
  }
  expect((await sql`SELECT count(*)::int AS n FROM movements WHERE space_id = ${f.spaceId}`)[0].n).toBe(4)
  const fresh = await call(request, auth.token, 'wallit_import_own_bank_transfer', write(f, {
    amount: 100000, date: '2026-10-20', from: { bank: 'mercadopago', number: '6991', product: 'wallet', accountId: f.otherAccountId },
    to: { bank: 'Banco BCI/MACH', number: '99998080', product: null, accountId: f.accountId }, operationTime: null, reference: null,
    sourceEmailProvider: 'mercadopago', sourceEmailId: key() + '@example.test',
  }))
  expect(fresh.result).toMatchObject({ duplicate: false, pendingAccounts: false })
  expect(fresh.createdMovementIds).toHaveLength(2)
  expect(await sql`SELECT needs_review FROM movements WHERE id IN (${fresh.createdMovementIds[0]}, ${fresh.createdMovementIds[1]})`).toEqual([{ needs_review: true }, { needs_review: true }])
})

test('ambiguous manual pairs and standalone manual movements block duplicate balance effects', async ({ request }) => {
  const f = await fixture(), creator = await fixture(), auth = await grant(f)
  await sql`UPDATE spaces SET is_personal = false, name = 'Shared bank fixture', normalized_name = 'shared bank fixture' WHERE id = ${f.spaceId}`
  await sql`INSERT INTO space_memberships (id, space_id, user_id, role, created_at) VALUES (${key()}, ${f.spaceId}, ${creator.userId}, 'member', now())`
  await sql`UPDATE accounts SET bank_name = 'mercadopago', last_four_digits = '6991' WHERE id = ${f.otherAccountId}`
  for (const standalone of [true, false]) {
    const date = standalone ? '2026-10-17' : '2026-10-19'
    for (let pair = 0; pair < (standalone ? 1 : 2); pair++) {
      const source = key(), destination = key()
      for (const [id, account, type] of [[source, f.otherAccountId, 'expense'], ...(standalone ? [] : [[destination, f.accountId, 'income']])]) {
        await sql`INSERT INTO movements (id, space_id, created_by_user_id, account_id, name, date, amount, type, currency, needs_review, reportable, created_at, updated_at)
          VALUES (${id}, ${f.spaceId}, ${creator.userId}, ${account}, 'Manual fixture', ${date}, 36000000, ${type}, 'CLP', false, false, now(), now())`
      }
      if (!standalone) await sql`INSERT INTO transfers (id, source_space_id, destination_space_id, source_movement_id, destination_movement_id, created_by_user_id)
        VALUES (${key()}, ${f.spaceId}, ${f.spaceId}, ${source}, ${destination}, ${creator.userId})`
    }
    const before = await sql`SELECT * FROM movements WHERE space_id = ${f.spaceId} ORDER BY id`
    await call(request, auth.token, 'wallit_import_own_bank_transfer', write(f, {
      amount: 36000000, date, from: { bank: 'mercadopago', number: '6991', product: 'wallet', accountId: f.otherAccountId },
      to: { bank: 'Banco BCI/MACH', number: '99998080', product: null, accountId: f.accountId }, operationTime: null, reference: null,
      sourceEmailProvider: 'mercadopago', sourceEmailId: key() + '@example.test',
    }), true)
    expect(await sql`SELECT * FROM movements WHERE space_id = ${f.spaceId} ORDER BY id`).toEqual(before)
    expect((await sql`SELECT count(*)::int AS n FROM own_bank_transfer_imports WHERE created_by_user_id = ${f.userId}`)[0].n).toBe(0)
  }
})

for (const resource of [null, `${origin}/api/mcp`, `${origin}/api/mcp/`]) {
  test(`OAuth compatibility: resource ${resource ?? 'omitted'}, optional state and ignored scopes`, async ({ request }) => {
    const f = await fixture()
    const auth = await grant(f, 'openid wallit:read offline_access wallit:write wallit:review wallit:admin wallit:read', undefined, { resource, state: null })
    expect((await rpc(request, auth.token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } })).status()).toBe(200)
    const refresh: Record<string, string> = { client_id: auth.clientId, grant_type: 'refresh_token', refresh_token: auth.refresh }
    if (resource !== null) refresh.resource = resource
    for (const invalid of ['https://other.example.test/api/mcp', origin, '']) {
      const rejected = await request.post('/oauth/token', { form: { ...refresh, resource: invalid } })
      expect(rejected.status()).toBe(400)
      expect(await rejected.json()).toEqual({ error: 'invalid_target' })
    }
    expect((await request.post('/oauth/token', { form: refresh })).status()).toBe(200)
  })
}

test('receivable marking and Review validate the submitted category atomically', async ({ request }) => {
  const f = await fixture()
  const other = await fixture()
  const auth = await grant(f)
  for (const tool of ['wallit_receivable_mark', 'wallit_review_confirm']) {
    const created = await call(request, auth.token, 'wallit_movement_create', write(f, money(f, { categoryId: null })))
    const id = created.createdMovementIds[0]
    const state = async () => (await sql`SELECT * FROM movements WHERE id = ${id}`)[0]
    const before = await state()
    const args = tool === 'wallit_receivable_mark'
      ? { id, reminderText: 'Debtor' }
      : { id, ...money(f, { categoryId: null, name: 'Unsaved edit' }), receivableText: 'Debtor' }
    const rejected = await call(request, auth.token, tool, write(f, args), true)
    expect(JSON.stringify(rejected)).toContain('requiere categoría')
    expect(await state()).toEqual(before)
    for (const categoryId of [null, other.categoryId, 'missing-category']) {
      await call(request, auth.token, tool, write(f, { ...args, categoryId }), true)
      expect(await state()).toEqual(before)
    }
    const accepted = write(f, { ...args, categoryId: f.categoryId })
    await call(request, auth.token, tool, accepted)
    const after = await state()
    expect(after).toEqual({ ...before, name: 'Debtor', category_id: f.categoryId, receivable: true,
      needs_review: tool === 'wallit_receivable_mark', updated_at: after.updated_at })
    await call(request, auth.token, tool, accepted)
    expect(await state()).toEqual(after)
  }
  const categorized = await call(request, auth.token, 'wallit_movement_create', write(f, money(f)))
  const id = categorized.createdMovementIds[0]
  await call(request, auth.token, 'wallit_receivable_mark', write(f, { id, reminderText: 'Existing category' }))
  expect((await sql`SELECT category_id, receivable, needs_review FROM movements WHERE id = ${id}`)[0])
    .toEqual({ category_id: f.categoryId, receivable: true, needs_review: true })
})

test('Review reclassifies pending workflow flags but protects actual payment dependencies', async ({ request }) => {
  const f = await fixture()
  const auth = await grant(f)
  const make = async (kind: string) => {
    const original = kind === 'loan' ? { type: 'income', loan: true } : kind === 'emergency' ? { emergency: true } : {}
    const id = (await call(request, auth.token, 'wallit_movement_create', write(f, money(f, original)))).createdMovementIds[0]
    if (kind === 'receivable') await call(request, auth.token, 'wallit_receivable_mark', write(f, { id, reminderText: 'Original debtor' }))
    return id as string
  }
  const reviewArgs = (id: string) => ({ id, ...money(f), emergency: false, loan: false, receivableText: 'New debtor' })
  for (const kind of ['emergency', 'loan', 'receivable']) {
    const id = await make(kind)
    const [before] = await sql`SELECT * FROM movements WHERE id = ${id}`
    expect(before.needs_review).toBe(true)
    for (const invalid of [{ categoryId: null }, { emergency: true }, { loan: true }]) {
      await call(request, auth.token, 'wallit_review_confirm', write(f, { ...reviewArgs(id), ...invalid }), true)
      expect((await sql`SELECT * FROM movements WHERE id = ${id}`)[0]).toEqual(before)
    }
    await call(request, auth.token, 'wallit_review_confirm', write(f, reviewArgs(id)))
    const [after] = await sql`SELECT * FROM movements WHERE id = ${id}`
    expect(after).toEqual({ ...before, type: 'expense', name: 'New debtor', emergency: false, loan: false,
      receivable: true, needs_review: false, updated_at: after.updated_at })

    const dependentId = await make(kind)
    if (kind === 'emergency') {
      await call(request, auth.token, 'wallit_emergency_pay', write(f, { id: dependentId,
        fromAccountId: f.otherAccountId, toAccountId: f.accountId, amount: 4000, date: '2026-10-06' }))
    } else if (kind === 'loan') {
      const expenseId = (await call(request, auth.token, 'wallit_movement_create', write(f, money(f)))).createdMovementIds[0]
      await call(request, auth.token, 'wallit_review_confirm', write(f, { id: expenseId, ...money(f) }))
      await call(request, auth.token, 'wallit_loan_settle', write(f, { id: dependentId, expenseMovementId: expenseId, date: '2026-10-06' }))
    } else {
      await call(request, auth.token, 'wallit_receivable_settle_new', write(f, { id: dependentId, paymentAccountId: f.otherAccountId }))
    }
    const beforeMovements = await sql`SELECT * FROM movements WHERE space_id = ${f.spaceId} ORDER BY id`
    const beforePayments = await sql`SELECT * FROM emergency_payments WHERE space_id = ${f.spaceId} ORDER BY id`
    const rejected = await call(request, auth.token, 'wallit_review_confirm', write(f, reviewArgs(dependentId)), true)
    expect(JSON.stringify(rejected)).toContain('dependent relationships')
    expect(await sql`SELECT * FROM movements WHERE space_id = ${f.spaceId} ORDER BY id`).toEqual(beforeMovements)
    expect(await sql`SELECT * FROM emergency_payments WHERE space_id = ${f.spaceId} ORDER BY id`).toEqual(beforePayments)
  }
})

test('ignored scopes never grant data access or permit escalation during refresh', async ({ request }) => {
  const f = await fixture()
  const readOnly = await grant(f, 'openid wallit:read offline_access')
  const assertReadOnly = async (token: string) => {
    const accounts = await call(request, token, 'wallit_accounts_list', { spaceId: f.spaceId })
    expect(accounts.some((account: { id: string }) => account.id === f.accountId)).toBe(true)
    expect((await rpc(request, token, 'tools/call', { name: 'wallit_movement_create', arguments: write(f, money(f)) })).status()).toBe(403)
  }
  await assertReadOnly(readOnly.token)
  const refresh = { client_id: readOnly.clientId, grant_type: 'refresh_token', refresh_token: readOnly.refresh }
  for (const scope of ['openid wallit:read wallit:write offline_access', 'openid offline_access', 'wallit:read wallit:read', ' wallit:read']) {
    const rejected = await request.post('/oauth/token', { form: { ...refresh, scope } })
    expect(rejected.status()).toBe(400)
    expect(await rejected.json()).toEqual({ error: 'invalid_scope' })
  }
  const renewed = await request.post('/oauth/token', { form: { ...refresh, scope: 'openid wallit:read offline_access' } })
  expect(renewed.status()).toBe(200)
  const tokens = await renewed.json()
  expect(tokens.scope).toBe('wallit:read')
  await assertReadOnly(tokens.access_token)
  const noPermissions = await grant(f, 'openid offline_access wallit:unknown')
  for (const name of ['wallit_accounts_list', 'wallit_movement_create']) {
    expect((await rpc(request, noPermissions.token, 'tools/call', { name, arguments: write(f, money(f)) })).status()).toBe(403)
  }
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

test('admin foreign-category repair previews without writes, applies atomically and stays Space scoped', async ({ request }) => {
  const f = await fixture(), other = await fixture()
  const auth = await grant(f, 'wallit:read wallit:write wallit:admin', [f.spaceId])
  const tool = 'wallit_admin_repair_foreign_categories'
  const ids: string[] = []
  for (let i = 0; i < 4; i++) {
    const result = await call(request, auth.token, 'wallit_movement_create', write(f, money(f)))
    ids.push(result.createdMovementIds[0])
  }
  const unmatched = key(), caseMismatch = key()
  for (const [id, name] of [[unmatched, 'No local category'], [caseMismatch, ' test ']]) {
    await sql`INSERT INTO categories (id, space_id, created_by_user_id, name, emoji, created_at, updated_at) VALUES (${id}, ${other.spaceId}, ${other.userId}, ${name}, '🧪', now(), now())`
  }
  // Two exact matches (one already pending), one missing name and one case/space mismatch.
  for (let i = 0; i < ids.length; i++) {
    await sql`UPDATE movements SET category_id = ${[other.categoryId, other.categoryId, unmatched, caseMismatch][i]}, needs_review = ${i === 1} WHERE id = ${ids[i]}`
  }
  // An unrelated Space has the same defect and must remain byte-for-byte unchanged.
  const outsider = key()
  await sql`INSERT INTO movements (id, space_id, created_by_user_id, name, date, amount, type, currency, account_id, category_id, needs_review, created_at, updated_at)
    VALUES (${outsider}, ${other.spaceId}, ${other.userId}, 'Unrelated', '2026-10-06', 10000, 'expense', 'CLP', ${other.accountId}, ${f.categoryId}, false, now(), now())`
  const snapshot = async () => ({
    movements: await sql`SELECT * FROM movements WHERE space_id IN (${f.spaceId}, ${other.spaceId}) ORDER BY id`,
    categories: await sql`SELECT * FROM categories WHERE space_id IN (${f.spaceId}, ${other.spaceId}) ORDER BY id`,
    audit: await sql`SELECT * FROM mcp_operations WHERE user_id = ${f.userId} ORDER BY id`,
  })
  const before = await snapshot()
  const previewArgs = write(f, { sampleLimit: 100 })
  const preview = await call(request, auth.token, tool, previewArgs)
  expect(preview).toMatchObject({ dryRun: true, spaces: [{ spaceId: f.spaceId, reassignable: 2, toReview: 2 }] })
  expect(preview.sample).toHaveLength(4)
  expect(preview.sample).toContainEqual({ movementId: ids[0], spaceId: f.spaceId, foreignCategoryName: 'Test', destinationCategoryName: 'Test' })
  expect(preview.sample).toContainEqual({ movementId: ids[2], spaceId: f.spaceId, foreignCategoryName: 'No local category', destinationCategoryName: null })
  expect(JSON.stringify(preview)).not.toContain(other.categoryId)
  expect(await snapshot()).toEqual(before)
  const bounded = await call(request, auth.token, tool, write(f, { dryRun: true, sampleLimit: 1 }))
  expect(bounded.sample).toHaveLength(1)
  expect(bounded.spaces).toEqual(preview.spaces)
  expect(await snapshot()).toEqual(before)
  const noAdmin = await grant(f, 'wallit:read wallit:write', [f.spaceId])
  for (const dryRun of [true, false]) {
    expect((await rpc(request, noAdmin.token, 'tools/call', { name: tool, arguments: write(f, { dryRun }) })).status()).toBe(403)
    expect((await call(request, auth.token, tool, write(other, { dryRun }), true)).code).toBe('forbidden')
  }
  expect(await snapshot()).toEqual(before)
  const applyArgs = { ...previewArgs, dryRun: false }
  // Inject a constraint failure to prove the set-based repair and its audit roll back.
  const last = before.movements.filter(row => ids.includes(row.id)).at(-1)!
  const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'"
  await sql.unsafe(`ALTER TABLE movements ADD CONSTRAINT fixture_repair_failure CHECK (id <> ${literal(last.id)} OR category_id IS NOT DISTINCT FROM ${literal(last.category_id)}) NOT VALID`)
  try {
    expect((await call(request, auth.token, tool, applyArgs, true)).code).toBe('operation_failed')
    expect(await snapshot()).toEqual(before)
  } finally {
    await sql`ALTER TABLE movements DROP CONSTRAINT fixture_repair_failure`
  }
  const applied = await call(request, auth.token, tool, applyArgs)
  expect(applied.result).toEqual({ ...preview, dryRun: false })
  expect(applied.createdMovementIds).toEqual([])
  const after = await snapshot()
  expect(after.categories).toEqual(before.categories)
  expect(after.audit).toHaveLength(before.audit.length + 1)
  for (const original of before.movements) {
    const index = ids.indexOf(original.id)
    expect(after.movements.find(row => row.id === original.id)).toEqual(index < 0 ? original : {
      ...original, category_id: index < 2 ? f.categoryId : null,
      needs_review: index < 2 ? original.needs_review : true,
    })
  }
  expect(await call(request, auth.token, tool, applyArgs)).toEqual(applied)
  expect(await snapshot()).toEqual(after)
  const again = await call(request, auth.token, tool, write(f, { dryRun: false }))
  expect(again.result).toEqual({ dryRun: false, spaces: [{ spaceId: f.spaceId, reassignable: 0, toReview: 0 }], sample: [] })
})

test('admin repair enforces linked transfer and settlement Spaces for previews and apply', async ({ request }) => {
  const f = await fixture(), auth = await grant(f)
  const tool = 'wallit_admin_repair_foreign_categories'
  const shared = (await call(request, auth.token, 'wallit_space_create', write(f, { name: 'Repair linked Space', emoji: '🏠' }))).result.id
  const sharedCategory = (await call(request, auth.token, 'wallit_categories_list', { spaceId: shared }))[0].id
  const account = (await call(request, auth.token, 'wallit_account_create', write(f, { spaceId: shared, bankName: 'Fixture', accountType: 'Corriente', lastFourDigits: '4444', currency: 'CLP' }))).result.account.id
  const transfer = await call(request, auth.token, 'wallit_transfer_create', write(f, { fromAccountId: f.accountId, toAccountId: account, destinationSpaceId: shared, fromAmount: 10000, toAmount: 10000, fromCurrency: 'CLP', toCurrency: 'CLP', date: '2026-10-06' }))
  const [root] = await sql`SELECT * FROM transfers WHERE id = ${transfer.result.transferId}`
  const receivable = (await call(request, auth.token, 'wallit_movement_create', write(f, money(f)))).createdMovementIds[0]
  await call(request, auth.token, 'wallit_receivable_mark', write(f, { id: receivable, reminderText: 'Repair fixture debtor' }))
  await call(request, auth.token, 'wallit_receivable_settle_cross_space', write(f, { receivableId: receivable, payingSpaceId: shared, sourceAccountId: account, destinationAccountId: f.accountId, amount: 10000, date: '2026-10-06' }))
  const [settlement] = await sql`SELECT * FROM receivable_settlements WHERE receivable_id = ${receivable}`
  const narrow = await grant(f, 'wallit:admin', [f.spaceId])
  const narrowShared = await grant(f, 'wallit:admin', [shared])
  const snapshot = async () => ({
    movements: await sql`SELECT * FROM movements WHERE space_id IN (${f.spaceId}, ${shared}) ORDER BY id`,
    transfers: await sql`SELECT * FROM transfers WHERE id = ${root.id}`,
    settlements: await sql`SELECT * FROM receivable_settlements WHERE id = ${settlement.id}`,
    audit: await sql`SELECT * FROM mcp_operations WHERE user_id = ${f.userId} ORDER BY id`,
  })
  for (const item of [
    { id: root.source_movement_id, spaceId: f.spaceId, local: f.categoryId, foreign: sharedCategory, token: narrow.token },
    { id: settlement.receivable_id, spaceId: f.spaceId, local: f.categoryId, foreign: sharedCategory, token: narrow.token },
    { id: settlement.incoming_movement_id, spaceId: f.spaceId, local: f.categoryId, foreign: sharedCategory, token: narrow.token },
    { id: settlement.outgoing_movement_id, spaceId: shared, local: sharedCategory, foreign: f.categoryId, token: narrowShared.token },
  ]) {
    await sql`UPDATE movements SET category_id = ${item.foreign}, needs_review = false WHERE id = ${item.id}`
    const before = await snapshot()
    for (const dryRun of [true, false]) {
      const denied = await call(request, item.token, tool, write(f, { spaceId: item.spaceId, dryRun }), true)
      expect(denied).toEqual({ code: 'forbidden', message: 'Linked Space unavailable' })
      expect(await snapshot()).toEqual(before)
    }
    const preview = await call(request, auth.token, tool, write(f, { spaceId: item.spaceId }))
    expect(preview.spaces).toEqual([{ spaceId: item.spaceId, reassignable: 1, toReview: 0 }])
    expect(await snapshot()).toEqual(before)
    const result = await call(request, auth.token, tool, write(f, { spaceId: item.spaceId, dryRun: false }))
    expect(result.result).toEqual({ ...preview, dryRun: false })
    const after = await snapshot()
    expect(after.movements).toEqual(before.movements.map(row => row.id === item.id ? { ...row, category_id: item.local } : row))
    expect(after.transfers).toEqual(before.transfers)
    expect(after.settlements).toEqual(before.settlements)
  }
  // All-Space consent does not override lost membership or archived status.
  await sql`UPDATE movements SET category_id = ${sharedCategory} WHERE id = ${root.source_movement_id}`
  const [membership] = await sql`DELETE FROM space_memberships WHERE space_id = ${shared} AND user_id = ${f.userId} RETURNING *`
  const beforeLostMembership = await snapshot()
  for (const dryRun of [true, false]) {
    expect((await call(request, auth.token, tool, write(f, { dryRun }), true)).code).toBe('forbidden')
  }
  expect(await snapshot()).toEqual(beforeLostMembership)
  await sql`INSERT INTO space_memberships ${sql(membership)}`
  await sql`UPDATE spaces SET archived_at = now() WHERE id = ${shared}`
  for (const dryRun of [true, false]) {
    expect((await call(request, auth.token, tool, write(f, { spaceId: shared, dryRun }), true)).code).toBe('forbidden')
    expect((await call(request, auth.token, tool, write(f, { dryRun }), true)).code).toBe('forbidden')
  }
  expect(await snapshot()).toEqual(beforeLostMembership)
})

test('admin repair aggregates a large fixture with bounded and zero samples', async ({ request }) => {
  const f = await fixture(), other = await fixture(), auth = await grant(f, 'wallit:admin', [f.spaceId])
  const prefix = key(), missing = key(), tool = 'wallit_admin_repair_foreign_categories'
  await sql`INSERT INTO categories (id, space_id, created_by_user_id, name, emoji, created_at, updated_at)
    VALUES (${missing}, ${other.spaceId}, ${other.userId}, 'No match', '🧪', now(), now())`
  await sql`INSERT INTO movements (id, space_id, created_by_user_id, name, date, amount, type, currency, account_id, category_id, needs_review, created_at, updated_at)
    SELECT ${prefix} || n::text, ${f.spaceId}, ${f.userId}, 'Repair load fixture', '2026-10-06', 10000, 'expense', 'CLP', ${f.accountId},
      CASE WHEN n % 2 = 0 THEN ${other.categoryId} ELSE ${missing} END, false, now(), now() FROM generate_series(1, 400) n`
  const before = await sql`SELECT * FROM movements WHERE space_id = ${f.spaceId} ORDER BY id`
  for (const sampleLimit of [0, 3, 100]) {
    const preview = await call(request, auth.token, tool, write(f, { sampleLimit }))
    expect(preview.spaces).toEqual([{ spaceId: f.spaceId, reassignable: 200, toReview: 200 }])
    expect(preview.sample).toHaveLength(sampleLimit)
    expect(preview.sample.map((row: { movementId: string }) => row.movementId)).toEqual(before.slice(0, sampleLimit).map(row => row.id))
    expect(await sql`SELECT * FROM movements WHERE space_id = ${f.spaceId} ORDER BY id`).toEqual(before)
  }
  const applied = await call(request, auth.token, tool, write(f, { dryRun: false, sampleLimit: 0 }))
  expect(applied.result).toEqual({ dryRun: false, spaces: [{ spaceId: f.spaceId, reassignable: 200, toReview: 200 }], sample: [] })
  expect(await sql`SELECT * FROM movements WHERE space_id = ${f.spaceId} ORDER BY id`).toEqual(before.map(row => ({
    ...row, category_id: row.category_id === other.categoryId ? f.categoryId : null, needs_review: row.category_id === missing,
  })))
  expect((await call(request, auth.token, tool, write(f, { dryRun: false }))).result.spaces).toEqual([{ spaceId: f.spaceId, reassignable: 0, toReview: 0 }])
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
  // Simulate a malformed historical cross-Space category reference.
  await sql`UPDATE categories SET name = 'Private fixture category' WHERE id = ${second.categoryId}`
  await sql`UPDATE movements SET category_id = ${second.categoryId}, needs_review = false WHERE id = ${movement.createdMovementIds[0]}`
  const transfer = await call(request, auth.token, 'wallit_transfer_create', write(f, { fromAccountId: f.accountId, toAccountId: second.accountId, destinationSpaceId: second.spaceId, fromAmount: 10000, toAmount: 10000, fromCurrency: 'CLP', toCurrency: 'CLP', date: '2026-10-06' }))
  const transferLegs = await sql`SELECT source_movement_id, destination_movement_id FROM transfers WHERE id = ${transfer.result.transferId}`
  const { source_movement_id: sourceId, destination_movement_id: destinationId } = transferLegs[0]
  for (const malformed of [true, false]) {
    await sql`UPDATE movements SET category_id = ${malformed ? second.categoryId : f.categoryId} WHERE id = ${sourceId}`
    await sql`UPDATE movements SET category_id = ${malformed ? f.categoryId : second.categoryId} WHERE id = ${destinationId}`
    for (const selectedSpace of [f.spaceId, second.spaceId]) {
      const transferDetail = await call(request, auth.token, 'wallit_transfer_get', { spaceId: selectedSpace, movementId: selectedSpace === f.spaceId ? sourceId : destinationId })
      expect(transferDetail.fromMovement).toMatchObject({ spaceId: f.spaceId, categoryId: malformed ? null : f.categoryId })
      expect(transferDetail.toMovement).toMatchObject({ spaceId: second.spaceId, categoryId: malformed ? null : second.categoryId })
      const reviewQueue = await call(request, auth.token, 'wallit_review_list', { spaceId: selectedSpace })
      const item = reviewQueue.items.find((item: { transferId?: string }) => item.transferId === transfer.result.transferId)
      expect(item.transferSourceMovement).toMatchObject({ spaceId: f.spaceId, categoryId: malformed ? null : f.categoryId })
      expect(item.transferDestinationMovement).toMatchObject({ spaceId: second.spaceId, categoryId: malformed ? null : second.categoryId })
    }
  }
  // Keep the rest of this isolation fixture malformed.
  await sql`UPDATE movements SET category_id = ${second.categoryId} WHERE id = ${sourceId}`
  await sql`UPDATE movements SET category_id = ${f.categoryId} WHERE id = ${destinationId}`
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
  // Even consent to both Spaces must not expose foreign categories in this Space.
  for (const [tool, args] of [
    ['wallit_reports', { startDate: '2026-10-01', endDate: '2026-10-31' }],
    ['wallit_movements_list', {}],
    ['wallit_review_list', {}],
    ['wallit_movement_get', { id: movement.createdMovementIds[0] }],
  ] as const) {
    const result = await call(request, auth.token, tool, { spaceId: f.spaceId, ...args })
    expect(JSON.stringify(result)).not.toContain('Private fixture category')
  }
  const detail = await call(request, auth.token, 'wallit_movement_get', { spaceId: f.spaceId, id: movement.createdMovementIds[0] })
  expect(detail).toMatchObject({ categoryId: null, categoryName: null, categoryEmoji: null })
  await call(request, auth.token, 'wallit_movement_edit', write(f, { id: movement.createdMovementIds[0], ...money(f, { categoryId: second.categoryId }) }), true)
  await sql`UPDATE movements SET needs_review = true WHERE id = ${movement.createdMovementIds[0]}`
  await call(request, auth.token, 'wallit_review_confirm', write(f, { id: movement.createdMovementIds[0], ...money(f, { categoryId: second.categoryId }) }), true)
  const pending = await call(request, auth.token, 'wallit_review_list', { spaceId: f.spaceId })
  expect(JSON.stringify(pending)).not.toContain('Private fixture category')
  expect(pending.items.find((item: { id: string }) => item.id === movement.createdMovementIds[0])).toMatchObject({ categoryId: null })
  const splitSource = await call(request, auth.token, 'wallit_movement_create', write(f, money(f)))
  await sql`UPDATE movements SET category_id = ${second.categoryId} WHERE id = ${splitSource.createdMovementIds[0]}`
  const split = await call(request, auth.token, 'wallit_movement_split', write(f, { id: splitSource.createdMovementIds[0], splits: [{ name: 'First', amount: 4000 }, { name: 'Second', amount: 6000 }] }))
  expect(split.createdMovementIds).toHaveLength(2)
  for (const id of split.createdMovementIds) {
    expect((await sql`SELECT category_id, needs_review FROM movements WHERE id = ${id}`)[0]).toEqual({ category_id: null, needs_review: true })
  }
  // Own movement descriptions remain historical facts; joined private Space labels do not.
  expect(timeline.data.find((item: { transferId?: string }) => item.transferId === transfer.result.transferId).transferOtherSpaceName).toBeNull()
  expect(queue.items.find((item: { transferId?: string }) => item.transferId === transfer.result.transferId).transferDestinationMovement).toBeNull()
  expect(queue.items.find((item: { transferId?: string }) => item.transferId === transfer.result.transferId).transferSourceMovement.categoryId).toBeNull()
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
  const registration = await registerClient(request, `${callbackOrigin}/callback`)
  expect(registration.status()).toBe(201)
  const clientId = (await registration.json()).client_id
  const verifier = randomBytes(32).toString('base64url')
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: `${callbackOrigin}/callback`, response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: `${origin}/api/mcp`, state: 'fixture-state', scope: 'wallit:read' })
  for (const invalid of [{ redirect_uri: 'https://attacker.example.test' }, { code_challenge_method: 'plain' }]) {
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
  expect(consentPage!.headers()['content-security-policy']).toContain("form-action 'self';")
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
  expect((await approvalResponse).status()).toBe(200)
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

// Run with MCP_TEST_ORIGIN=https://wallit.libt.app to exercise the literal
// production audience; every Wallit request is forwarded to the local fixture.
test('Cursor OAuth completes login and a cross-origin 308 callback with one approval', async ({ request }) => {
  const issuer = process.env.MCP_TEST_ORIGIN ?? origin
  const redirectUri = 'https://www.cursor.com/agents/mcp/oauth/callback'
  const state = '52618706_pOxdD8y5JgBvhl9sq-MjyossEgGguqucfaTvqiUchsw.tgd'
  const scope = 'wallit:read wallit:write wallit:review wallit:admin'
  const f = await fixture(), password = 'local-cursor-fixture-password'
  await sql`UPDATE users SET password_hash = ${await hashPassword(password, 10)} WHERE id = ${f.userId}`
  // Real TLS responses and Chromium DNS overrides keep the entire redirect chain
  // local, including requests after a 308 (Playwright routes do not intercept those).
  const directory = mkdtempSync(join(tmpdir(), 'wallit-oauth-tls-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=wallit-oauth-fixture'], { stdio: 'ignore' })
  const callbacks: URL[] = []
  const server = createTlsServer({ key: readFileSync(join(directory, 'key.pem')), cert: readFileSync(join(directory, 'cert.pem')) }, (req, res) => {
    const url = new URL(req.url!, `https://${req.headers.host}`)
    if (url.hostname === 'www.cursor.com') {
      callbacks.push(new URL(url))
      url.hostname = 'cursor.com'
      res.writeHead(308, { location: url.href }).end()
    } else if (url.hostname === 'cursor.com') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<h1>Cursor fixture callback</h1>')
    } else if (url.hostname === 'wallit.libt.app') {
      const upstream = httpRequest(`${origin}${url.pathname}${url.search}`, { method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode!, response.headers)
        response.pipe(res)
      })
      upstream.on('error', () => res.writeHead(502).end())
      req.pipe(upstream)
    } else res.writeHead(404).end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing TLS fixture address')
  const browser = await chromium.launch({ args: [`--host-resolver-rules=${['wallit.libt.app', 'www.cursor.com', 'cursor.com'].map(host => `MAP ${host} 127.0.0.1:${address.port}`).join(',')},EXCLUDE 127.0.0.1,MAP * ~NOTFOUND`] })
  const page = await browser.newPage({ ignoreHTTPSErrors: true })
  try {
    const violations: string[] = []
    page.on('console', message => { if (/Content Security Policy|form-action/i.test(message.text())) violations.push(message.text()) })
    const registration = await registerClient(request, redirectUri)
    expect(registration.status()).toBe(201)
    const clientId = (await registration.json()).client_id
    const verifier = randomBytes(32).toString('base64url')
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: `${issuer}/api/mcp`, state, scope })
    expect(params.toString()).toContain('scope=wallit%3Aread+wallit%3Awrite+wallit%3Areview+wallit%3Aadmin')
    await page.goto(`${issuer}/oauth/authorize?${params}`)
    await expect(page).toHaveURL(url => url.pathname === '/login')
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(`/oauth/authorize?${params}`)
    await page.getByLabel('Email').fill(f.userId + '@example.test')
    await page.getByLabel('Contraseña').fill(password)
    await page.getByRole('button', { name: /Iniciar sesión/ }).click()
    await expect(page.getByRole('heading', { name: 'Conectar Fixture Codex' })).toBeVisible()
    await expect(page.locator('input[name="confirm"]')).not.toBeChecked()
    await page.locator('input[name="confirm"]').check()
    let approvals = 0
    page.on('request', req => { if (new URL(req.url()).pathname === '/oauth/authorize' && req.method() === 'POST') approvals++ })
    await page.getByRole('button', { name: 'Autorizar conexión' }).click()
    await expect(page.getByRole('heading', { name: 'Cursor fixture callback' })).toBeVisible()
    expect(approvals).toBe(1)
    expect(violations).toEqual([])
    expect(callbacks).toHaveLength(1)
    const callback = callbacks[0]
    expect(callback.origin + callback.pathname).toBe(redirectUri)
    expect(callback.searchParams.get('state')).toBe(state)
    expect(callback.searchParams.get('iss')).toBe(issuer)
    expect(new URL(page.url()).search).toBe(callback.search)
    expect(new URL(page.url()).origin).toBe('https://cursor.com')
    const code = callback.searchParams.get('code')!
    expect(code).toBeTruthy()
    const tokenForm = { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: `${issuer}/api/mcp` }
    // The callback's redirect does not change the exact URI required for exchange.
    for (const invalid of [{ redirect_uri: 'https://cursor.com/agents/mcp/oauth/callback' }, { code_verifier: randomBytes(32).toString('base64url') }]) {
      expect((await request.post('/oauth/token', { form: { ...tokenForm, ...invalid } })).status()).toBe(400)
    }
    const exchange = await request.post('/oauth/token', { form: tokenForm })
    expect(exchange.status()).toBe(200)
    const tokens = await exchange.json()
    expect(tokens.access_token).toBeTruthy()
    expect(tokens.scope).toBe(scope)
    const grants = await sql`SELECT resource, scopes FROM mcp_grants WHERE client_id = ${clientId}`
    expect(grants).toHaveLength(1)
    expect(grants[0].resource).toBe(`${issuer}/api/mcp`)
    expect(grants[0].scopes).toEqual(scope.split(' '))
  } finally {
    await browser.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
