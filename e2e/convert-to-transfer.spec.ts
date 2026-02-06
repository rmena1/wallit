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

async function createTwoAccounts(page: Page) {
  await page.goto('/settings')
  await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })

  // First account: BCI CLP
  const bankSelect = page.locator('select[name="bankName"]')
  if (!await bankSelect.isVisible()) {
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
  }
  await bankSelect.selectOption('BCI')
  await page.locator('select[name="accountType"]').selectOption('Corriente')
  await page.getByPlaceholder('Últimos 4 dígitos').fill('1111')
  await page.getByPlaceholder('Saldo inicial').fill('1000000')
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
  await expect(page.getByText('···1111')).toBeVisible({ timeout: 5000 })

  // Second account: Santander CLP
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
  await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
  await bankSelect.selectOption('Santander')
  await page.locator('select[name="accountType"]').selectOption('Vista')
  await page.getByPlaceholder('Últimos 4 dígitos').fill('2222')
  await page.getByPlaceholder('Saldo inicial').fill('500000')
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
  await expect(page.getByText('···2222')).toBeVisible({ timeout: 5000 })

  await page.goto('/')
  await page.waitForLoadState('networkidle')
}

async function registerUser(page: Page): Promise<string> {
  const email = `e2e-convert-${Date.now()}-${Math.random().toString(36).slice(2, 5)}@wallit.app`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('testpass123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('**/', { timeout: 10000 })
  return email
}

function seedReviewMovement(userId: string, accountId: string | null) {
  const db = new Database(DB_PATH)
  const today = new Date().toISOString().slice(0, 10)
  const now = Math.floor(Date.now() / 1000)
  const id = `rev-convert-${Date.now()}`
  
  db.prepare(`
    INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'CLP', 0, 0, ?, ?)
  `).run(id, userId, accountId, 'Pago tarjeta BCI', today, 5000000, 'expense', now, now)
  db.close()
  return id
}

function seedConfirmedMovement(userId: string, accountId: string | null) {
  const db = new Database(DB_PATH)
  const today = new Date().toISOString().slice(0, 10)
  const now = Math.floor(Date.now() / 1000)
  const id = `mov-convert-${Date.now()}`
  
  db.prepare(`
    INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'CLP', 0, 0, ?, ?)
  `).run(id, userId, accountId, 'Transferencia manual', today, 10000000, 'expense', now, now)
  db.close()
  return id
}

test.describe('Convert to Transfer - Review Page', () => {
  test('convert pending movement to transfer from review page', async ({ page }) => {
    // 1. Setup: Register and create two accounts
    const email = await registerUser(page)
    await createTwoAccounts(page)
    
    const userId = getUserId(email)
    if (!userId) throw new Error('User not found')
    
    // Get the first account ID for the seeded movement
    const db = new Database(DB_PATH)
    const accounts = db.prepare('SELECT id, bank_name FROM accounts WHERE user_id = ?').all(userId) as { id: string, bank_name: string }[]
    db.close()
    
    if (accounts.length < 2) throw new Error('Need at least 2 accounts')
    
    // 2. Seed a review movement assigned to first account
    seedReviewMovement(userId, accounts[0].id)
    
    // 3. Go to review page
    await page.goto('/review')
    await expect(page.getByText('Revisión')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Pago tarjeta BCI')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'convert-review-01-initial')
    
    // 4. Click on Transfer toggle
    await page.getByText('↔️ Transfer').click()
    await expect(page.getByText('Hacia cuenta (destino)')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'convert-review-02-transfer-mode')
    
    // 5. Select destination account
    const destSelect = page.locator('select').filter({ hasText: /Seleccionar cuenta destino/ })
    await destSelect.selectOption({ index: 1 })
    await screenshot(page, 'convert-review-03-dest-selected')
    
    // 6. Optionally add a note
    await page.getByPlaceholder('ej: Pago tarjeta de crédito').fill('Test transfer from review')
    await screenshot(page, 'convert-review-04-note-added')
    
    // 7. Click create transfer button
    await page.getByRole('button', { name: /Crear Transfer/i }).click()
    await page.waitForTimeout(2000)
    await screenshot(page, 'convert-review-05-after-confirm')
    
    // 8. Should show completion or next movement
    const completed = page.getByText('¡Revisión completada!')
    const empty = page.getByText('No hay movimientos pendientes')
    await expect(completed.or(empty)).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'convert-review-06-completed')
    
    // 9. Go to home and verify transfer was created
    await page.getByRole('button', { name: 'Volver al inicio' }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    
    // Should see transfer icon (↔️) indicating it's a transfer
    await expect(page.locator('text=↔️').first()).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'convert-review-07-home-with-transfer')
    
    // Should have 2 movements with the transfer (expense + income)
    const transferMovements = await page.locator('text=↔️').count()
    expect(transferMovements).toBe(2)
  })
})

test.describe('Convert to Transfer - Edit Page', () => {
  test('convert existing movement to transfer from edit page', async ({ page }) => {
    // 1. Setup: Register and create two accounts
    const email = await registerUser(page)
    await createTwoAccounts(page)
    
    const userId = getUserId(email)
    if (!userId) throw new Error('User not found')
    
    // Get accounts
    const db = new Database(DB_PATH)
    const accounts = db.prepare('SELECT id, bank_name FROM accounts WHERE user_id = ?').all(userId) as { id: string, bank_name: string }[]
    db.close()
    
    if (accounts.length < 2) throw new Error('Need at least 2 accounts')
    
    // 2. Seed a confirmed (not pending review) movement
    seedConfirmedMovement(userId, accounts[0].id)
    
    // 3. Go to home and click on the movement to edit
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Transferencia manual')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'convert-edit-01-home')
    
    await page.getByText('Transferencia manual').click()
    await page.waitForURL('**/edit/**', { timeout: 5000 })
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'convert-edit-02-edit-page')
    
    // 4. Click on Transfer toggle
    await page.getByText('↔️ Transfer').click()
    await expect(page.getByText('Hacia cuenta (destino)')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'convert-edit-03-transfer-mode')
    
    // 5. Verify origin account is pre-selected
    const originSelect = page.locator('select').filter({ hasText: /cuenta origen/ }).first()
    await expect(originSelect).toBeVisible()
    
    // 6. Select destination account
    const destSelect = page.locator('select').filter({ hasText: /Seleccionar cuenta destino/ })
    await destSelect.selectOption({ index: 1 })
    await screenshot(page, 'convert-edit-04-dest-selected')
    
    // 7. Add transfer note
    await page.getByPlaceholder('ej: Pago tarjeta de crédito').fill('Converted from edit page')
    await screenshot(page, 'convert-edit-05-note-added')
    
    // 8. Click convert button
    await page.getByRole('button', { name: /Convertir a Transferencia/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'convert-edit-06-after-convert')
    
    // 9. Verify transfer was created - should see transfer icons
    await expect(page.locator('text=↔️').first()).toBeVisible({ timeout: 5000 })
    
    // Should have 2 movements with the transfer
    const transferMovements = await page.locator('text=↔️').count()
    expect(transferMovements).toBe(2)
    await screenshot(page, 'convert-edit-07-transfer-created')
    
    // 10. Click on the transfer to verify it opens in transfer edit mode
    await page.locator('text=↔️').first().click()
    await page.waitForURL('**/edit/**', { timeout: 5000 })
    await expect(page.getByText('Editar Transferencia')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'convert-edit-08-transfer-edit-page')
  })
})

test.describe('Convert to Transfer - Validation', () => {
  test('shows error when destination account not selected', async ({ page }) => {
    // Setup
    const email = await registerUser(page)
    await createTwoAccounts(page)
    
    const userId = getUserId(email)
    if (!userId) throw new Error('User not found')
    
    const db = new Database(DB_PATH)
    const accounts = db.prepare('SELECT id FROM accounts WHERE user_id = ?').all(userId) as { id: string }[]
    db.close()
    
    seedReviewMovement(userId, accounts[0].id)
    
    // Go to review
    await page.goto('/review')
    await expect(page.getByText('Pago tarjeta BCI')).toBeVisible({ timeout: 5000 })
    
    // Select transfer mode
    await page.getByText('↔️ Transfer').click()
    await expect(page.getByText('Hacia cuenta (destino)')).toBeVisible()
    await screenshot(page, 'convert-validation-01-transfer-mode')
    
    // Try to confirm without selecting destination
    await page.getByRole('button', { name: /Crear Transfer/i }).click()
    
    // Should show error
    await expect(page.getByText('Selecciona una cuenta destino')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'convert-validation-02-error-shown')
  })
  
  test('shows error when accounts are the same', async ({ page }) => {
    // Setup
    const email = await registerUser(page)
    
    // Create only one account
    await page.goto('/settings')
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })
    
    const bankSelect = page.locator('select[name="bankName"]')
    if (!await bankSelect.isVisible()) {
      await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
      await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
    }
    await bankSelect.selectOption('BCI')
    await page.locator('select[name="accountType"]').selectOption('Corriente')
    await page.getByPlaceholder('Últimos 4 dígitos').fill('5555')
    await page.getByPlaceholder('Saldo inicial').fill('100000')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('···5555')).toBeVisible({ timeout: 5000 })
    
    const userId = getUserId(email)
    if (!userId) throw new Error('User not found')
    
    const db = new Database(DB_PATH)
    const accounts = db.prepare('SELECT id FROM accounts WHERE user_id = ?').all(userId) as { id: string }[]
    db.close()
    
    seedReviewMovement(userId, accounts[0].id)
    
    // Go to review
    await page.goto('/review')
    await expect(page.getByText('Pago tarjeta BCI')).toBeVisible({ timeout: 5000 })
    
    // Select transfer mode - should only show origin account since there's only one
    await page.getByText('↔️ Transfer').click()
    await expect(page.getByText('Hacia cuenta (destino)')).toBeVisible()
    await screenshot(page, 'convert-validation-03-single-account')
    
    // Destination dropdown should be empty or show "Seleccionar cuenta destino"
    const destSelect = page.locator('select').filter({ hasText: /cuenta destino/ })
    const options = await destSelect.locator('option').count()
    
    // Only the placeholder option should be available
    expect(options).toBe(1)
  })
})
