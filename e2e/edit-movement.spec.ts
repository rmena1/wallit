import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, ensureCategory, createMovement, screenshot } from './helpers'

test.describe('Edit Movement — Complete Flow', () => {
  test('edit movement fields, change type, delete from edit page', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)
    await ensureCategory(page, '🍔', 'Comida')
    await ensureCategory(page, '🚗', 'Transporte')

    // Create a movement to edit
    await createMovement(page, { name: 'Gasto de prueba', amount: '25000' })

    // 1. Click movement to open edit
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByText('Gasto de prueba').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-movement-01-edit-page')

    // 2. Change description
    await page.locator('input[value="Gasto de prueba"]').fill('Gasto editado')
    await screenshot(page, 'edit-movement-02-name-changed')

    // 3. Change type to income
    await page.getByRole('button', { name: /Ingreso/i }).click()
    await screenshot(page, 'edit-movement-03-type-income')

    // 4. Save changes
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText('Gasto editado')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-movement-04-saved')

    // 5. Open edit again and delete from edit page
    await page.getByText('Gasto editado').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-movement-05-before-delete')

    await page.getByRole('button', { name: /Eliminar/i }).first().click()
    await expect(page.getByText('¿Eliminar este movimiento?')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'edit-movement-06-delete-dialog')

    await page.getByRole('button', { name: 'Eliminar' }).last().click()
    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText('Gasto editado')).not.toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-movement-07-after-delete')
  })

  test('mark movement as receivable from edit page', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)
    await createMovement(page, { name: 'Cena con amigos', amount: '40000' })

    // Open edit
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByText('Cena con amigos').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })

    // Click "Por cobrar"
    await page.getByRole('button', { name: /Por cobrar/i }).click()
    await expect(page.getByText('Marcar como Por Cobrar')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'edit-movement-08-receivable-dialog')

    // Fill reminder and confirm
    await page.locator('input[placeholder="Texto del recordatorio..."]').fill('Juan me debe la mitad')
    await page.getByRole('button', { name: 'Confirmar' }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'edit-movement-09-marked-receivable')
  })
})
