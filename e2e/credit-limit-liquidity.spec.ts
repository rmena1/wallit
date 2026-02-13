import { test, expect, Page } from '@playwright/test'
import { ensureCategory, registerAndLogin, screenshot } from './helpers'

type AccountFormInput = {
  bankName: string
  accountType: 'Corriente' | 'Vista' | 'Ahorro' | 'Crédito' | 'Prepago'
  lastFourDigits: string
  initialBalance?: string
  creditLimit?: string
}

async function openAddAccountForm(page: Page) {
  const bankSelect = page.locator('select[name="bankName"]')
  if (!await bankSelect.isVisible()) {
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
  }
}

async function createAccount(page: Page, input: AccountFormInput) {
  await openAddAccountForm(page)

  await page.locator('select[name="bankName"]').selectOption(input.bankName)
  await page.locator('select[name="accountType"]').selectOption(input.accountType)
  await page.getByPlaceholder('Últimos 4 dígitos').fill(input.lastFourDigits)
  await page.getByPlaceholder('Saldo inicial').fill(input.initialBalance ?? '')

  if (input.accountType === 'Crédito') {
    const creditLimitInput = page.getByPlaceholder('Cupo total (ej: 2000000)')
    await expect(creditLimitInput).toBeVisible()
    await creditLimitInput.fill(input.creditLimit ?? '')
  }

  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
}

async function selectAccountByText(page: Page, accountText: string) {
  const accountSelect = page.locator('select[name="accountId"]')
  const matchingOption = accountSelect.locator('option').filter({ hasText: accountText }).first()
  const optionValue = await matchingOption.getAttribute('value')
  if (!optionValue) throw new Error(`Account option with text "${accountText}" not found`)
  await accountSelect.selectOption(optionValue)
}

test.describe('Credit Limit And Net Liquidity', () => {
  test('Credit card account with credit limit', async ({ page }) => {
    await registerAndLogin(page)
    await screenshot(page, 'credit-limit-01-registered')

    await page.goto('/settings')
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'credit-limit-02-settings')

    const creditLimitInput = page.getByPlaceholder('Cupo total (ej: 2000000)')
    await expect(creditLimitInput).not.toBeVisible()

    await openAddAccountForm(page)
    await page.locator('select[name="bankName"]').selectOption('Falabella')
    await page.locator('select[name="accountType"]').selectOption('Crédito')
    await expect(creditLimitInput).toBeVisible()
    await page.getByPlaceholder('Últimos 4 dígitos').fill('1234')
    await page.getByPlaceholder('Saldo inicial').fill('')
    await creditLimitInput.fill('500000')
    await screenshot(page, 'credit-limit-03-form-filled')

    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('Falabella')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Crédito · ···1234')).toBeVisible()
    await screenshot(page, 'credit-limit-04-account-created')

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Falabella', { exact: true })).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Cupo:')).toBeVisible()
    await expect(page.getByText(/Cupo:\s*\$0\s*\/\s*\$500\.000/)).toBeVisible()
    await screenshot(page, 'credit-limit-05-home-card')
  })

  test('Net liquidity card with credit debt', async ({ page }) => {
    await registerAndLogin(page)
    await screenshot(page, 'net-liquidity-01-registered')

    await page.goto('/settings')
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'net-liquidity-02-settings')

    await createAccount(page, {
      bankName: 'BCI',
      accountType: 'Corriente',
      lastFourDigits: '1111',
      initialBalance: '200000',
    })
    await expect(page.getByText('Corriente · ···1111')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'net-liquidity-03-debit-created')

    await createAccount(page, {
      bankName: 'Falabella',
      accountType: 'Crédito',
      lastFourDigits: '1234',
      initialBalance: '',
      creditLimit: '500000',
    })
    await expect(page.getByText('Crédito · ···1234')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'net-liquidity-04-credit-created')

    await ensureCategory(page, '🍔', 'Comida')
    await screenshot(page, 'net-liquidity-05-category-ready')

    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    await selectAccountByText(page, 'Falabella')
    await page.getByPlaceholder('¿En qué se gastó?').fill('Compra con tarjeta')
    await page.getByPlaceholder('0.00').fill('50000')
    await page.locator('select[name="categoryId"]').selectOption({ label: '🍔 Comida' })
    await screenshot(page, 'net-liquidity-06-expense-form')

    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'net-liquidity-07-home-after-expense')

    await expect(page.getByText('Liquidez Neta')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/Débito:\s*\$200\.000/)).toBeVisible()
    await expect(page.getByText(/Deuda:\s*\$50\.000/)).toBeVisible()
    await screenshot(page, 'net-liquidity-08-breakdown-verified')
  })

  test('Credit limit shown correctly after spending', async ({ page }) => {
    await registerAndLogin(page)
    await screenshot(page, 'credit-spend-01-registered')

    await page.goto('/settings')
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'credit-spend-02-settings')

    await createAccount(page, {
      bankName: 'Falabella',
      accountType: 'Crédito',
      lastFourDigits: '4321',
      initialBalance: '',
      creditLimit: '1000000',
    })
    await expect(page.getByText('Crédito · ···4321')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'credit-spend-03-credit-created')

    await ensureCategory(page, '🍔', 'Comida')
    await screenshot(page, 'credit-spend-04-category-ready')

    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    await selectAccountByText(page, 'Falabella')
    await page.getByPlaceholder('¿En qué se gastó?').fill('Compra electrónica')
    await page.getByPlaceholder('0.00').fill('100000')
    await page.locator('select[name="categoryId"]').selectOption({ label: '🍔 Comida' })
    await screenshot(page, 'credit-spend-05-expense-form')

    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'credit-spend-06-home-after-expense')

    await expect(page.getByText('Falabella', { exact: true })).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/Cupo:\s*\$100\.000\s*\/\s*\$1\.000\.000/)).toBeVisible()
    await screenshot(page, 'credit-spend-07-cupo-verified')
  })
})
