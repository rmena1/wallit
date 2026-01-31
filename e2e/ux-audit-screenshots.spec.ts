import { test, expect } from '@playwright/test'
import { screenshot, ensureAccount } from './helpers'

const MOBILE_EMAIL = `ux-mobile-${Date.now()}@wallit.app`
const MOBILE_PASS = 'testpass123'

test.describe('UX Audit Screenshots', () => {
  test('capture mobile views with basic assertions', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
    })
    const page = await context.newPage()

    // Login page mobile
    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await screenshot(page, 'ux-mobile-login')

    // Register page mobile
    await page.goto('/register')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
    await screenshot(page, 'ux-mobile-register')

    // Register new user
    await page.getByLabel('Email').fill(MOBILE_EMAIL)
    await page.getByLabel('Password').fill(MOBILE_PASS)
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL('**/', { timeout: 10000 })

    // Home mobile — set up account so all pages work
    await ensureAccount(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible()
    await screenshot(page, 'ux-mobile-home')

    // Add movement mobile
    await page.goto('/add')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'ux-mobile-add')

    // Reports mobile
    await page.goto('/reports')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible()
    await screenshot(page, 'ux-mobile-reports')

    // Settings mobile
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Configuración')).toBeVisible()
    await screenshot(page, 'ux-mobile-settings')

    await context.close()
  })
})
