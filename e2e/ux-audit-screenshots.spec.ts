import { test } from '@playwright/test'
import { screenshot } from './helpers'

const MOBILE_EMAIL = `ux-mobile-${Date.now()}@wallit.app`
const MOBILE_PASS = 'testpass123'

test.describe('UX Audit Screenshots', () => {
  test('capture mobile views', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
    })
    const page = await context.newPage()

    // Login page mobile
    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'ux-mobile-login')

    // Register new user for mobile
    await page.goto('/register')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'ux-mobile-register')
    await page.getByLabel('Email').fill(MOBILE_EMAIL)
    await page.getByLabel('Password').fill(MOBILE_PASS)
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL('**/', { timeout: 10000 })

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'ux-mobile-home')

    await page.goto('/add')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'ux-mobile-add')

    await page.goto('/reports')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'ux-mobile-reports')

    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'ux-mobile-settings')

    await context.close()
  })
})
