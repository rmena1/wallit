import { defineConfig, devices } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_DATABASE_URL = 'postgresql://127.0.0.1:5432/wallit_e2e'
const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
const cachedLdPathFile = join(homedir(), '.cache/wallit-playwright-libs/LD_LIBRARY_PATH')

if (existsSync(cachedLdPathFile)) {
  const cachedLdPath = readFileSync(cachedLdPathFile, 'utf8').trim()
  process.env.LD_LIBRARY_PATH = [cachedLdPath, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
}

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e-results',
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  webServer: {
    command: 'npm run e2e:server',
    url: 'http://localhost:3001',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: databaseUrl,
      LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH ?? '',
    },
  },
  use: {
    baseURL: 'http://localhost:3001',
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
  workers: 1,
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  reporter: [
    ['list'],
    ['html', { outputFolder: './e2e-report', open: 'never' }],
  ],
})
