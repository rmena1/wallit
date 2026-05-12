import { test, expect } from '@playwright/test'
import { createAccount, registerAndLogin, screenshot } from './helpers'

test('reorders bank accounts in settings and uses that order on home', async ({ page }) => {
  await registerAndLogin(page)
  await createAccount(page, { bankName: 'BCI', lastFourDigits: '1111', initialBalance: '100000' })
  await createAccount(page, { bankName: 'Banco de Chile', lastFourDigits: '2222', initialBalance: '200000' })

  await page.goto('/settings')
  await expect(page.getByText('Cuentas Bancarias')).toBeVisible()

  const rows = page.getByTestId('settings-account-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('BCI')
  await expect(rows.nth(1)).toContainText('Banco de Chile')

  await rows.nth(0).dragTo(rows.nth(1))
  await expect(rows.nth(0)).toContainText('Banco de Chile')
  await expect(rows.nth(1)).toContainText('BCI')
  await screenshot(page, 'account-reorder-settings')

  await page.reload()
  await expect(page.getByTestId('settings-account-row').nth(0)).toContainText('Banco de Chile')
  await expect(page.getByTestId('settings-account-row').nth(1)).toContainText('BCI')

  await page.goto('/')
  const accountCards = page.locator('[data-testid^="account-card-"]')
  await expect(accountCards.nth(0)).toContainText('Banco de Chile')
  await expect(accountCards.nth(1)).toContainText('BCI')
  await screenshot(page, 'account-reorder-home')
})
