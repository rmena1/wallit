import { test, expect } from '@playwright/test'
import { registerAndLogin, screenshot } from './helpers'

test.describe('Settings — Account Management', () => {
  test('create a bank account and verify it appears', async ({ page }) => {
    await registerAndLogin(page)

    // 1. Navigate to settings
    await page.goto('/settings')
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'settings-accounts-01-initial')

    // 2. Fill the create account form
    await page.locator('select[name="bankName"]').selectOption('BCI')
    await page.locator('select[name="accountType"]').selectOption('Corriente')
    await page.getByPlaceholder('Últimos 4 dígitos').fill('1234')
    await page.getByPlaceholder('Saldo inicial').fill('500000')
    await screenshot(page, 'settings-accounts-02-form-filled')

    // 3. Submit
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('···1234')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Corriente · ···1234')).toBeVisible()
    await screenshot(page, 'settings-accounts-03-account-created')

    // 4. Create a second account
    await page.locator('select[name="bankName"]').selectOption('Banco de Chile')
    await page.locator('select[name="accountType"]').selectOption('Vista')
    await page.getByPlaceholder('Últimos 4 dígitos').fill('5678')
    await page.getByPlaceholder('Saldo inicial').fill('100000')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('···5678')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'settings-accounts-04-two-accounts')

    // 5. Create a USD account
    await page.locator('select[name="bankName"]').selectOption('Mercado Pago')
    await page.locator('select[name="accountType"]').selectOption('Prepago')
    await page.getByPlaceholder('Últimos 4 dígitos').fill('0001')
    await page.locator('select[name="currency"]').last().selectOption('USD')
    await page.getByPlaceholder('Saldo inicial').fill('100')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('···0001')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'settings-accounts-05-usd-account')
  })
})
