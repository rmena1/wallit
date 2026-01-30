import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, createMovement, screenshot } from './helpers'

test.describe('Home Dashboard — Complete Flow', () => {
  test('empty state, then with accounts and movements', async ({ page }) => {
    await registerAndLogin(page)

    // 1. Empty state — no accounts
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Balance General')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'home-dashboard-01-empty-state')

    // Check empty state message
    const noAccounts = await page.getByText('Sin cuentas').isVisible().catch(() => false)
    if (noAccounts) {
      await expect(page.getByText('Agrega una cuenta bancaria')).toBeVisible()
      await screenshot(page, 'home-dashboard-02-no-accounts-message')
    }

    // 2. Set up account and category
    await ensureAccount(page)

    // 3. Home with account but no movements
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Cuentas')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('BCI', { exact: true })).toBeVisible()
    await screenshot(page, 'home-dashboard-03-with-account')

    // 4. Create some movements
    await createMovement(page, { name: 'Café de la mañana', amount: '3500' })
    await createMovement(page, { name: 'Uber al trabajo', amount: '8000' })
    await createMovement(page, { name: 'Sueldo', amount: '1500000', type: 'income' })

    // 5. Verify movements on home
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Café de la mañana')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Uber al trabajo')).toBeVisible()
    await expect(page.getByText('Sueldo')).toBeVisible()
    await screenshot(page, 'home-dashboard-04-with-movements')

    // 6. Check balance info is displayed
    await expect(page.getByText('Balance General')).toBeVisible()
    await expect(page.getByText('Ingresos')).toBeVisible()
    await expect(page.getByText('Gastos')).toBeVisible()
    await screenshot(page, 'home-dashboard-05-balance-info')

    // 7. Test "Por cobrar" filter button
    await page.getByRole('button', { name: /Por cobrar/i }).click()
    await screenshot(page, 'home-dashboard-06-receivable-filter')

    // Toggle back
    await page.getByRole('button', { name: /Por cobrar/i }).click()
    await screenshot(page, 'home-dashboard-07-filter-off')

    // 8. Test logout
    await page.getByRole('button', { name: 'Salir' }).click()
    await page.waitForURL(/\/login/, { timeout: 10000 })
    await screenshot(page, 'home-dashboard-08-logged-out')
  })
})
