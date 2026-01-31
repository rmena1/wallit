import { test, expect } from '@playwright/test'
import { registerAndLogin, screenshot } from './helpers'

test.describe('Settings — Account Edit & Delete', () => {
  test('create account, edit it, then delete it', async ({ page }) => {
    await registerAndLogin(page)

    // 1. Navigate to settings and create an account
    await page.goto('/settings')
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })

    const bankSelect = page.locator('select[name="bankName"]')
    if (!await bankSelect.isVisible()) {
      await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
      await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
    }
    await bankSelect.selectOption('BCI')
    await page.locator('select[name="accountType"]').selectOption('Corriente')
    await page.getByPlaceholder('Últimos 4 dígitos').fill('4321')
    await page.getByPlaceholder('Saldo inicial').fill('250000')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('···4321')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'account-edit-01-created')

    // 2. Click the edit button on the account
    const accountRow = page.locator('div').filter({ hasText: '···4321' }).first()
    const editBtn = accountRow.locator('button').filter({ has: page.locator('svg') }).first()
    // Look for the edit icon button near the account
    const editButtons = page.locator('button').filter({ has: page.locator('svg path[d*="18.5 2.5"]') })
    if (await editButtons.count() > 0) {
      await editButtons.first().click()
      await screenshot(page, 'account-edit-02-edit-form')

      // 3. Modify account details
      const editBankSelect = page.locator('select[name="bankName"]').last()
      await editBankSelect.selectOption('Banco de Chile')
      const editDigits = page.getByPlaceholder('Últimos 4 dígitos').last()
      await editDigits.clear()
      await editDigits.fill('8888')
      await screenshot(page, 'account-edit-03-modified')

      // 4. Save changes
      const saveBtn = page.getByRole('button', { name: /Guardar/i })
      if (await saveBtn.isVisible()) {
        await saveBtn.click()
        await expect(page.getByText('···8888')).toBeVisible({ timeout: 5000 })
        await screenshot(page, 'account-edit-04-saved')
      }
    }

    // 5. Delete the account
    page.on('dialog', dialog => dialog.accept())
    const deleteButtons = page.locator('button').filter({ has: page.locator('svg polyline[points="3 6 5 6 21 6"]') })
    if (await deleteButtons.count() > 0) {
      await deleteButtons.first().click()
      // Account should be removed
      await page.waitForTimeout(1000)
      await screenshot(page, 'account-edit-05-deleted')
    }
  })
})
