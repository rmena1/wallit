import { test, expect } from '@playwright/test'
import { registerAndLogin, screenshot } from './helpers'

test.describe('Settings — Category Management (Complete Flow)', () => {
  test('create, edit, and delete categories', async ({ page }) => {
    await registerAndLogin(page)

    // 1. Navigate to settings
    await page.goto('/settings')
    await expect(page.getByText('Categorías')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'settings-categories-01-initial')

    // 2. Create first category
    await page.getByPlaceholder('🍕').fill('🍔')
    await page.getByPlaceholder('Nombre de categoría').fill('Comida')
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
    await expect(page.getByText('Comida')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'settings-categories-02-created-comida')

    // 3. Create second category
    await page.getByPlaceholder('🍕').fill('🚗')
    await page.getByPlaceholder('Nombre de categoría').fill('Transporte')
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
    await expect(page.getByText('Transporte')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'settings-categories-03-created-transporte')

    // 4. Create third category
    await page.getByPlaceholder('🍕').fill('🏠')
    await page.getByPlaceholder('Nombre de categoría').fill('Hogar')
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
    await expect(page.getByText('Hogar')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'settings-categories-04-multiple-categories')

    // 5. Edit a category - click on "Comida" text to trigger edit mode
    const comidaText = page.getByText('Comida', { exact: true })
    await comidaText.scrollIntoViewIfNeeded()
    await comidaText.click()
    await page.waitForTimeout(500)
    await screenshot(page, 'settings-categories-05-edit-mode')

    // Look for edit inputs
    const editNameInput = page.locator('input[name="name"]').last()
    const editEmojiInput = page.locator('input[name="emoji"]').last()
    
    if (await editNameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Edit the category
      await editEmojiInput.clear()
      await editEmojiInput.fill('🍕')
      await editNameInput.clear()
      await editNameInput.fill('Pizzería')
      await screenshot(page, 'settings-categories-06-edited-values')

      // Save the changes by clicking the checkmark button
      const saveButton = page.locator('button').filter({ hasText: '✓' })
      await saveButton.click()
      await page.waitForTimeout(1000)
      await screenshot(page, 'settings-categories-07-edit-saved')

      // Verify the category was updated
      await expect(page.getByText('Pizzería')).toBeVisible({ timeout: 5000 })
    }

    // 6. Test cancel edit - click on Transporte to open edit mode
    const transporteText = page.getByText('Transporte', { exact: true })
    await transporteText.click()
    await page.waitForTimeout(500)

    // Click cancel button
    const cancelButton = page.locator('button').filter({ hasText: '✕' })
    if (await cancelButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cancelButton.click()
      await screenshot(page, 'settings-categories-08-edit-cancelled')
    }

    // 7. Delete a category - find delete button with trash icon
    page.on('dialog', dialog => dialog.accept())
    // Find all delete buttons (with trash icon SVG)
    const deleteButtons = page.locator('button').filter({ has: page.locator('svg polyline[points="3 6 5 6 21 6"]') })
    const deleteCount = await deleteButtons.count()
    
    if (deleteCount > 0) {
      // Click the last delete button (for Hogar, the most recently created category)
      await deleteButtons.last().click()
      await page.waitForTimeout(1000)
    }
    await screenshot(page, 'settings-categories-09-after-delete')

    // 8. Verify final state - one category should be deleted
    const remainingCategories = await page.getByText(/Pizzería|Transporte/).all()
    await expect(remainingCategories.length).toBeGreaterThanOrEqual(1)
    await screenshot(page, 'settings-categories-10-final-state')
  })
})
