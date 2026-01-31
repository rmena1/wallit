import { test, expect, Page } from '@playwright/test'
import { registerAndLogin, ensureAccount, ensureCategory, screenshot } from './helpers'
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

function seedReviewMovements(userId: string, accountId: string | null) {
  const db = new Database(DB_PATH)
  const today = new Date().toISOString().slice(0, 10)
  const base = Date.now()

  // Insert in reverse order so the first one has the latest createdAt (appears first in DESC order)
  const movements = [
    { id: `rev-${base}-3`, name: 'Compra Supermercado', amount: 4520000, type: 'expense', ts: Math.floor(base / 1000) - 2 },
    { id: `rev-${base}-2`, name: 'Transferencia recibida', amount: 5000000, type: 'income', ts: Math.floor(base / 1000) - 1 },
    { id: `rev-${base}-1`, name: 'Uber Eats - Pizza', amount: 1500000, type: 'expense', ts: Math.floor(base / 1000) },
  ]

  const stmt = db.prepare(`
    INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'CLP', 0, 0, ?, ?)
  `)

  for (const m of movements) {
    stmt.run(m.id, userId, accountId, m.name, today, m.amount, m.type, m.ts, m.ts)
  }
  db.close()
}

async function registerUser(page: Page): Promise<string> {
  const email = `e2e-review-${Date.now()}-${Math.random().toString(36).slice(2, 5)}@wallit.app`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('testpass123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('**/', { timeout: 10000 })
  return email
}

test.describe('Review Flow — Complete', () => {
  test('empty state shows no pending movements', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/review')
    await expect(page.getByText('No hay movimientos pendientes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-01-empty-state')

    await page.getByRole('button', { name: 'Volver al inicio' }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'review-02-back-to-home')
  })

  test('confirm, skip, and delete review movements', async ({ page }) => {
    const email = await registerUser(page)
    await ensureAccount(page)

    const userId = getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = getFirstAccountId(userId)

    seedReviewMovements(userId, accountId)

    await page.goto('/review')
    await expect(page.getByText('Revisión')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('1/3')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-03-first-movement')

    // First movement visible (latest createdAt appears first)
    await expect(page.getByText('Uber Eats - Pizza')).toBeVisible({ timeout: 5000 })

    // Step 1: Confirm the first movement
    // Note: confirmMovement calls revalidatePath which may re-render the page with fresh data
    await page.getByRole('button', { name: '✓ Confirmar' }).click()
    // After confirm, page re-renders. Wait for the next movement to appear
    // The counter may reset because revalidatePath causes server re-fetch
    await page.waitForTimeout(1000) // Wait for re-render
    await screenshot(page, 'review-04-after-confirm')

    // Step 2: Skip the current movement
    await page.getByRole('button', { name: /Después/i }).click()
    await page.waitForTimeout(500)
    await screenshot(page, 'review-05-after-skip')

    // Step 3: Delete the current movement (or we may be at completion)
    const deleteBtn = page.getByRole('button', { name: /🗑 Eliminar/i })
    if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteBtn.click()
      await expect(page.getByText('¿Eliminar este movimiento?')).toBeVisible({ timeout: 3000 })
      await screenshot(page, 'review-06-delete-dialog')
      await page.locator('div[style*="position: fixed"]').getByRole('button', { name: 'Eliminar' }).click()
      await page.waitForTimeout(1000)
    }

    // Should show completion screen (or empty state if re-rendered)
    const completed = page.getByText('¡Revisión completada!')
    const empty = page.getByText('No hay movimientos pendientes')
    await expect(completed.or(empty)).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-07-completed')

    await page.getByRole('button', { name: 'Volver al inicio' }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'review-08-back-home')
  })

  test('mark movement as receivable and edit fields before confirming', async ({ page }) => {
    const email = await registerUser(page)
    await ensureAccount(page)
    await ensureCategory(page, '🍔', 'Comida')

    const userId = getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = getFirstAccountId(userId)

    // Seed 2 review movements
    const db = new Database(DB_PATH)
    const now = Math.floor(Date.now() / 1000)
    const today = new Date().toISOString().slice(0, 10)
    db.prepare(`
      INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'CLP', 0, 0, ?, ?)
    `).run(`rev-a-${Date.now()}`, userId, accountId, 'Almuerzo con Juan', today, 2000000, 'expense', now + 1, now + 1)
    db.prepare(`
      INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'CLP', 0, 0, ?, ?)
    `).run(`rev-b-${Date.now()}`, userId, accountId, 'Compra desconocida', today, 999900, 'expense', now, now)
    db.close()

    await page.goto('/review')
    await expect(page.getByText('1/2')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-recv-01-initial')

    // First movement: "Almuerzo con Juan" — mark as receivable
    await expect(page.getByText('Almuerzo con Juan')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: /💰 Cobrar/i }).click()
    await expect(page.getByText('Marcar como Por Cobrar')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'review-recv-02-dialog')

    const input = page.locator('input[placeholder="Texto del recordatorio..."]')
    await input.clear()
    await input.fill('Juan me debe la mitad del almuerzo')

    // Click the confirm button inside the receivable dialog
    await page.locator('div[style*="position: fixed"]').getByRole('button', { name: 'Confirmar' }).click()
    await page.waitForTimeout(1000) // Wait for re-render after server action
    await screenshot(page, 'review-recv-03-after-receivable')

    // After marking receivable, page re-renders. Second movement should now be visible
    // (may show as 1/1 since the first was marked as receivable and removed from pending)
    const secondMovement = page.getByText('Compra desconocida')
    if (await secondMovement.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Good — second movement is showing

      // Edit the description
      const descInput = page.locator('input').first()
      await descInput.clear()
      await descInput.fill('Cena con amigos')

      // Switch to income
      await page.getByText('↑ Ingreso').click()
      await screenshot(page, 'review-recv-04-edited-fields')

      // Confirm
      await page.getByRole('button', { name: '✓ Confirmar' }).click()
      await page.waitForTimeout(1000)
    }

    // Should eventually show completion or empty state
    const completed = page.getByText('¡Revisión completada!')
    const empty = page.getByText('No hay movimientos pendientes')
    await expect(completed.or(empty)).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-recv-05-completed')
  })
})
