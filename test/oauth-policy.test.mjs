import assert from 'node:assert/strict'
import test from 'node:test'
import { validRedirect, parseScopes, pkceChallenge, tokenHash, randomToken, signConsent, verifyConsent } from '../src/lib/mcp/oauth-policy.ts'

test('OAuth redirect URIs allow HTTPS and loopback only, without fragments or credentials', () => {
  for (const uri of ['https://chatgpt.com/callback', 'http://127.0.0.1:1234/callback', 'http://localhost:4321/callback']) assert.equal(validRedirect(uri), true)
  for (const uri of ['http://example.com/cb', 'javascript:alert(1)', 'https://user:password@example.com/cb', 'https://example.com/cb#evil', '//evil.example']) assert.equal(validRedirect(uri), false)
})
test('scopes reject unknown privileges and deduplicate known ones', () => {
  assert.deepEqual(parseScopes('wallit:read wallit:read wallit:write'), ['wallit:read', 'wallit:write'])
  assert.throws(() => parseScopes('wallit:sql'))
  assert.throws(() => parseScopes(''))
})
test('PKCE S256 matches the RFC 7636 example', () => {
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  const token = randomToken()
  assert.equal(token.length, 43)
  assert.notEqual(tokenHash(token), token)
})
test('browser consent rejects tampering and expiry', () => {
  process.env.AUTH_SECRET = 'fixture-signing-secret-with-at-least-32-characters'
  const signed = signConsent({ expires: Date.now() + 60000, userId: 'fixture' })
  assert.equal(verifyConsent(signed)?.userId, 'fixture')
  assert.equal(verifyConsent(`${signed}x`), null)
  assert.equal(verifyConsent(signConsent({ expires: Date.now() - 1 })), null)
})
test('dedicated OAuth signing key works independently of legacy login configuration', () => {
  process.env.AUTH_SECRET = 'legacy-short'
  delete process.env.MCP_OAUTH_SECRET
  assert.throws(() => signConsent({ expires: Date.now() + 60000 }), /OAuth signing unavailable/)
  process.env.MCP_OAUTH_SECRET = 'fixture-dedicated-mcp-key-with-at-least-32-characters'
  const signed = signConsent({ expires: Date.now() + 60000, userId: 'fixture' })
  assert.equal(verifyConsent(signed)?.userId, 'fixture')
  process.env.MCP_OAUTH_SECRET = 'fixture-rotated-mcp-key-with-at-least-32-characters'
  assert.equal(verifyConsent(signed), null)
  delete process.env.MCP_OAUTH_SECRET
})
