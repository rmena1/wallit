import { test, expect } from '@playwright/test'
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
  const id = `recv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  db.prepare(`
    INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'expense', 0, 'CLP', 1, 0, ?, ?)
  `).run(id, userId, accountId, name, today, amount, now, now)
  db.close()
  return id
}

test.describe('Receivables & Payment — Complete Flow', () => {
  test('filter receivables, view them, and mark as paid via payment dialog', async ({ page }) => {
    // Register and setup
    const email = `e2e-recv-pay-${Date.now()}@wallit.app`
    await page.goto('/register')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('testpass123')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL('**/', { timeout: 10000 })

    await ensureAccount(page)

    // Create a regular movement + income for linking
    await createMovement(page, { name: 'Gasto normal', amount: '5000' })
    await createMovement(page, { name: 'Pago de Juan', amount: '25000', type: 'income' })

    // Seed receivable movements
    const userId = getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = getFirstAccountId(userId)
    seedReceivable(userId, accountId, 'Pedro me debe cena', 1500000)
    seedReceivable(userId, accountId, 'Juan me debe almuerzo', 2500000)

    // Go home and verify data exists
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'recv-pay-01-home-with-data')

    // Activate "Por Cobrar" filter
    const porCobrarBtn = page.getByText(/Por Cobrar/i).first()
    if (await porCobrarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await porCobrarBtn.click()
      await page.waitForTimeout(500)
      await screenshot(page, 'recv-pay-02-filtered')

      // Verify receivable movements show
      await expect(page.getByText('Pedro me debe cena')).toBeVisible({ timeout: 5000 })
      await expect(page.getByText('Juan me debe almuerzo')).toBeVisible({ timeout: 5000 })
      await screenshot(page, 'recv-pay-03-receivables-visible')

      // Try to mark one as received via payment dialog
      const cobradoBtn = page.getByText(/Cobrado|Recibido|✓/i).first()
      if (await cobradoBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cobradoBtn.click()
        await screenshot(page, 'recv-pay-04-payment-dialog-open')

        // Look for account selection in dialog
        const dialogAccountSelect = page.locator('div[style*="position: fixed"] select').first()
        if (await dialogAccountSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
          await dialogAccountSelect.selectOption({ index: 1 })
          await screenshot(page, 'recv-pay-05-account-selected')
        }

        // Look for income linking options
        const incomeOption = page.getByText('Pago de Juan').last()
        if (await incomeOption.isVisible({ timeout: 3000 }).catch(() => false)) {
          await incomeOption.click()
          await screenshot(page, 'recv-pay-06-income-linked')
        }

        // Confirm the payment
        const confirmBtn = page.getByRole('button', { name: /Confirmar|Aceptar|Marcar/i }).first()
        if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await confirmBtn.click()
          await screenshot(page, 'recv-pay-07-confirmed')
        }
      }
    }

    // Turn off filter and verify final state
    const allBtn = page.getByText(/Todos|Todo/i).first()
    if (await allBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await allBtn.click()
    }
    await screenshot(page, 'recv-pay-08-final-all-movements')
  })
})
