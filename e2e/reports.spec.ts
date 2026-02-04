import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, ensureCategory, createMovement, screenshot } from './helpers'

test.describe('Reports — Complete Flow', () => {
  test('empty state then populated reports with date presets and filters', async ({ page }) => {
    // 1. Start with a fresh user to test empty state first
    const freshEmail = `reports-${Date.now()}@wallit.app`
    await page.goto('/register')
    await page.getByLabel('Email').fill(freshEmail)
    await page.getByLabel('Password').fill('testpass123')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL('**/', { timeout: 10000 })

    // 2. Navigate to reports with no data (empty state)
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'reports-01-empty-state')

    // 3. Set up account and category
    await ensureAccount(page)
    await ensureCategory(page, '🍔', 'Comida')

    // 4. Create movements to have data
    await createMovement(page, { name: 'Almuerzo rápido', amount: '12000' })
    await createMovement(page, { name: 'Cena', amount: '18000' })
    await createMovement(page, { name: 'Freelance', amount: '500000', type: 'income' })

    // 5. Navigate to reports again, now with data
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'reports-02-with-data')

    // 6. Check summary cards are visible (use exact to avoid ambiguity with chart headings)
    await expect(page.getByText('Ingresos', { exact: true })).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Neto')).toBeVisible()
    await screenshot(page, 'reports-03-summary-cards')

    // 7. Check charts are rendered
    await expect(page.getByRole('heading', { name: '📉 Gastos' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '📈 Ingresos' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '💰 Balance' })).toBeVisible()
    await screenshot(page, 'reports-04-charts-visible')

    // 8. Open date picker
    await page.locator('button').filter({ hasText: '📅' }).click()
    await expect(page.getByRole('button', { name: 'Últimos 7 días' })).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'reports-05-date-picker-open')

    // 9. Select a different preset
    await page.getByRole('button', { name: 'Últimos 30 días' }).click()
    await screenshot(page, 'reports-06-last-30-days')

    // 10. Check category spending section
    await expect(page.getByText('Gastos por Categoría')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'reports-07-category-spending')

    // 11. Check total movements count
    await expect(page.getByText('Total movimientos')).toBeVisible()
    await screenshot(page, 'reports-08-movement-count')

    // 12. Test "Este mes" preset
    await page.locator('button').filter({ hasText: '📅' }).click()
    await page.getByRole('button', { name: 'Este mes' }).click()
    await screenshot(page, 'reports-09-this-month')
  })
})
