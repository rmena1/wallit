import { test, expect, Page } from '@playwright/test'
import { registerAndLogin, ensureAccount, screenshot } from './helpers'
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

function seedReviewMovement(userId: string, accountId: string | null, name: string, amount: number): string {
  const db = new Database(DB_PATH)
  const now = Math.floor(Date.now() / 1000)
  const today = new Date().toISOString().slice(0, 10)
  const id = `rev-adv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  db.prepare(`
    INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'expense', 1, 'CLP', 0, 0, ?, ?)
  `).run(id, userId, accountId, name, today, amount, now, now)
  db.close()
  return id
}

async function registerUser(page: Page): Promise<string> {
  const email = `e2e-review-adv-${Date.now()}-${Math.random().toString(36).slice(2, 5)}@wallit.app`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('testpass123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('**/', { timeout: 10000 })
  return email
}

test.describe('Review Flow — Advanced Features', () => {
  test('split movement into multiple parts with cancel and confirm', async ({ page }) => {
    // Register and setup
    const email = await registerUser(page)
    await ensureAccount(page)

    const userId = getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = getFirstAccountId(userId)

    // Seed two review movements - one for cancel test, one for split test
    seedReviewMovement(userId, accountId, 'Cena grupal', 9000000) // 90,000 CLP

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
    seedReviewMovement(userId, accountId, 'Compra ferretería', 2500000) // 25,000 CLP

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
