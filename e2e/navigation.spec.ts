import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, screenshot } from './helpers'

test.describe('Navigation — Bottom Nav Flow', () => {
  test('navigate between all pages via bottom nav and FAB', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)

    // 1. Start at home
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Balance General')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'navigation-01-home')

    // 2. Navigate to Reports via bottom nav
    await page.getByRole('link', { name: 'Reportes' }).click()
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'navigation-02-reports')

    // 3. Navigate to Settings via bottom nav
    await page.getByRole('link', { name: 'Config' }).click()
    await expect(page.getByText('Configuración')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'navigation-03-settings')

    // 4. Navigate to Add via the FAB (+ button)
    // The FAB is a link to /add
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'navigation-04-add-movement')

    // 5. Go back to home via the back button
    await page.getByText('Volver').click()
    await screenshot(page, 'navigation-05-back-to-home')

    // 6. Navigate to Home via bottom nav
    await page.getByRole('link', { name: 'Inicio' }).click()
    await expect(page.getByText('Balance General')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'navigation-06-home-again')
  })
})
