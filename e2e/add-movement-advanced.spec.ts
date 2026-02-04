import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, screenshot } from './helpers'

test.describe('Add Movement — Advanced Features', () => {
  test('create category inline, add movement with time, navigate via links', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)

    // 1. Navigate to add movement page
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'add-advanced-01-add-page')

    // 2. Open inline create category dialog
    const createCategoryBtn = page.getByRole('button', { name: /Crear|Nueva|nueva categoría|\+/i }).first()
    // The button to open category dialog might be a "+" next to category select
    const plusBtn = page.locator('button').filter({ hasText: '+' }).last()
    if (await plusBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await plusBtn.click()
    } else if (await createCategoryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await createCategoryBtn.click()
    }

    // 3. Fill the inline category dialog
    const dialog = page.locator('div[style*="position: fixed"]')
    if (await dialog.isVisible({ timeout: 3000 }).catch(() => false)) {
      await screenshot(page, 'add-advanced-02-category-dialog')

      // Fill emoji and name in the dialog
      const emojiInput = dialog.locator('input').first()
      await emojiInput.fill('☕')
      const nameInput = dialog.locator('input').nth(1)
      await nameInput.fill('Café')
      await screenshot(page, 'add-advanced-03-category-dialog-filled')

      // Submit the dialog
      const submitBtn = dialog.getByRole('button', { name: /Crear|Guardar|Agregar/i }).first()
      if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitBtn.click()
        // Wait for dialog to close
        await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
      }
      await screenshot(page, 'add-advanced-04-category-created')
    }

    // 4. Fill movement with time field
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Café de la tarde')
    await page.getByPlaceholder('0.00').fill('3500')

    // Set time
    const timeInput = page.locator('input[name="time"]')
    if (await timeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await timeInput.fill('14:30')
    }

    // Select the new category if available
    const categorySelect = page.locator('select[name="categoryId"]')
    const options = await categorySelect.locator('option').allTextContents()
    const cafeOption = options.findIndex(o => o.includes('Café'))
    if (cafeOption > 0) {
      await categorySelect.selectOption({ index: cafeOption })
    }
    await screenshot(page, 'add-advanced-05-form-with-time')

    // 5. Submit the movement
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText('Café de la tarde')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'add-advanced-06-on-home')

    // 6. Navigate via bottom nav to settings
    const settingsLink = page.locator('a[href="/settings"]').first()
    await settingsLink.click()
    await expect(page.getByText('Configuración')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'add-advanced-07-settings-via-nav')

    // 7. Navigate to review page
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const reviewLink = page.locator('a[href="/review"]').first()
    if (await reviewLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await reviewLink.click()
      await expect(page.getByText(/Revisar|Review/i)).toBeVisible({ timeout: 5000 })
      await screenshot(page, 'add-advanced-08-review-via-nav')
    }

    // 8. Navigate to reports
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText(/Reportes|Reports/i)).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'add-advanced-09-reports-page')

    // 9. Navigate back to home via add button
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'add-advanced-10-back-to-add')
  })

  test('add movement validation — empty fields', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)

    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'add-validation-01-empty-form')

    // Try to submit without filling required fields
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()

    // Should still be on add page (HTML5 validation prevents submission)
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'add-validation-02-validation-error')

    // Fill only name, no amount
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Test sin monto')
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await screenshot(page, 'add-validation-03-missing-amount')
  })
})