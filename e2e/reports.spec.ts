import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, ensureCategory, createMovement, screenshot } from './helpers'

test.describe('Reports — Complete Flow', () => {
  test('view reports with data, use date presets and filters', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)
    await ensureCategory(page, '🍔', 'Comida')

    // Create movements to have data
    await createMovement(page, { name: 'Almuerzo rápido', amount: '12000' })
    await createMovement(page, { name: 'Cena', amount: '18000' })
    await createMovement(page, { name: 'Freelance', amount: '500000', type: 'income' })

    // 1. Navigate to reports
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'reports-01-initial')

    // 2. Check summary cards are visible (use exact to avoid ambiguity with chart headings)
    await expect(page.getByText('Ingresos', { exact: true })).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Neto')).toBeVisible()
    await screenshot(page, 'reports-02-summary-cards')

    // 3. Check charts are rendered
    await expect(page.getByRole('heading', { name: '📉 Gastos' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '📈 Ingresos' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '💰 Balance' })).toBeVisible()
    await screenshot(page, 'reports-03-charts-visible')

    // 4. Open date picker
    await page.locator('button').filter({ hasText: '📅' }).click()
    await expect(page.getByRole('button', { name: 'Últimos 7 días' })).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'reports-04-date-picker-open')

    // 5. Select a different preset
    await page.getByRole('button', { name: 'Últimos 30 días' }).click()
    await screenshot(page, 'reports-05-last-30-days')

    // 6. Check category spending section
    await expect(page.getByText('Gastos por Categoría')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'reports-06-category-spending')

    // 7. Check total movements count
    await expect(page.getByText('Total movimientos')).toBeVisible()
    await screenshot(page, 'reports-07-movement-count')
  })

  test('reports empty state', async ({ page }) => {
    // Register a fresh user with no data
    const freshEmail = `reports-empty-${Date.now()}@wallit.app`
    await page.goto('/register')
    await page.getByLabel('Email').fill(freshEmail)
    await page.getByLabel('Password').fill('testpass123')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL('**/', { timeout: 10000 })

    // Navigate to reports with no data
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'reports-09-empty-state')
  })
})
