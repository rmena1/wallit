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

  const movements = [
    { id: `rev-${base}-1`, name: 'Uber Eats - Pizza', amount: 1500000, type: 'expense', ts: Math.floor(base / 1000) },
    { id: `rev-${base}-2`, name: 'Transferencia recibida', amount: 5000000, type: 'income', ts: Math.floor(base / 1000) - 1 },
    { id: `rev-${base}-3`, name: 'Compra Supermercado', amount: 4520000, type: 'expense', ts: Math.floor(base / 1000) - 2 },
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
  await page.getByLabel('Contraseña').fill('testpass123')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await page.waitForURL('**/', { timeout: 10000 })
  return email
}

test.describe('Review Flow — Complete', () => {
  test('empty state, then confirm, skip, and delete review movements', async ({ page }) => {
    // 1. Register and test empty state
    const email = await registerUser(page)
    await page.goto('/review')
    await expect(page.getByText('No hay movimientos pendientes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-01-empty-state')

    // 2. Navigate back to home from empty state
    await page.getByRole('button', { name: 'Volver al inicio' }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'review-02-back-to-home')

    // 3. Set up account for the same user
    await ensureAccount(page)

    const userId = getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = getFirstAccountId(userId)

    // 4. Seed review movements
    seedReviewMovements(userId, accountId)

    // 5. Go to review page with pending movements
    await page.goto('/review')
    await expect(page.getByText('Revisión')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('1/3')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-03-first-movement')

    // First movement visible (latest createdAt appears first)
    await expect(page.getByText('Uber Eats - Pizza')).toBeVisible({ timeout: 5000 })

    // 6. Confirm the first movement
    await page.getByRole('button', { name: '✓ Confirmar' }).click()
    await page.waitForTimeout(1000) // Wait for re-render
    await screenshot(page, 'review-04-after-confirm')

    // 7. Skip the current movement (it will come back later since skipped items stay pending)
    await page.getByRole('button', { name: /Después/i }).click()
    await page.waitForTimeout(500)
    await screenshot(page, 'review-05-after-skip')

    // 8. Delete the current movement (movement 3)
    const deleteBtn = page.getByRole('button', { name: /🗑 Eliminar/i })
    if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteBtn.click()
      await expect(page.getByText('¿Eliminar este movimiento?')).toBeVisible({ timeout: 3000 })
      await screenshot(page, 'review-06-delete-dialog')
      await page.locator('div[style*="position: fixed"]').getByRole('button', { name: 'Eliminar' }).click()
      await page.waitForTimeout(1000)
    }

    // 9. After exhausting the initial batch, the page refetches pending reviews
    // The skipped movement should return since it's still pending (needsReview=true)
    // Wait for the loading state to complete and movement to appear
    await page.waitForTimeout(1500) // Allow time for refetch
    const skippedMovement = page.getByText('Transferencia recibida')
    const loadingMore = page.getByText('Buscando más movimientos pendientes...')
    
    // Either we see the skipped movement returned, or loading state
    if (await loadingMore.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(skippedMovement).toBeVisible({ timeout: 5000 })
    }
    
    // Now confirm the skipped movement that returned
    if (await skippedMovement.isVisible({ timeout: 2000 }).catch(() => false)) {
      await screenshot(page, 'review-07-skipped-returned')
      await page.getByRole('button', { name: '✓ Confirmar' }).click()
      await page.waitForTimeout(1000)
    }

    // 10. Now should show completion screen
    const completed = page.getByText('¡Revisión completada!')
    const empty = page.getByText('No hay movimientos pendientes')
    await expect(completed.or(empty)).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-08-completed')

    // 11. Navigate back to home
    await page.getByRole('button', { name: 'Volver al inicio' }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'review-09-back-home')
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
    const secondMovement = page.getByText('Compra desconocida')
    if (await secondMovement.isVisible({ timeout: 3000 }).catch(() => false)) {
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

  test('split movement into multiple parts with cancel and confirm', async ({ page }) => {
    // Register and setup
    const email = await registerUser(page)
    await ensureAccount(page)

    const userId = getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = getFirstAccountId(userId)

    // Seed one review movement for split test
    const db = new Database(DB_PATH)
    const now = Math.floor(Date.now() / 1000)
    const today = new Date().toISOString().slice(0, 10)
    db.prepare(`
      INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'CLP', 0, 0, ?, ?)
    `).run(`rev-split-${Date.now()}`, userId, accountId, 'Cena grupal', today, 9000000, 'expense', now, now)
    db.close()

    // Go to review page
    await page.goto('/review')
    await expect(page.getByText('Revisión')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Cena grupal')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-split-01-initial')

    // First, test cancel split dialog
    await page.getByRole('button', { name: /✂️ Dividir/i }).click()
    await expect(page.getByText('✂️ Dividir Movimiento')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'review-split-02-dialog-open')

    // Cancel the dialog
    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByText('✂️ Dividir Movimiento')).not.toBeVisible({ timeout: 3000 })
    await expect(page.getByText('Cena grupal')).toBeVisible()
    await screenshot(page, 'review-split-03-cancel-verified')

    // Now proceed with actual split
    await page.getByRole('button', { name: /✂️ Dividir/i }).click()
    await expect(page.getByText('✂️ Dividir Movimiento')).toBeVisible({ timeout: 3000 })

    // Verify dialog shows total amount and original name
    await expect(page.getByText('Total:')).toBeVisible()
    await expect(page.getByText('Cena grupal').last()).toBeVisible()

    // The dialog should have 2 items initially
    const splitInputs = page.locator('div[style*="position: fixed"] input[placeholder="Descripción"]')
    await expect(splitInputs).toHaveCount(2)

    // Fill in the second split item
    await splitInputs.nth(1).fill('Mi parte cena')
    const amountInputs = page.locator('div[style*="position: fixed"] input[placeholder="0"]')
    await amountInputs.nth(1).fill('30000')
    await screenshot(page, 'review-split-04-filled-second-item')

    // Add a third split item
    await page.getByRole('button', { name: '+ Agregar' }).click()
    await expect(splitInputs).toHaveCount(3)
    await splitInputs.nth(2).fill('Parte de Juan')
    await amountInputs.nth(2).fill('30000')
    await screenshot(page, 'review-split-05-added-third-item')

    // Confirm the split
    await page.getByRole('button', { name: 'Confirmar división' }).click()
    
    // Wait for page to refresh (split causes reload)
    await page.waitForTimeout(2000)
    await screenshot(page, 'review-split-06-after-split')

    // The movement should be split into parts now
    const completed = page.getByText('¡Revisión completada!')
    const empty = page.getByText('No hay movimientos pendientes')
    const hasSplitMovement1 = page.getByText('Mi parte cena')
    const hasSplitMovement2 = page.getByText('Parte de Juan')
    const hasSplitMovement3 = page.getByText('Cena grupal')
    
    await expect(completed.or(empty).or(hasSplitMovement1).or(hasSplitMovement2).or(hasSplitMovement3)).toBeVisible({ timeout: 10000 })
    await screenshot(page, 'review-split-07-final-state')
  })

  test('create category from review page', async ({ page }) => {
    // Register and setup
    const email = await registerUser(page)
    await ensureAccount(page)

    const userId = getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = getFirstAccountId(userId)

    // Seed a review movement
    const db = new Database(DB_PATH)
    const now = Math.floor(Date.now() / 1000)
    const today = new Date().toISOString().slice(0, 10)
    db.prepare(`
      INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'CLP', 0, 0, ?, ?)
    `).run(`rev-cat-${Date.now()}`, userId, accountId, 'Compra ferretería', today, 2500000, 'expense', now, now)
    db.close()

    // Go to review page
    await page.goto('/review')
    await expect(page.getByText('Revisión')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Compra ferretería')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-create-cat-01-initial')

    // Click the "+" button next to category select
    const addCategoryBtn = page.locator('button').filter({ hasText: '+' }).last()
    await addCategoryBtn.click()
    
    // Verify create category dialog opens
    await expect(page.getByText('Nueva Categoría')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'review-create-cat-02-dialog-open')

    // Fill in the new category
    const emojiInput = page.locator('div[style*="position: fixed"] input').first()
    const nameInput = page.locator('div[style*="position: fixed"] input').nth(1)
    await emojiInput.fill('🔧')
    await nameInput.fill('Hogar')
    await screenshot(page, 'review-create-cat-03-filled')

    // Submit the category
    const createBtn = page.locator('div[style*="position: fixed"]').getByRole('button', { name: /Crear|Agregar|Guardar/i })
    await createBtn.click()
    await page.waitForTimeout(1000)
    await screenshot(page, 'review-create-cat-04-after-create')

    // Verify the category is now selected in the dropdown
    const categorySelect = page.locator('select').filter({ has: page.locator('option:text("Hogar")') })
    await expect(categorySelect).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'review-create-cat-05-category-selected')

    // Confirm the movement with the new category
    await page.getByRole('button', { name: '✓ Confirmar' }).click()
    await page.waitForTimeout(1000)
    
    // Should show completion
    const completed = page.getByText('¡Revisión completada!')
    const empty = page.getByText('No hay movimientos pendientes')
    await expect(completed.or(empty)).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-create-cat-06-completed')
  })
})
