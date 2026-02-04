import { test, expect } from '@playwright/test'
import { registerAndLogin, screenshot } from './helpers'

test.describe('Settings — Category Management (Complete Flow)', () => {
  test('create and delete categories', async ({ page }) => {
    await registerAndLogin(page)

    // 1. Navigate to settings
    await page.goto('/settings')
    await expect(page.getByText('Categorías')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'settings-categories-01-initial')

    // 2. Create a category
    await page.getByPlaceholder('🍕').fill('🍔')
    await page.getByPlaceholder('Nombre de categoría').fill('Comida')
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
    await expect(page.getByText('Comida')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'settings-categories-02-created-comida')

    // 3. Create a second category
    await page.getByPlaceholder('🍕').fill('🚗')
    await page.getByPlaceholder('Nombre de categoría').fill('Transporte')
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
    await expect(page.getByText('Transporte')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'settings-categories-03-created-transporte')

    // 4. Create a third category
    await page.getByPlaceholder('🍕').fill('🏠')
    await page.getByPlaceholder('Nombre de categoría').fill('Hogar')
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
    await expect(page.getByText('Hogar')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'settings-categories-04-multiple-categories')

    // 5. Delete a category (button uses TrashIcon SVG, triggered via confirm dialog)
    page.on('dialog', dialog => dialog.accept())
    // Find the category row containing "Comida" and click its delete button (last button in that row)
    const comidaRow = page.locator('div').filter({ hasText: /🍔.*Comida/ }).first()
    const deleteBtn = comidaRow.locator('button').last()
    await deleteBtn.click()
    await page.waitForTimeout(1000)
    await screenshot(page, 'settings-categories-05-after-delete')
  })
})
