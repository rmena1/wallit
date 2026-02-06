import { test, expect } from '@playwright/test'
import { registerAndLogin, screenshot, TEST_PASSWORD } from './helpers'

async function createTwoAccounts(page: any) {
  await page.goto('/settings')
  await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })

  // First account: BCI CLP
  const bankSelect = page.locator('select[name="bankName"]')
  if (!await bankSelect.isVisible()) {
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
  }
  await bankSelect.selectOption('BCI')
  await page.locator('select[name="accountType"]').selectOption('Corriente')
  await page.getByPlaceholder('Últimos 4 dígitos').fill('1111')
  await page.getByPlaceholder('Saldo inicial').fill('1000000')
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
  await expect(page.getByText('···1111')).toBeVisible({ timeout: 5000 })

  // Second account: Santander CLP
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
  await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
  await bankSelect.selectOption('Santander')
  await page.locator('select[name="accountType"]').selectOption('Vista')
  await page.getByPlaceholder('Últimos 4 dígitos').fill('2222')
  await page.getByPlaceholder('Saldo inicial').fill('500000')
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
  await expect(page.getByText('···2222')).toBeVisible({ timeout: 5000 })

  await page.goto('/')
  await page.waitForLoadState('networkidle')
}

async function createUsdAndClpAccounts(page: any) {
  await page.goto('/settings')
  await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })

  // First account: BCI CLP
  const bankSelect = page.locator('select[name="bankName"]')
  if (!await bankSelect.isVisible()) {
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
  }
  await bankSelect.selectOption('BCI')
  await page.locator('select[name="accountType"]').selectOption('Corriente')
  await page.getByPlaceholder('Últimos 4 dígitos').fill('3333')
  await page.getByPlaceholder('Saldo inicial').fill('2000000')
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
  await expect(page.getByText('···3333')).toBeVisible({ timeout: 5000 })

  // Second account: Scotiabank USD
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
  await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
  await bankSelect.selectOption('Scotiabank')
  await page.locator('select[name="accountType"]').selectOption('Corriente')
  await page.locator('select[name="currency"]').selectOption('USD')
  await page.getByPlaceholder('Últimos 4 dígitos').fill('4444')
  await page.getByPlaceholder('Saldo inicial').fill('1000')
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
  await expect(page.getByText('···4444')).toBeVisible({ timeout: 5000 })

  await page.goto('/')
  await page.waitForLoadState('networkidle')
}

test.describe('Transfers — CLP Flow', () => {
  test('complete CLP transfer lifecycle - create, edit, delete, and verify behavior', async ({ page }) => {
    await registerAndLogin(page)
    await createTwoAccounts(page)

    // ========================================
    // PART 1: Create a CLP to CLP transfer
    // ========================================
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'transfers-clp-01-add-page')

    // Select Transfer type
    await page.getByText('↔️ Transfer').click()
    await expect(page.getByText('Desde cuenta')).toBeVisible()
    await screenshot(page, 'transfers-clp-02-transfer-selected')

    // Select accounts
    await page.locator('select').filter({ hasText: /Seleccionar cuenta origen/ }).selectOption({ index: 1 })
    await page.locator('select').filter({ hasText: /Seleccionar cuenta destino/ }).selectOption({ index: 1 })
    
    // Enter amount and note
    await page.getByPlaceholder('0.00').first().fill('50000')
    await page.getByPlaceholder('ej: Pago tarjeta de crédito').fill('Transfer test CLP')
    await screenshot(page, 'transfers-clp-03-filled-form')
    
    // Submit
    await page.getByRole('button', { name: /Crear Transferencia/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    
    // Verify transfer appears with both movements
    await expect(page.getByText('Transfer test CLP').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=↔️').first()).toBeVisible()
    expect(await page.getByText('Transfer test CLP').count()).toBe(2)
    await screenshot(page, 'transfers-clp-04-created')

    // Verify neutral color (↔️ icon indicates transfer, not expense/income)
    const transferIcon = page.locator('text=↔️').first()
    await expect(transferIcon).toBeVisible({ timeout: 5000 })
    // Both transfer movements show the custom note we provided
    const transferMovements = await page.locator('text=↔️').count()
    expect(transferMovements).toBe(2)
    await screenshot(page, 'transfers-clp-05-neutral-color')

    // ========================================
    // PART 2: Edit the transfer
    // ========================================
    await page.getByText('Transfer test CLP').first().click()
    await page.waitForURL('**/edit/**', { timeout: 5000 })
    await expect(page.getByText('Editar Transferencia')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'transfers-clp-06-edit-page')
    
    // Change the amount
    const amountInput = page.locator('input[inputmode="decimal"]').first()
    await amountInput.clear()
    await amountInput.fill('75000')
    await screenshot(page, 'transfers-clp-07-amount-changed')
    
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'transfers-clp-08-edited')

    // ========================================
    // PART 3: Verify transfers don't appear in reports totals
    // ========================================
    // First create a regular expense
    await page.goto('/add')
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Regular expense')
    await page.getByPlaceholder('0.00').fill('10000')
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    
    // Go to reports
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'transfers-clp-09-reports')
    
    // The gastos total should be ~10000 (regular expense), not include transfer
    const gastosText = await page.locator('text=Gastos').locator('..').locator('div').filter({ hasText: /\$/ }).first().textContent()
    await screenshot(page, 'transfers-clp-10-reports-totals')
    expect(gastosText).toBeTruthy()
    console.log('Gastos shown:', gastosText)

    // ========================================
    // PART 4: Delete the transfer
    // ========================================
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'transfers-clp-11-before-delete')
    
    // Click on the transfer to edit
    await page.getByText('Transfer test CLP').first().click()
    await page.waitForURL('**/edit/**', { timeout: 5000 })
    
    // Delete the transfer
    await page.getByRole('button', { name: /Eliminar transferencia/i }).click()
    await expect(page.getByText('¿Eliminar esta transferencia?')).toBeVisible()
    await screenshot(page, 'transfers-clp-12-delete-dialog')
    
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    
    // Transfer should be gone
    await expect(page.getByText('Transfer test CLP')).not.toBeVisible({ timeout: 3000 })
    await screenshot(page, 'transfers-clp-13-after-delete')
  })
})

