import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, createMovement, screenshot } from './helpers'

test.describe('Split Movement — Complete Flow', () => {
  test('split a movement into multiple parts and verify results', async ({ page }) => {
    // 1. Setup: register, create account and movement
    await registerAndLogin(page)
    await ensureAccount(page)
    await createMovement(page, { name: 'Cena grupal con amigos', amount: '120000' })
    await screenshot(page, 'split-01-movement-created')

    // 2. Navigate to home and click movement to edit
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Cena grupal con amigos')).toBeVisible({ timeout: 5000 })
    await page.getByText('Cena grupal con amigos').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'split-02-edit-page')

    // 3. Click "Dividir" button to open split dialog
    await page.getByRole('button', { name: /Dividir/i }).click()
    await expect(page.getByText('Dividir Movimiento')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'split-03-dialog-open')

    // 4. Verify initial split state shows the original movement
    await expect(page.getByText('Total:')).toBeVisible()
    await expect(page.getByText('$120.000')).toBeVisible()
    await screenshot(page, 'split-04-initial-state')

    // 5. Fill the split items - first item is auto-filled with remaining
    const splitInputs = page.locator('input[placeholder="Descripción"]')
    const amountInputs = page.locator('input[placeholder="0"]')

    // Update first item description
    await splitInputs.nth(0).clear()
    await splitInputs.nth(0).fill('Mi parte de la cena')
    
    // Second item (first row is auto-calculated from remaining)
    await splitInputs.nth(1).fill('Parte de Pedro')
    await amountInputs.nth(1).fill('40000')
    await screenshot(page, 'split-05-first-split-filled')

    // 6. Add another split item
    await page.getByRole('button', { name: /\+ Agregar/i }).click()
    await splitInputs.nth(2).fill('Parte de María')
    await amountInputs.nth(2).fill('40000')
    await screenshot(page, 'split-06-second-split-filled')
    
    // First item should auto-calculate to 40000 (120000 - 40000 - 40000 = 40000)
    await screenshot(page, 'split-07-auto-calculated')

    // 8. Confirm the split
    await page.getByRole('button', { name: /Confirmar división/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'split-08-after-split')

    // 9. Verify the split movements appear on home (we have 3 parts now)
    await expect(page.getByText('Mi parte de la cena').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Parte de Pedro')).toBeVisible()
    await expect(page.getByText('Parte de María')).toBeVisible()
    await screenshot(page, 'split-09-split-movements-visible')
  })

  test('split movement with two parts (simple case)', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)
    await createMovement(page, { name: 'Almuerzo compartido', amount: '50000' })

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByText('Almuerzo compartido').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'split-simple-01-edit')

    await page.getByRole('button', { name: /Dividir/i }).click()
    await expect(page.getByText('Dividir Movimiento')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'split-simple-02-dialog')

    // Just modify the names and amounts for 2-way split
    const splitInputs = page.locator('input[placeholder="Descripción"]')
    const amountInputs = page.locator('input[placeholder="0"]')

    // First item already has original name, change it
    await splitInputs.nth(0).clear()
    await splitInputs.nth(0).fill('Mi mitad almuerzo')
    
    // Second item
    await splitInputs.nth(1).fill('Mitad de Juan')
    await amountInputs.nth(1).fill('25000')
    await screenshot(page, 'split-simple-03-filled')

    await page.getByRole('button', { name: /Confirmar división/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })

    await expect(page.getByText('Mi mitad almuerzo')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Mitad de Juan')).toBeVisible()
    await screenshot(page, 'split-simple-04-result')
  })

  test('cancel split returns to edit page', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)
    await createMovement(page, { name: 'Gasto cancelable', amount: '30000' })

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByText('Gasto cancelable').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: /Dividir/i }).click()
    await expect(page.getByText('Dividir Movimiento')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'split-cancel-01-dialog')

    // Cancel
    await page.getByRole('button', { name: /Cancelar/i }).click()
    await page.waitForTimeout(500)
    
    // Should be back on edit page
    await expect(page.getByText('Editar Movimiento')).toBeVisible()
    await expect(page.getByText('Dividir Movimiento')).not.toBeVisible()
    await screenshot(page, 'split-cancel-02-back-to-edit')
  })
})
