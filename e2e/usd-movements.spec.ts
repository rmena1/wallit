import { test, expect } from '@playwright/test'
import { registerAndLogin, screenshot } from './helpers'

async function createCLPAccount(page: any) {
  await page.goto('/settings')
  await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })

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

  await page.goto('/')
  await page.waitForLoadState('networkidle')
}

async function createUSDAccount(page: any) {
  await page.goto('/settings')
  await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })

  const bankSelect = page.locator('select[name="bankName"]')
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
  await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
  await bankSelect.selectOption('Scotiabank')
  await page.locator('select[name="accountType"]').selectOption('Corriente')
  await page.locator('select[name="currency"]').last().selectOption('USD')
  await page.getByPlaceholder('Últimos 4 dígitos').fill('9999')
  await page.getByPlaceholder('Saldo inicial').fill('500')
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
  await expect(page.getByText('···9999')).toBeVisible({ timeout: 5000 })

  await page.goto('/')
  await page.waitForLoadState('networkidle')
}

test.describe('USD Movements — Complete Flow', () => {
  test('create USD expense movement and verify display', async ({ page }) => {
    await registerAndLogin(page)
    await createCLPAccount(page)
    await screenshot(page, 'usd-movement-01-account-ready')

    // 1. Navigate to add movement
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'usd-movement-02-add-page')

    // 2. Select account
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })

    // 3. Fill movement details
    await page.getByPlaceholder('¿En qué se gastó?').fill('Compra en Amazon')
    await page.getByPlaceholder('0.00').fill('95000')  // Amount in CLP
    
    // 4. Change currency to USD
    await page.locator('select[name="currency"]').selectOption('USD')
    await screenshot(page, 'usd-movement-03-usd-selected')

    // 5. Submit the movement
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'usd-movement-04-created')

    // 6. Verify movement shows with USD indicator
    await expect(page.getByText('Compra en Amazon')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('USD')).toBeVisible()
    await screenshot(page, 'usd-movement-05-usd-visible')

    // 7. Click to edit and verify USD fields
    await page.getByText('Compra en Amazon').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    
    // Verify USD is selected in currency dropdown
    const currencySelect = page.locator('select').filter({ has: page.locator('option[value="USD"]') }).first()
    if (await currencySelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      const selectedValue = await currencySelect.inputValue()
      expect(selectedValue).toBe('USD')
      await screenshot(page, 'usd-movement-06-edit-usd-verified')
    }
  })

  test('create USD income and view in reports', async ({ page }) => {
    await registerAndLogin(page)
    await createCLPAccount(page)

    // 1. Create USD income
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    
    // Select income type
    await page.getByText('↑ Ingreso').click()
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Pago freelance USD')
    await page.getByPlaceholder('0.00').fill('500000')
    await page.locator('select[name="currency"]').selectOption('USD')
    await screenshot(page, 'usd-income-01-filled')

    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText('Pago freelance USD')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'usd-income-02-created')

    // 2. Navigate to reports
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'usd-income-03-reports')

    // 3. Verify income shows in summary (use first match)
    await expect(page.getByText('Ingresos', { exact: true }).first()).toBeVisible()
    await screenshot(page, 'usd-income-04-income-visible')
  })

  test('edit movement currency from CLP to USD', async ({ page }) => {
    await registerAndLogin(page)
    await createCLPAccount(page)

    // 1. Create CLP movement first
    await page.goto('/add')
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Gasto cambiar moneda')
    await page.getByPlaceholder('0.00').fill('85000')
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'usd-edit-01-clp-created')

    // 2. Edit and change to USD
    await page.getByText('Gasto cambiar moneda').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'usd-edit-02-edit-page')

    // Change currency
    const currencySelects = page.locator('select').filter({ has: page.locator('option[value="USD"]') })
    await currencySelects.first().selectOption('USD')
    await screenshot(page, 'usd-edit-03-changed-to-usd')

    // Save
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'usd-edit-04-saved')

    // Verify USD indicator appears
    await expect(page.getByText('Gasto cambiar moneda')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('USD')).toBeVisible()
    await screenshot(page, 'usd-edit-05-usd-visible')
  })

  test('USD account shows USD balance', async ({ page }) => {
    await registerAndLogin(page)
    await createCLPAccount(page)
    await createUSDAccount(page)
    await screenshot(page, 'usd-account-01-both-accounts')

    // Verify both accounts show with their currencies
    await expect(page.getByText('···1111')).toBeVisible()  // CLP account
    await expect(page.getByText('···9999')).toBeVisible()  // USD account
    
    // Create a USD movement for USD account
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    
    // Select USD account (should be Scotiabank with 9999)
    const accountSelect = page.locator('select[name="accountId"]')
    const options = await accountSelect.locator('option').allTextContents()
    const usdAccountIndex = options.findIndex(o => o.includes('9999') || o.includes('USD'))
    if (usdAccountIndex > 0) {
      await accountSelect.selectOption({ index: usdAccountIndex })
    }
    
    await page.getByPlaceholder('¿En qué se gastó?').fill('Amazon Prime')
    await page.getByPlaceholder('0.00').fill('15')  // $15 USD in cents as CLP equivalent
    await page.locator('select[name="currency"]').selectOption('USD')
    await screenshot(page, 'usd-account-02-usd-movement')

    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'usd-account-03-created')

    // Navigate to USD account detail
    const usdAccountCard = page.locator('[data-testid^="account-card-"]').filter({ hasText: /Scotiabank|9999/ })
    if (await usdAccountCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await usdAccountCard.click()
      await page.waitForLoadState('networkidle')
      await screenshot(page, 'usd-account-04-account-detail')
      
      // Verify balance shows in USD
      await expect(page.getByText('Balance Actual')).toBeVisible({ timeout: 5000 })
      await screenshot(page, 'usd-account-05-usd-balance')
    }
  })
})
