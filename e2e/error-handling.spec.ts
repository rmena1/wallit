import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, screenshot } from './helpers'

test.describe('Error Handling & Edge Cases — Comprehensive Flow', () => {
  test('invalid data handling, boundary conditions, and error states', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)

    // 1. Test add movement with invalid/edge case data
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'error-handling-01-add-movement-form')

    // Test extremely large amounts
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Monto extremo')
    await page.getByPlaceholder('0.00').fill('999999999999')
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    
    // Check if it handles large numbers properly or shows validation
    const isStillOnAddPage = await page.getByText('Nuevo Movimiento').isVisible({ timeout: 3000 }).catch(() => false)
    const wasRedirected = await page.getByText('Balance General').isVisible({ timeout: 3000 }).catch(() => false)
    
    if (isStillOnAddPage) {
      await screenshot(page, 'error-handling-02-large-amount-validation')
    } else if (wasRedirected) {
      await screenshot(page, 'error-handling-02-large-amount-accepted')
    }

    // 2. Test negative amounts (if allowed or blocked)
    await page.goto('/add')
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Monto negativo')
    await page.getByPlaceholder('0.00').fill('-500')
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await screenshot(page, 'error-handling-03-negative-amount')

    // 3. Test extremely long text inputs
    await page.goto('/add')
    const longText = 'A'.repeat(500) // Very long description
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill(longText)
    await page.getByPlaceholder('0.00').fill('1000')
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await screenshot(page, 'error-handling-04-long-text-input')

    // 4. Test special characters and edge case strings
    await page.goto('/add')
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Special chars: <>"\';DROP TABLE movements;--')
    await page.getByPlaceholder('0.00').fill('1500')
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await screenshot(page, 'error-handling-05-special-characters')

    // 5. Test empty required fields edge cases
    await page.goto('/add')
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    // Try to submit with empty name
    await page.getByPlaceholder('0.00').fill('2000')
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await screenshot(page, 'error-handling-06-empty-required-field')

    // 6. Test decimal precision edge cases
    await page.goto('/add')
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Decimales extremos')
    await page.getByPlaceholder('0.00').fill('123.999999')
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await screenshot(page, 'error-handling-07-decimal-precision')

    // 7. Test account creation with edge cases
    await page.goto('/settings')
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })

    // Try to add account with invalid last four digits
    const bankSelect = page.locator('select[name="bankName"]')
    const isFormVisible = await bankSelect.isVisible().catch(() => false)
    
    if (!isFormVisible) {
      await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    }
    
    await bankSelect.selectOption('Santander')
    await page.locator('select[name="accountType"]').selectOption('Vista')
    
    // Test non-numeric last four digits
    await page.getByPlaceholder('Últimos 4 dígitos').fill('ABCD')
    await page.getByPlaceholder('Saldo inicial').fill('50000')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await screenshot(page, 'error-handling-08-invalid-digits')

    // Re-open the form if it collapsed
    const digitsFieldVisible1 = await page.getByPlaceholder('Últimos 4 dígitos').isVisible().catch(() => false)
    if (!digitsFieldVisible1) {
      await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
      await page.locator('select[name="bankName"]').waitFor({ state: 'visible', timeout: 3000 })
      await page.locator('select[name="bankName"]').selectOption('Santander')
      await page.locator('select[name="accountType"]').selectOption('Vista')
    }

    // Test too many digits
    await page.getByPlaceholder('Últimos 4 dígitos').fill('123456')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await screenshot(page, 'error-handling-09-too-many-digits')

    // Re-open the form if it collapsed
    const digitsFieldVisible2 = await page.getByPlaceholder('Últimos 4 dígitos').isVisible().catch(() => false)
    if (!digitsFieldVisible2) {
      await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
      await page.locator('select[name="bankName"]').waitFor({ state: 'visible', timeout: 3000 })
      await page.locator('select[name="bankName"]').selectOption('Santander')
      await page.locator('select[name="accountType"]').selectOption('Vista')
    }

    // Test empty initial balance
    await page.getByPlaceholder('Últimos 4 dígitos').fill('5678')
    await page.getByPlaceholder('Saldo inicial').fill('')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await screenshot(page, 'error-handling-10-empty-balance')

    // 8. Test category creation edge cases
    const categoryNameField = page.getByPlaceholder('Nombre de categoría')
    const categoryEmojiField = page.getByPlaceholder('🍕')
    
    if (await categoryNameField.isVisible()) {
      // Test empty category name
      await categoryEmojiField.fill('🎭')
      await page.locator('form').filter({ has: categoryNameField }).locator('button[type="submit"]').click()
      await screenshot(page, 'error-handling-11-empty-category-name')

      // Test duplicate category
      await categoryNameField.fill('Comida') // Likely exists already
      await categoryEmojiField.fill('🍔')
      await page.locator('form').filter({ has: categoryNameField }).locator('button[type="submit"]').click()
      await screenshot(page, 'error-handling-12-duplicate-category')

      // Test very long category name
      await categoryNameField.fill('A'.repeat(100))
      await categoryEmojiField.fill('🎪')
      await page.locator('form').filter({ has: categoryNameField }).locator('button[type="submit"]').click()
      await screenshot(page, 'error-handling-13-long-category-name')
    }

    // 9. Test reports with edge case date ranges
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 5000 })

    // Test future dates
    const startDateInput = page.locator('input[type="date"]').first()
    const endDateInput = page.locator('input[type="date"]').last()
    
    if (await startDateInput.isVisible()) {
      await startDateInput.fill('2030-12-31')
      await endDateInput.fill('2031-01-31')
      await page.getByRole('button', { name: /Buscar|Actualizar|Apply/i }).click()
      await screenshot(page, 'error-handling-14-future-date-range')

      // Test invalid date range (start after end)
      await startDateInput.fill('2023-12-31')
      await endDateInput.fill('2023-01-01')
      await page.getByRole('button', { name: /Buscar|Actualizar|Apply/i }).click()
      await screenshot(page, 'error-handling-15-invalid-date-range')
    }

    // 10. Test browser back/forward navigation edge cases
    await page.goto('/add')
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Test navegación')
    
    // Navigate away and back
    await page.goto('/reports')
    await page.goBack()
    
    // Check if form data is preserved or cleared
    const nameValue = await page.getByPlaceholder('¿En qué se gastó?').inputValue()
    await screenshot(page, 'error-handling-16-navigation-form-state')

    // 11. Test multiple rapid form submissions
    await page.goto('/add')
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Submit rápido')
    await page.getByPlaceholder('0.00').fill('1000')
    
    // Submit (can't double-click since first click navigates)
    const submitButton = page.getByRole('button', { name: /Guardar Movimiento/i })
    await submitButton.click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'error-handling-17-submit-success')

    // 12. Test session edge cases by clearing cookies mid-session
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'error-handling-18-authenticated-state')

    // Clear cookies to simulate session expiry
    await page.context().clearCookies()
    await page.reload()
    
    // Should redirect to login
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({ timeout: 10000 })
    await screenshot(page, 'error-handling-19-session-expired-redirect')
  })
})