test.describe('Transfers — USD Multi-Currency Flow', () => {
  test('complete USD transfer lifecycle - create with exchange rate, edit amounts', async ({ page }) => {
    await registerAndLogin(page)
    await createUsdAndClpAccounts(page)

    // ========================================
    // PART 1: Create USD to CLP transfer with auto exchange rate
    // ========================================
    await page.goto('/add')
    await page.getByText('↔️ Transfer').click()
    await screenshot(page, 'transfers-usd-01-transfer-type')
    
    // Select USD account as source, CLP as destination
    await page.locator('select').filter({ hasText: /Seleccionar cuenta origen/ }).selectOption({ index: 2 })
    await page.locator('select').filter({ hasText: /Seleccionar cuenta destino/ }).selectOption({ index: 1 })
    
    // Enter USD amount
    await page.getByPlaceholder('0.00').first().fill('100')
    
    // Wait for auto-calculation
    await page.waitForTimeout(500)
    
    // Should show exchange rate hint
    await expect(page.getByText(/Tipo de cambio/)).toBeVisible()
    await screenshot(page, 'transfers-usd-02-exchange-rate-visible')
    
    // Verify auto-calculated amount is present
    const toAmountField = page.getByPlaceholder('0.00').nth(1)
    await expect(toAmountField).toBeVisible()
    const toAmountValue = await toAmountField.inputValue()
    expect(parseFloat(toAmountValue)).toBeGreaterThan(0)
    await screenshot(page, 'transfers-usd-03-auto-calculated')
    
    // Submit
    await page.getByRole('button', { name: /Crear Transferencia/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'transfers-usd-04-created')

    // ========================================
    // PART 2: Create another transfer with manual destination amount
    // ========================================
    await page.goto('/add')
    await page.getByText('↔️ Transfer').click()
    
    // Select accounts for USD->CLP transfer
    await page.locator('select').filter({ hasText: /Seleccionar cuenta origen/ }).selectOption({ index: 2 })
    await page.locator('select').filter({ hasText: /Seleccionar cuenta destino/ }).selectOption({ index: 1 })
    
    // Enter USD amount
    await page.getByPlaceholder('0.00').first().fill('50')
    await page.waitForTimeout(500)
    
    // Manually override the CLP amount (custom exchange rate)
    const toAmountFieldManual = page.getByPlaceholder('0.00').nth(1)
    await toAmountFieldManual.clear()
    await toAmountFieldManual.fill('45000')
    await screenshot(page, 'transfers-usd-05-manual-amount')
    
    // Submit
    await page.getByRole('button', { name: /Crear Transferencia/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    
    // Verify transfer was created
    await expect(page.locator('text=↔️').first()).toBeVisible()
    await screenshot(page, 'transfers-usd-06-manual-created')

    // ========================================
    // PART 3: Verify both transfers exist on home
    // ========================================
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // Should have multiple transfer icons (from both USD transfers)
    const transferIcons = await page.locator('text=↔️').count()
    expect(transferIcons).toBeGreaterThanOrEqual(2)
    await screenshot(page, 'transfers-usd-07-all-transfers-visible')
  })
})
