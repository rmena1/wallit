import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, ensureCategory, screenshot } from './helpers'

test.describe('Movement CRUD — Complete Flow', () => {
  test('create expense, verify on home, edit it, then delete', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)
    await ensureCategory(page, '🍔', 'Comida')

    // 1. Navigate to add movement
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'movement-crud-01-add-page')

    // 2. Fill expense form
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Almuerzo en restaurante')
    await page.getByPlaceholder('0.00').fill('15000')
    // Select category
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 })
    await screenshot(page, 'movement-crud-02-form-filled')

    // 3. Submit
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText('Almuerzo en restaurante')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'movement-crud-03-expense-on-home')

    // 4. Click movement to edit
    await page.getByText('Almuerzo en restaurante').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'movement-crud-04-edit-page')

    // 5. Change description and amount
    const descInput = page.locator('input').filter({ hasText: '' }).first()
    // Use the description input which has the value
    await page.locator('input[value="Almuerzo en restaurante"]').fill('Almuerzo editado')
    await screenshot(page, 'movement-crud-05-edited-fields')

    // 6. Save changes
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText('Almuerzo editado')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'movement-crud-06-after-edit')

    // 7. Delete the movement from home
    page.on('dialog', dialog => dialog.accept())
    const movementRow = page.locator('div').filter({ hasText: 'Almuerzo editado' }).first()
    // Click the trash icon button (last button in the row)
    await movementRow.locator('button').last().click()
    await expect(page.getByText('Almuerzo editado')).not.toBeVisible({ timeout: 5000 })
    await screenshot(page, 'movement-crud-07-after-delete')
  })

  test('create income movement', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)

    // 1. Go to add page
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })

    // 2. Switch to income
    await page.getByText('↑ Ingreso').click()
    await screenshot(page, 'movement-crud-08-income-selected')

    // 3. Fill income form
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Sueldo mensual')
    await page.getByPlaceholder('0.00').fill('2000000')
    await screenshot(page, 'movement-crud-09-income-filled')

    // 4. Submit
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText('Sueldo mensual')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'movement-crud-10-income-on-home')
  })

  test('create USD movement', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)

    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })

    // Select USD currency
    await page.locator('select[name="currency"]').selectOption('USD')
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Suscripción Netflix')
    await page.getByPlaceholder('0.00').fill('9500')
    await screenshot(page, 'movement-crud-11-usd-form')

    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText('Suscripción Netflix')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'movement-crud-12-usd-on-home')
  })
})
