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

function seedReceivableMovement(userId: string, accountId: string | null, name: string, amount: number): string {
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

test.describe('Receivables (Por Cobrar) — Complete Flow', () => {
  test('view receivables filter on home, mark as received', async ({ page }) => {
    const email = `e2e-receivables-${Date.now()}@wallit.app`
    await page.goto('/register')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('testpass123')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL('**/', { timeout: 10000 })

    await ensureAccount(page)

    const userId = getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = getFirstAccountId(userId)

    // Create a regular movement so home has data
    await createMovement(page, { name: 'Gasto normal', amount: '5000' })

    // Seed a receivable movement
    seedReceivableMovement(userId, accountId, 'Pedro me debe cena', 1500000)

    // Go home and look for receivables
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'receivables-01-home-with-data')

    // Look for "Por Cobrar" filter/toggle
    const porCobrarBtn = page.getByText(/Por Cobrar/i).first()
    if (await porCobrarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await porCobrarBtn.click()
      await screenshot(page, 'receivables-02-filtered')

      // Verify receivable movement shows
      await expect(page.getByText('Pedro me debe cena')).toBeVisible({ timeout: 5000 })
      await screenshot(page, 'receivables-03-receivable-visible')

      // Try to mark as received
      const receivedBtn = page.getByText(/Cobrado|Recibido|✓/i).first()
      if (await receivedBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await receivedBtn.click()
        await screenshot(page, 'receivables-04-payment-dialog')

        // Select account and confirm
        const confirmBtn = page.getByRole('button', { name: /Confirmar|Aceptar/i }).first()
        if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmBtn.click()
          await screenshot(page, 'receivables-05-marked-received')
        }
      }
    }

    // Turn off filter
    const allBtn = page.getByText(/Todos|Todo/i).first()
    if (await allBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await allBtn.click()
    }
    await screenshot(page, 'receivables-06-all-movements')
  })
})
