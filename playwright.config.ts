import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e-results',
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:3002',
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
      },
    },
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
