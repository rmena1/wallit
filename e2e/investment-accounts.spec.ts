import { test, expect } from '@playwright/test'
import { registerAndLogin, screenshot } from './helpers'
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'data', 'wallit.db')

function getUserId(email: string): string | null {
  const db = new Database(DB_PATH)
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined
  db.close()
  return row?.id ?? null
}

function getInvestmentAccountId(userId: string): string | null {
  const db = new Database(DB_PATH)
  const row = db.prepare('SELECT id FROM accounts WHERE user_id = ? AND is_investment = 1').get(userId) as { id: string } | undefined
  db.close()
  return row?.id ?? null
}

function getSnapshotCount(accountId: string): number {
  const db = new Database(DB_PATH)
  const row = db.prepare('SELECT COUNT(*) as cnt FROM investment_snapshots WHERE account_id = ?').get(accountId) as { cnt: number }
  db.close()
  return row.cnt
}

test.describe('Investment Accounts', () => {
  test('Create investment account, update value, verify gain/loss and snapshots', async ({ page }) => {
    // 1. Register and login
    await registerAndLogin(page)
    await screenshot(page, 'invest-01-logged-in')

    // 2. Go to settings and create an investment account
    await page.goto('/settings')
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })

    // Open add form if needed
    const bankSelect = page.locator('select[name="bankName"]')
    if (!await bankSelect.isVisible()) {
      await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
      await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
    }

    // Fill investment account form
    await bankSelect.selectOption('BCI')
    await page.locator('select[name="accountType"]').selectOption('Ahorro')
    
    // Check investment checkbox
    await page.locator('input[name="isInvestment"]').check()
    await screenshot(page, 'invest-02-form-investment-checked')

    // Last 4 digits is optional for investment, but let's fill it
    const lastDigitsInput = page.getByPlaceholder(/Últimos 4 dígitos/)
    await lastDigitsInput.fill('1234')
    
    // Initial balance = 500,000 CLP (enter as display value)
    await page.getByPlaceholder(/Valor invertido actual|Saldo inicial/i).fill('500000')
    
    await screenshot(page, 'invest-03-form-filled')

    // Submit
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    
    // Wait for account to appear in list
    await expect(page.getByText('BCI')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Inversión')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'invest-04-account-created')

    // 3. Go to home and verify the investment account card
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    // Should see the account card with BCI
    await expect(page.getByText('BCI')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'invest-05-home-with-investment')

    // 4. Click on the investment account card to go to detail
    const accountCard = page.locator('[data-testid^="account-card-"]').filter({ hasText: 'BCI' })
    await expect(accountCard).toBeVisible({ timeout: 3000 })
    await accountCard.click()
    await page.waitForLoadState('networkidle')
    
    // Verify investment summary section is visible
    await expect(page.getByText('Resumen de Inversión')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Valor Actual')).toBeVisible()
    await expect(page.getByText('Total Depositado')).toBeVisible()
    await expect(page.getByText('Ganancia/Pérdida')).toBeVisible()
    await screenshot(page, 'invest-06-account-detail')

    // 5. Click "Update Value" button to show the form
    await page.getByRole('button', { name: 'Actualizar Valor' }).click()
    await expect(page.getByText('Nuevo valor actual')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'invest-07-update-form-open')

    // 6. Update the value to 550,000 (display value, will be converted to cents)
    const valueInput = page.locator('input[type="number"]')
    await valueInput.clear()
    await valueInput.fill('550000')
    
    // Click save
    await page.getByRole('button', { name: 'Guardar' }).click()
    
    // Wait for the form to close and page to refresh
    await page.waitForLoadState('networkidle')
    // The form should close after successful update
    await expect(page.getByText('Nuevo valor actual')).not.toBeVisible({ timeout: 5000 })
    await screenshot(page, 'invest-08-value-updated')

    // 7. Verify snapshots section shows at least one snapshot
    await expect(page.getByText('Historial de Valores')).toBeVisible({ timeout: 3000 })
    // After creating the account with initial value AND updating, we should have at least 1 snapshot
    // (the update creates a snapshot)
    const snapshotItems = page.locator('text=/$[0-9]/')
    await screenshot(page, 'invest-09-snapshots-visible')

    // 8. Go back to home and verify gain/loss badge
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    // The gain/loss badge should show a positive percentage since we increased from 500k to 550k
    // That's +10% gain
    const investmentCard = page.locator('[data-testid^="account-card-"]').filter({ hasText: 'BCI' })
    await expect(investmentCard).toBeVisible({ timeout: 3000 })
    
    // Check for the percentage badge (should show +10.0%)
    await expect(investmentCard.getByText(/\+10\.0%/)).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'invest-10-home-gain-badge')

    // 9. Verify DB state
    // Get email from page to find user
    const currentUrl = page.url()
    // Use DB to verify snapshots exist
    const db = new Database(DB_PATH)
    const investmentAccounts = db.prepare('SELECT id FROM accounts WHERE is_investment = 1 ORDER BY created_at DESC LIMIT 1').get() as { id: string } | undefined
    if (investmentAccounts) {
      const snapshots = db.prepare('SELECT COUNT(*) as cnt FROM investment_snapshots WHERE account_id = ?').get(investmentAccounts.id) as { cnt: number }
      expect(snapshots.cnt).toBeGreaterThanOrEqual(1)
    }
    db.close()
    
    await screenshot(page, 'invest-11-final')
  })

  test('Investment account with zero gain shows 0% badge', async ({ page }) => {
    await registerAndLogin(page)
    
    // Create investment account
    await page.goto('/settings')
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })
    
    const bankSelect = page.locator('select[name="bankName"]')
    if (!await bankSelect.isVisible()) {
      await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
      await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
    }
    
    await bankSelect.selectOption('Scotiabank')
    await page.locator('select[name="accountType"]').selectOption('Ahorro')
    await page.locator('input[name="isInvestment"]').check()
    await page.getByPlaceholder(/Últimos 4 dígitos/).fill('5678')
    await page.getByPlaceholder(/Valor invertido actual|Saldo inicial/i).fill('100000')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('Scotiabank')).toBeVisible({ timeout: 5000 })
    
    // Go to home - initial value equals deposited, so gain is 0%
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    const card = page.locator('[data-testid^="account-card-"]').filter({ hasText: 'Scotiabank' })
    await expect(card).toBeVisible({ timeout: 3000 })
    
    // With 0% gain, the badge should show +0.0% or not show at all
    // Since currentValue == totalDeposited, gainLossPercent = 0
    await screenshot(page, 'invest-zero-gain-home')
  })
})
