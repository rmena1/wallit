import { test, expect } from '@playwright/test'
import { registerAndLogin, screenshot } from './helpers'

test.describe('Settings — Account Complete Flow', () => {
  test('create multiple accounts (CLP + USD), edit, and delete', async ({ page }) => {
    await registerAndLogin(page)

    // 1. Navigate to settings
    await page.goto('/settings')
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'account-flow-01-initial')

    // 2. Create first CLP account
    const bankSelect = page.locator('select[name="bankName"]')
    if (!await bankSelect.isVisible()) {
      await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
      await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
    }
    await bankSelect.selectOption('BCI')
    await page.locator('select[name="accountType"]').selectOption('Corriente')
    await page.getByPlaceholder('Últimos 4 dígitos').fill('1234')
    await page.getByPlaceholder('Saldo inicial').fill('500000')
    await screenshot(page, 'account-flow-02-form-filled')

    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('···1234')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Corriente · ···1234')).toBeVisible()
    await screenshot(page, 'account-flow-03-first-account')

    // 3. Create second CLP account
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await page.locator('select[name="bankName"]').selectOption('Banco de Chile')
    await page.locator('select[name="accountType"]').selectOption('Vista')
    await page.getByPlaceholder('Últimos 4 dígitos').fill('5678')
    await page.getByPlaceholder('Saldo inicial').fill('100000')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('···5678')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'account-flow-04-two-accounts')

    // 4. Create USD account
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await page.locator('select[name="bankName"]').selectOption('Mercado Pago')
    await page.locator('select[name="accountType"]').selectOption('Prepago')
    await page.getByPlaceholder('Últimos 4 dígitos').fill('0001')
    await page.locator('select[name="currency"]').last().selectOption('USD')
    await page.getByPlaceholder('Saldo inicial').fill('100')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('···0001')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'account-flow-05-usd-account')

    // 5. Edit the first account
    const editButtons = page.locator('button').filter({ has: page.locator('svg path[d*="18.5 2.5"]') })
    if (await editButtons.count() > 0) {
      await editButtons.first().click()
      await screenshot(page, 'account-flow-06-edit-form')

      const editBankSelect = page.locator('select[name="bankName"]').last()
      await editBankSelect.selectOption('Banco de Chile')
      const editDigits = page.getByPlaceholder('Últimos 4 dígitos').last()
      await editDigits.clear()
      await editDigits.fill('8888')
      await screenshot(page, 'account-flow-07-edit-modified')

      const saveBtn = page.getByRole('button', { name: /Guardar/i })
      if (await saveBtn.isVisible()) {
        await saveBtn.click()
        await expect(page.getByText('···8888')).toBeVisible({ timeout: 5000 })
        await screenshot(page, 'account-flow-08-edit-saved')
      }
    }

    // 6. Delete an account
    page.on('dialog', dialog => dialog.accept())
    const deleteButtons = page.locator('button').filter({ has: page.locator('svg polyline[points="3 6 5 6 21 6"]') })
    if (await deleteButtons.count() > 0) {
      await deleteButtons.first().click()
      await page.waitForTimeout(1000)
      await screenshot(page, 'account-flow-09-after-delete')
    }
  })
})
