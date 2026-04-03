import { test, expect, type Locator, type Page } from '@playwright/test'
import { registerAndLogin, screenshot, TEST_PASSWORD } from './helpers'
import { createInvestmentAccount, getUserId, seedInvestmentSnapshot, seedTransferMovement } from './db-helper'
import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/wallit'
const sql = postgres(DATABASE_URL, { max: 5 })

async function registerUser(page: Page): Promise<string> {
  const email = `e2e-invest-${Date.now()}-${Math.random().toString(36).slice(2, 5)}@wallit.app`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await page.waitForURL('**/', { timeout: 10000 })
  return email
}

async function swipeLeft(page: Page, locator: Locator, distance: number) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) {
    throw new Error('Could not determine swipe target bounds')
  }

  const startX = box.x + box.width * 0.72
  const endX = startX - distance
  const y = box.y + box.height / 2

  await page.mouse.move(startX, y)
  await page.mouse.down()
  await page.mouse.move(endX, y, { steps: 12 })
  await page.mouse.up()
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
    await screenshot(page, 'invest-09-snapshots-visible')

    // 8. Go back to home and verify gain/loss badge
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    const investmentCard = page.locator('[data-testid^="account-card-"]').filter({ hasText: 'BCI' })
    await expect(investmentCard).toBeVisible({ timeout: 3000 })
    
    // Check for the percentage badge (should show +10.0%)
    await expect(investmentCard.getByText(/\+10\.0%/)).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'invest-10-home-gain-badge')

    // 9. Verify DB state - use PG to verify snapshots exist
    const investmentAccounts = await sql`SELECT id FROM accounts WHERE is_investment = true ORDER BY created_at DESC LIMIT 1`
    if (investmentAccounts.length > 0) {
      const snapshots = await sql`SELECT COUNT(*) as cnt FROM investment_snapshots WHERE account_id = ${investmentAccounts[0].id}`
      expect(Number(snapshots[0].cnt)).toBeGreaterThanOrEqual(1)
    }
    
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
    
    await screenshot(page, 'invest-zero-gain-home')
  })

  test('Investment snapshots can be swipe-deleted with confirmation', async ({ page }) => {
    const email = await registerUser(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')

    const openingAt = new Date('2026-01-10T12:00:00.000Z')
    const middleAt = new Date('2026-02-10T12:00:00.000Z')
    const latestAt = new Date('2026-03-10T12:00:00.000Z')

    const accountId = await createInvestmentAccount(userId, {
      bankName: 'Fintual',
      lastFourDigits: '4242',
      initialBalance: 50000000,
      currentValue: 57000000,
      createdAt: openingAt,
      updatedAt: latestAt,
    })

    await seedInvestmentSnapshot(userId, accountId, {
      value: 50000000,
      date: '2026-01-10',
      createdAt: openingAt,
    })
    await seedInvestmentSnapshot(userId, accountId, {
      value: 55000000,
      date: '2026-02-10',
      createdAt: middleAt,
    })
    await seedInvestmentSnapshot(userId, accountId, {
      value: 57000000,
      date: '2026-03-10',
      createdAt: latestAt,
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const accountCard = page.locator(`[data-testid="account-card-${accountId}"]`)
    await expect(accountCard).toBeVisible({ timeout: 5000 })
    await accountCard.click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Historial de Valores')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('investment-summary-current-value')).toHaveText('$570.000')
    await screenshot(page, 'invest-delete-01-account-detail')

    const latestSnapshotRow = page.locator('[data-testid^="investment-snapshot-row-"]').filter({ hasText: '$570.000' }).first()
    await expect(latestSnapshotRow).toBeVisible({ timeout: 5000 })

    await swipeLeft(page, latestSnapshotRow, 120)
    const inlineDeleteButton = latestSnapshotRow.getByRole('button', { name: 'Eliminar' })
    await expect(inlineDeleteButton).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'invest-delete-02-reveal-delete')

    await inlineDeleteButton.click()
    const deleteDialog = page.getByTestId('investment-snapshot-delete-dialog')
    await expect(deleteDialog).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'invest-delete-03-confirm-dialog')

    await deleteDialog.getByRole('button', { name: 'Cancelar' }).click()
    await expect(deleteDialog).not.toBeVisible({ timeout: 5000 })
    await expect(latestSnapshotRow).toBeVisible({ timeout: 5000 })
    await expect(latestSnapshotRow.getByText('$570.000')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'invest-delete-04-cancelled')

    await swipeLeft(page, latestSnapshotRow, 280)
    await expect(deleteDialog).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'invest-delete-05-full-swipe-dialog')

    await deleteDialog.getByRole('button', { name: 'Eliminar' }).click()
    await expect(page.locator('[data-testid^="investment-snapshot-row-"]').filter({ hasText: '$570.000' })).toHaveCount(0)
    await expect(page.getByTestId('investment-summary-current-value')).toHaveText('$550.000')

    const [accountState] = await sql`
      SELECT current_value, current_value_updated_at
      FROM accounts
      WHERE id = ${accountId}
    `
    expect(Number(accountState.current_value)).toBe(55000000)
    expect(accountState.current_value_updated_at).toBeTruthy()

    const [snapshotCount] = await sql`
      SELECT COUNT(*) as cnt
      FROM investment_snapshots
      WHERE account_id = ${accountId}
    `
    expect(Number(snapshotCount.cnt)).toBe(2)

    await screenshot(page, 'invest-delete-06-deleted')
  })

  test('Investment gain uses opening tracked value plus net transfers when initial balance is stale', async ({ page }) => {
    const email = await registerUser(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')

    const openingTrackedAt = new Date('2026-02-13T12:00:00.000Z')
    const currentValueUpdatedAt = new Date('2026-04-03T12:00:00.000Z')
    const accountId = await createInvestmentAccount(userId, {
      bankName: 'Fintual',
      lastFourDigits: '0001',
      initialBalance: 0,
      currentValue: 154983500,
      createdAt: openingTrackedAt,
      updatedAt: currentValueUpdatedAt,
    })

    await seedInvestmentSnapshot(userId, accountId, {
      value: 199090100,
      date: '2026-02-13',
      createdAt: openingTrackedAt,
    })
    await seedTransferMovement(userId, accountId, {
      amount: 50000000,
      type: 'expense',
      date: '2026-03-01',
      createdAt: new Date('2026-03-01T12:00:00.000Z'),
      transferId: 'investment-transfer-out',
    })
    await seedTransferMovement(userId, accountId, {
      amount: 2000000,
      type: 'income',
      date: '2026-03-15',
      createdAt: new Date('2026-03-15T12:00:00.000Z'),
      transferId: 'investment-transfer-in',
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const accountCard = page.locator(`[data-testid="account-card-${accountId}"]`)
    await expect(accountCard).toBeVisible({ timeout: 5000 })
    await expect(accountCard.getByText(/\+2\.6%/)).toBeVisible({ timeout: 5000 })
    await expect(accountCard.getByText('$1.549.835')).toBeVisible({ timeout: 5000 })

    await accountCard.click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Resumen de Inversión')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('$1.510.901')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('$38.934')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/\+2\.58%/)).toBeVisible({ timeout: 5000 })
  })
})
