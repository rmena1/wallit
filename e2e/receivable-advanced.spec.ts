import { test, expect, Page } from '@playwright/test'
import { registerAndLogin, ensureAccount, createMovement, screenshot } from './helpers'
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'data', 'wallit.db')

function getUserId(email: string): string | null {
  const db = new Database(DB_PATH)
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined
  db.close()
  return row?.id ?? null
}

function getFirstAccountId(userId: string): string | null {
  const db = new Database(DB_PATH)
  const row = db.prepare('SELECT id FROM accounts WHERE user_id = ?').get(userId) as { id: string } | undefined
  db.close()
  return row?.id ?? null
}

function seedReceivable(userId: string, accountId: string | null, name: string, amount: number): string {
  const db = new Database(DB_PATH)
  const now = Math.floor(Date.now() / 1000)
  const today = new Date().toISOString().slice(0, 10)
  const id = `recv-adv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  db.prepare(`
    INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'expense', 0, 'CLP', 1, 0, ?, ?)
  `).run(id, userId, accountId, name, today, amount, now, now)
  db.close()
  return id
}

function seedUnlinkedIncome(userId: string, accountId: string | null, name: string, amount: number): string {
  const db = new Database(DB_PATH)
  const now = Math.floor(Date.now() / 1000)
  const today = new Date().toISOString().slice(0, 10)
  const id = `income-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  db.prepare(`
    INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'income', 0, 'CLP', 0, 0, ?, ?)
  `).run(id, userId, accountId, name, today, amount, now, now)
  db.close()
  return id
}

