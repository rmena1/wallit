import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, ensureCategory, screenshot } from './helpers'

test.describe('Movement CRUD — Complete Flow', () => {
  test('create expense, income, and USD movements', async ({ page }) => {
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
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 })
    await screenshot(page, 'movement-crud-02-expense-filled')

    // 3. Submit expense
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText('Almuerzo en restaurante')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'movement-crud-03-expense-on-home')

    // 4. Create income movement
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    await page.getByText('↑ Ingreso').click()
    await screenshot(page, 'movement-crud-04-income-selected')

    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Sueldo mensual')
    await page.getByPlaceholder('0.00').fill('2000000')
    await screenshot(page, 'movement-crud-05-income-filled')

    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText('Sueldo mensual')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'movement-crud-06-income-on-home')

    // 5. Create USD movement
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    await page.locator('select[name="currency"]').selectOption('USD')
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Suscripción Netflix')
    await page.getByPlaceholder('0.00').fill('9500')
    await screenshot(page, 'movement-crud-07-usd-form')

    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText('Suscripción Netflix')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'movement-crud-08-usd-on-home')

    // 6. Verify all three movements visible on home
    await expect(page.getByText('Almuerzo en restaurante')).toBeVisible()
    await expect(page.getByText('Sueldo mensual')).toBeVisible()
    await expect(page.getByText('Suscripción Netflix')).toBeVisible()
    await screenshot(page, 'movement-crud-09-all-movements')
  })
})
