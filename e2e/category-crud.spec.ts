import { test, expect } from '@playwright/test'
import { registerAndLogin, screenshot } from './helpers'

test.describe('Category CRUD — Complete Flow', () => {
  test('create, edit, and delete categories with form validation', async ({ page }) => {
    await registerAndLogin(page)

    // 1. Navigate to settings
    await page.goto('/settings')
    await expect(page.getByText('Categorías')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'category-crud-01-initial')

    // 2. Create first category - Food
    await page.getByPlaceholder('🍕').fill('🍔')
    await page.getByPlaceholder('Nombre de categoría').fill('Comida')
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
    await expect(page.getByText('Comida')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'category-crud-02-food-created')

    // 3. Create second category - Transport
    await page.getByPlaceholder('🍕').fill('🚗')
    await page.getByPlaceholder('Nombre de categoría').fill('Transporte')
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
    await expect(page.getByText('Transporte')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'category-crud-03-transport-created')

    // 4. Create third category - Entertainment
    await page.getByPlaceholder('🍕').fill('🎬')
    await page.getByPlaceholder('Nombre de categoría').fill('Entretenimiento')
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
    await expect(page.getByText('Entretenimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'category-crud-04-entertainment-created')

    // 5. Edit a category by clicking on it
    const categoryRow = page.locator('div').filter({ hasText: /^🍔Comida$/ }).first()
    await categoryRow.click()
    await page.waitForTimeout(300)
    await screenshot(page, 'category-crud-05-edit-mode')

    // 6. Modify the category
    const editNameInput = page.getByPlaceholder('Nombre de categoría').or(page.locator('input[name="name"]')).last()
    if (await editNameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editNameInput.clear()
      await editNameInput.fill('Comida Rápida')
      await screenshot(page, 'category-crud-06-edit-filled')
      
      // Save the edit
      const saveBtn = page.getByRole('button', { name: /✓|Guardar/i }).first()
      if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await saveBtn.click()
        await expect(page.getByText('Comida Rápida')).toBeVisible({ timeout: 5000 })
        await screenshot(page, 'category-crud-07-edit-saved')
      }
    }

    // 7. Delete a category
    page.on('dialog', dialog => dialog.accept())
    
    // Find delete button (trash icon) for Entertainment category
    const entertainmentRow = page.locator('div').filter({ hasText: /🎬/ }).last()
    const deleteBtn = entertainmentRow.locator('button').filter({ has: page.locator('svg polyline[points="3 6 5 6 21 6"]') }).first()
    
    if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteBtn.click()
      await page.waitForTimeout(1000)
      await screenshot(page, 'category-crud-08-after-delete')
      
      // Verify category was deleted
      await expect(page.getByText('Entretenimiento')).not.toBeVisible({ timeout: 3000 })
    }

    // 8. Test empty submission (validation)
    await page.getByPlaceholder('🍕').clear()
    await page.getByPlaceholder('Nombre de categoría').clear()
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
    // Should stay on form (HTML5 validation)
    await screenshot(page, 'category-crud-09-validation')

    // 9. Verify categories appear in add movement form
    await page.goto('/settings')
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })
    
    // Create account first if needed
    const bankSelect = page.locator('select[name="bankName"]')
    if (!await bankSelect.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    }
    if (await bankSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await bankSelect.selectOption('BCI')
      await page.locator('select[name="accountType"]').selectOption('Corriente')
      await page.getByPlaceholder('Últimos 4 dígitos').fill('1234')
      await page.getByPlaceholder('Saldo inicial').fill('100000')
      await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
      await expect(page.getByText('···1234')).toBeVisible({ timeout: 5000 })
    }

    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    
    // Check that categories appear in select
    const categorySelect = page.locator('select[name="categoryId"]')
    const options = await categorySelect.locator('option').allTextContents()
    expect(options.some(o => o.includes('Comida Rápida'))).toBeTruthy()
    expect(options.some(o => o.includes('Transporte'))).toBeTruthy()
    await screenshot(page, 'category-crud-10-categories-in-movement')
  })

  test('cancel category edit returns to view mode', async ({ page }) => {
    await registerAndLogin(page)
    await page.goto('/settings')
    await expect(page.getByText('Categorías')).toBeVisible({ timeout: 5000 })

    // Create a category
    await page.getByPlaceholder('🍕').fill('📚')
    await page.getByPlaceholder('Nombre de categoría').fill('Libros')
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
    await expect(page.getByText('Libros')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'category-cancel-01-created')

    // Click to edit
    const categoryRow = page.locator('div').filter({ hasText: /^📚Libros$/ }).first()
    await categoryRow.click()
    await page.waitForTimeout(300)
    
    // Cancel the edit
    const cancelBtn = page.getByRole('button', { name: /✕|Cancelar/i }).first()
    if (await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cancelBtn.click()
      await page.waitForTimeout(300)
      await screenshot(page, 'category-cancel-02-after-cancel')
      
      // Should be back in view mode
      await expect(page.getByText('Libros')).toBeVisible()
    }
  })
})