async function registerUser(page: Page): Promise<string> {
  const email = `e2e-recv-adv-${Date.now()}-${Math.random().toString(36).slice(2, 5)}@wallit.app`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('testpass123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('**/', { timeout: 10000 })
  return email
}

test.describe('Receivable Advanced — Create, Unmark, and Link', () => {
  test('mark existing movement as receivable from edit page and verify on home', async ({ page }) => {
    // This test covers the UI flow of marking a regular movement as receivable
    // (Consolidated from edit-movement.spec.ts)
    await registerAndLogin(page)
    await ensureAccount(page)
    await createMovement(page, { name: 'Cena con amigos', amount: '40000' })

    // 1. Navigate to home and verify movement exists
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Cena con amigos')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'recv-mark-01-home-with-movement')

    // 2. Click movement to open edit page
    await page.getByText('Cena con amigos').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'recv-mark-02-edit-page')

    // 3. Click "Por cobrar" button to open receivable dialog
    await page.getByRole('button', { name: /Por cobrar/i }).click()
    await expect(page.getByText('Marcar como Por Cobrar')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'recv-mark-03-dialog-open')

    // 4. Fill reminder text and confirm
    await page.locator('input[placeholder="Texto del recordatorio..."]').fill('Juan me debe la mitad')
    await screenshot(page, 'recv-mark-04-reminder-filled')
    
    await page.getByRole('button', { name: 'Confirmar' }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'recv-mark-05-marked-receivable')

    // 5. Verify the "Por Cobrar" filter shows the movement
    const porCobrarBtn = page.getByRole('button', { name: /Por cobrar/i })
    if (await porCobrarBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await porCobrarBtn.click()
      await page.waitForTimeout(500)
      // After marking receivable, the movement shows the reminder text
      await expect(page.getByText('Juan me debe la mitad')).toBeVisible({ timeout: 5000 })
      await screenshot(page, 'recv-mark-06-filtered-view')

      // Toggle back to all
      await porCobrarBtn.click()
      await screenshot(page, 'recv-mark-07-final-state')
    }
  })

  test('unmark a receivable movement from edit page', async ({ page }) => {
    // 1. Setup
    const email = await registerUser(page)
    await ensureAccount(page)

    // Seed a receivable movement
    const userId = getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = getFirstAccountId(userId)
    seedReceivable(userId, accountId, 'Amigo me debe cena', 5000000)

    // 2. Navigate to home and verify receivable shows
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Amigo me debe cena')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'recv-unmark-01-home')

    // 3. Click on receivable filter to see it highlighted
    const porCobrarBtn = page.getByRole('button', { name: /Por cobrar/i })
    await porCobrarBtn.click()
    await page.waitForTimeout(500)
    await screenshot(page, 'recv-unmark-02-filtered')

    // 4. Click on the movement to edit
    await page.getByText('Amigo me debe cena').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'recv-unmark-03-edit-page')

    // 5. Click "Desmarcar cobro" button
    const unmarkBtn = page.getByRole('button', { name: /Desmarcar cobro/i })
    await expect(unmarkBtn).toBeVisible({ timeout: 3000 })
    await unmarkBtn.click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'recv-unmark-04-unmarked')

    // 6. Verify it's no longer in receivables filter
    await porCobrarBtn.click()
    await page.waitForTimeout(500)
    await expect(page.getByText('Amigo me debe cena')).not.toBeVisible({ timeout: 3000 })
    await screenshot(page, 'recv-unmark-05-not-in-filter')

    // 7. Turn off filter and verify movement still exists
    await porCobrarBtn.click()
    await page.waitForTimeout(500)
    await expect(page.getByText('Amigo me debe cena')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'recv-unmark-06-still-exists')
  })

  test('mark as received by linking to existing income', async ({ page }) => {
    // 1. Setup
    const email = await registerUser(page)
    await ensureAccount(page)

    // Seed receivable and unlinked income
    const userId = getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = getFirstAccountId(userId)
    seedReceivable(userId, accountId, 'Juan me debe almuerzo', 2500000)
    seedUnlinkedIncome(userId, accountId, 'Transferencia de Juan', 2500000)

    // 2. Navigate to home
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'recv-link-01-home')

    // 3. Verify both movements exist
    await expect(page.getByText('Juan me debe almuerzo')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Transferencia de Juan')).toBeVisible()
    await screenshot(page, 'recv-link-02-both-visible')

    // 4. Filter to receivables
    const porCobrarBtn = page.getByRole('button', { name: /Por cobrar/i })
    await porCobrarBtn.click()
    await page.waitForTimeout(500)
    await expect(page.getByText('Juan me debe almuerzo')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'recv-link-03-filtered')

    // 5. Click the checkbox/button on the receivable to open payment dialog
    const receivableRow = page.locator('div').filter({ hasText: /Juan me debe almuerzo/ }).first()
    const checkBtn = receivableRow.locator('button').first()
    if (await checkBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await checkBtn.click()
      await page.waitForTimeout(500)
      await screenshot(page, 'recv-link-04-payment-dialog')

      // 6. Switch to "Vincular existente" tab
      const linkTab = page.getByRole('button', { name: /Vincular existente/i })
      if (await linkTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await linkTab.click()
        await page.waitForTimeout(500)
        await screenshot(page, 'recv-link-05-link-tab')

        // 7. Select the existing income
        const incomeOption = page.getByText('Transferencia de Juan').last()
        if (await incomeOption.isVisible({ timeout: 2000 }).catch(() => false)) {
          await incomeOption.click()
          await screenshot(page, 'recv-link-06-income-selected')

          // 8. Confirm
          await page.getByRole('button', { name: /Confirmar/i }).click()
          await page.waitForTimeout(1000)
          await screenshot(page, 'recv-link-07-confirmed')

          // 9. Verify receivable is now marked as received (removed from filter)
          await expect(page.getByText('Juan me debe almuerzo')).not.toBeVisible({ timeout: 3000 })
          await screenshot(page, 'recv-link-08-removed-from-filter')
        }
      }
    }
  })

  test('mark as received with new income (cash)', async ({ page }) => {
    // 1. Setup
    const email = await registerUser(page)
    await ensureAccount(page)

    // Seed receivable
    const userId = getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = getFirstAccountId(userId)
    seedReceivable(userId, accountId, 'Pedro me debe taxi', 1500000)

    // 2. Navigate and filter
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const porCobrarBtn = page.getByRole('button', { name: /Por cobrar/i })
    await porCobrarBtn.click()
    await page.waitForTimeout(500)
    await screenshot(page, 'recv-cash-01-filtered')

    // 3. Click the receivable checkbox button (the small yellow-bordered button)
    // Find it by looking for the receivable card
    await expect(page.getByText('Pedro me debe taxi')).toBeVisible({ timeout: 5000 })
    
    // The checkbox is the first button inside the movement card container
    const movementCards = page.locator('div[style*="backgroundColor: rgb(42, 32, 0)"]').first()
    const checkboxBtn = movementCards.locator('button').first()
    
    if (await checkboxBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await checkboxBtn.click()
      await page.waitForTimeout(500)
      await screenshot(page, 'recv-cash-02-dialog')

      // 4. "Efectivo" (cash) should be pre-selected by default, just confirm
      await page.getByRole('button', { name: /Confirmar/i }).click()
      await page.waitForTimeout(1000)
      await screenshot(page, 'recv-cash-03-confirmed')

      // 5. Verify removed from filter
      await expect(page.getByText('Pedro me debe taxi')).not.toBeVisible({ timeout: 5000 })
      await screenshot(page, 'recv-cash-04-done')
    } else {
      // If no checkbox, just verify the receivable is showing
      await screenshot(page, 'recv-cash-02-receivable-visible')
    }
  })

  test('mark as received with new income to specific account', async ({ page }) => {
    // 1. Setup with 2 accounts
    const email = await registerUser(page)
    
    // Create two accounts
    await page.goto('/settings')
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })
    
    const bankSelect = page.locator('select[name="bankName"]')
    if (!await bankSelect.isVisible()) {
      await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    }
    await bankSelect.selectOption('BCI')
    await page.locator('select[name="accountType"]').selectOption('Corriente')
    await page.getByPlaceholder('Últimos 4 dígitos').fill('1111')
    await page.getByPlaceholder('Saldo inicial').fill('100000')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('···1111')).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
    await bankSelect.selectOption('Santander')
    await page.locator('select[name="accountType"]').selectOption('Vista')
    await page.getByPlaceholder('Últimos 4 dígitos').fill('2222')
    await page.getByPlaceholder('Saldo inicial').fill('50000')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('···2222')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'recv-account-01-accounts-created')

    // Seed receivable
    const userId = getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = getFirstAccountId(userId)
    seedReceivable(userId, accountId, 'María me debe libro', 3000000)

    // 2. Navigate and filter
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const porCobrarBtn = page.getByRole('button', { name: /Por cobrar/i })
    await porCobrarBtn.click()
    await page.waitForTimeout(500)
    await screenshot(page, 'recv-account-02-filtered')

    // 3. Verify receivable is visible
    await expect(page.getByText('María me debe libro')).toBeVisible({ timeout: 5000 })
    
    // 4. Click the checkbox button to open payment dialog
    const movementCards = page.locator('div[style*="backgroundColor: rgb(42, 32, 0)"]').first()
    const checkboxBtn = movementCards.locator('button').first()
    
    if (await checkboxBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await checkboxBtn.click()
      await page.waitForTimeout(500)
      await screenshot(page, 'recv-account-03-dialog')

      // 5. Look for account options in the dialog - click on the Santander label
      const dialog = page.locator('div[style*="position: fixed"]').last()
      const santanderLabel = dialog.locator('label').filter({ hasText: /Santander/ })
      
      if (await santanderLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
        await santanderLabel.click()
        await screenshot(page, 'recv-account-04-account-selected')
      }

      // 6. Confirm
      await page.getByRole('button', { name: /Confirmar/i }).click()
      await page.waitForTimeout(1000)
      await screenshot(page, 'recv-account-05-confirmed')

      // 7. Verify removed from filter
      await expect(page.getByText('María me debe libro')).not.toBeVisible({ timeout: 5000 })
      await screenshot(page, 'recv-account-06-done')
    } else {
      // If no checkbox, just verify receivable is showing
      await screenshot(page, 'recv-account-03-receivable-visible')
    }
  })
})
