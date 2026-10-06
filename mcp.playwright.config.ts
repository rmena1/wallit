import { defineConfig } from '@playwright/test'

const databaseUrl = process.env.MCP_TEST_DATABASE_URL ?? 'postgresql://127.0.0.1:55432/wallit_mcp_test'
const url = new URL(databaseUrl)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^wallit_mcp_test(?:_[a-z0-9_]+)?$/.test(url.pathname.slice(1))) throw new Error('MCP tests require a disposable local wallit_mcp_test database')
process.env.MCP_TEST_DATABASE_URL = databaseUrl
export default defineConfig({
  testDir: './e2e', testMatch: 'mcp.spec.ts', outputDir: '/tmp/wallit-mcp-playwright-results',
  workers: 1, fullyParallel: false, timeout: 90_000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3217', trace: 'off' },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3217', url: 'http://127.0.0.1:3217/api/health', reuseExistingServer: false, timeout: 120_000,
    env: { DATABASE_URL: databaseUrl, MCP_ORIGIN: 'http://127.0.0.1:3217', AUTH_SECRET: 'mcp-fixture-signing-secret-for-local-tests-only' },
  },
})
