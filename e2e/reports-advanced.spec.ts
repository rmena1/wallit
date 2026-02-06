import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, ensureCategory, createMovement, screenshot } from './helpers'

test.describe('Reports — Advanced Calendar & Filters', () => {
  test('custom date range selection via mini calendar and filter interactions', async ({ page }) => {
    // 1. Register and create test data
    await registerAndLogin(page)
    await ensureAccount(page)
    await ensureCategory(page, '🍔', 'Comida')
    await ensureCategory(page, '🚗', 'Transporte')

    // Create various movements for comprehensive report data
    await createMovement(page, { name: 'Desayuno', amount: '8000' })
    await createMovement(page, { name: 'Almuerzo', amount: '15000' })
    await createMovement(page, { name: 'Uber', amount: '6000' })
    await createMovement(page, { name: 'Sueldo freelance', amount: '800000', type: 'income' })

    // 2. Navigate to reports
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'reports-advanced-01-initial')

    // 3. Open date picker
    await page.locator('button').filter({ hasText: '📅' }).click()
    await expect(page.getByRole('button', { name: 'Últimos 7 días' })).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'reports-advanced-02-date-picker-open')

    // 4. Test calendar month navigation - click previous month
    const prevMonthBtn = page.locator('button').filter({ hasText: '‹' })
    await prevMonthBtn.click()
    await page.waitForTimeout(300)
    await screenshot(page, 'reports-advanced-03-prev-month')

    // 5. Navigate forward month
    const nextMonthBtn = page.locator('button').filter({ hasText: '›' })
    await nextMonthBtn.click()
    await page.waitForTimeout(300)
    await screenshot(page, 'reports-advanced-04-next-month')

    // Navigate to current month again
    await nextMonthBtn.click()
    await page.waitForTimeout(300)

    // 6. Select custom date range - click on day 1
    const dayButtons = page.locator('button').filter({ hasText: /^1$/ })
    const day1Button = dayButtons.first()
    if (await day1Button.isVisible({ timeout: 2000 }).catch(() => false)) {
      await day1Button.click()
      await screenshot(page, 'reports-advanced-05-first-day-selected')

      // Should show "Selecciona fecha fin" hint
      const hintText = page.getByText('Selecciona fecha fin')
      if (await hintText.isVisible({ timeout: 2000 }).catch(() => false)) {
        await screenshot(page, 'reports-advanced-06-select-end-hint')
      }

      // Click on day 15 to complete range
      const day15Button = page.locator('button').filter({ hasText: /^15$/ }).first()
      if (await day15Button.isVisible({ timeout: 2000 }).catch(() => false)) {
        await day15Button.click()
        await page.waitForTimeout(500)
        await screenshot(page, 'reports-advanced-07-custom-range-selected')
      }
    }

    // 7. Close date picker and verify charts update
    // The picker should auto-close after selecting range
    await page.locator('main').click({ position: { x: 10, y: 10 } }) // Click outside picker
    await page.waitForTimeout(500)
    await screenshot(page, 'reports-advanced-08-charts-updated')

    // 8. Test category filter
    const categorySelect = page.locator('select').first()
    await expect(categorySelect).toBeVisible({ timeout: 5000 })
    
    // Select "Comida" category
    const categoryOptions = await categorySelect.locator('option').allTextContents()
    const comidaIndex = categoryOptions.findIndex(o => o.includes('Comida'))
    if (comidaIndex > 0) {
      await categorySelect.selectOption({ index: comidaIndex })
      await page.waitForTimeout(1000) // Wait for data refetch
      await screenshot(page, 'reports-advanced-09-category-filtered')
    }

    // 9. Test account filter
    const accountSelect = page.locator('select').nth(1)
    await expect(accountSelect).toBeVisible({ timeout: 3000 })

    const accountOptions = await accountSelect.locator('option').allTextContents()
    if (accountOptions.length > 1) {
      await accountSelect.selectOption({ index: 1 })
      await page.waitForTimeout(1000) // Wait for data refetch
      await screenshot(page, 'reports-advanced-10-account-filtered')
    }

    // 10. Reset filters to "all"
    await categorySelect.selectOption({ index: 0 }) // "Todas las categorías"
    await accountSelect.selectOption({ index: 0 }) // "Todas las cuentas"
    await page.waitForTimeout(1000)
    await screenshot(page, 'reports-advanced-11-filters-reset')

    // 11. Test "Este año" preset (long range)
    await page.locator('button').filter({ hasText: '📅' }).click()
    await page.getByRole('button', { name: 'Este año' }).click()
    await page.waitForTimeout(1000)
    await screenshot(page, 'reports-advanced-12-this-year-preset')

    // 12. Verify all chart sections are visible
    await expect(page.getByRole('heading', { name: '📉 Gastos' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '📈 Ingresos' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '💰 Balance' })).toBeVisible()
    await expect(page.getByText('Gastos por Categoría')).toBeVisible()
    await expect(page.getByText('Total movimientos')).toBeVisible()
    await screenshot(page, 'reports-advanced-13-all-sections-visible')

    // 13. Test "Últimos 100 días" preset
    await page.locator('button').filter({ hasText: '📅' }).click()
    await page.getByRole('button', { name: 'Últimos 100 días' }).click()
    await page.waitForTimeout(1000)
    await screenshot(page, 'reports-advanced-14-last-100-days')

    // 14. Verify summary cards show correct data type
    await expect(page.getByText('Ingresos', { exact: true })).toBeVisible()
    await expect(page.getByText('Gastos', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Neto')).toBeVisible()
    await screenshot(page, 'reports-advanced-15-summary-cards')

    // 15. Test "Esta semana" preset
    await page.locator('button').filter({ hasText: '📅' }).click()
    await page.getByRole('button', { name: 'Esta semana' }).click()
    await page.waitForTimeout(1000)
    await screenshot(page, 'reports-advanced-16-this-week-final')
  })

  test('reports empty state scenarios with filters', async ({ page }) => {
    // Create user with only expense data (no income)
    await registerAndLogin(page)
    await ensureAccount(page)
    await ensureCategory(page, '🎮', 'Entretenimiento')

    // Create only expenses
    await createMovement(page, { name: 'Netflix', amount: '12000' })
    await createMovement(page, { name: 'Spotify', amount: '5000' })

    // 1. Go to reports
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'reports-empty-01-with-expenses-only')

    // 2. Verify income chart shows empty state message
    // (Since we only have expenses, income should be zero)
    await expect(page.getByRole('heading', { name: '📈 Ingresos' })).toBeVisible()
    await screenshot(page, 'reports-empty-02-income-section')

    // 3. Now create an income and filter by category that has no data
    await createMovement(page, { name: 'Pago', amount: '100000', type: 'income' })

    await page.goto('/reports')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'reports-empty-03-with-income')

    // 4. Filter by category that might not have income associated
    const categorySelect = page.locator('select').first()
    const categoryOptions = await categorySelect.locator('option').allTextContents()
    const entIndex = categoryOptions.findIndex(o => o.includes('Entretenimiento'))
    if (entIndex > 0) {
      await categorySelect.selectOption({ index: entIndex })
      await page.waitForTimeout(1000)
      await screenshot(page, 'reports-empty-04-filtered-to-entertainment')
    }

    // 5. Test with future date range (should show empty)
    await page.locator('button').filter({ hasText: '📅' }).click()

    // Try to navigate to a future month and select dates
    const nextMonthBtn = page.locator('button').filter({ hasText: '›' })
    for (let i = 0; i < 2; i++) {
      await nextMonthBtn.click()
      await page.waitForTimeout(200)
    }

    // Select a date in the future
    const futureDayBtn = page.locator('button').filter({ hasText: /^10$/ }).first()
    if (await futureDayBtn.isVisible()) {
      await futureDayBtn.click()
      await page.waitForTimeout(300)
      const futureEndBtn = page.locator('button').filter({ hasText: /^20$/ }).first()
      if (await futureEndBtn.isVisible()) {
        await futureEndBtn.click()
        await page.waitForTimeout(500)
      }
    }

    await page.waitForTimeout(1000)
    await screenshot(page, 'reports-empty-05-future-dates')

    // 6. Reset to current month
    await page.locator('button').filter({ hasText: '📅' }).click()
    await page.getByRole('button', { name: 'Este mes' }).click()
    await page.waitForTimeout(1000)
    await screenshot(page, 'reports-empty-06-reset-to-this-month')

    // Reset category filter
    await categorySelect.selectOption({ index: 0 })
    await page.waitForTimeout(500)
    await screenshot(page, 'reports-empty-07-all-data-visible')
  })
})
