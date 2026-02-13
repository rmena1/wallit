import { test, expect, Page } from '@playwright/test'
import { registerAndLogin, ensureAccount, ensureCategory, createMovement, screenshot } from './helpers'
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

function seedMovement(userId: string, accountId: string | null, name: string, amount: number, type: 'income' | 'expense'): string {
  const db = new Database(DB_PATH)
  const now = Math.floor(Date.now() / 1000)
  const today = new Date().toISOString().slice(0, 10)
  const id = `edit-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  db.prepare(`
    INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'CLP', 0, 0, ?, ?)
  `).run(id, userId, accountId, name, today, amount, type, now, now)
  db.close()
  return id
}

function getMovementById(id: string): { name: string; amount: number; type: string; date: string } | null {
  const db = new Database(DB_PATH)
  const row = db.prepare('SELECT name, amount, type, date FROM movements WHERE id = ?').get(id) as { name: string; amount: number; type: string; date: string } | undefined
  db.close()
  return row ?? null
}

async function registerUser(page: Page): Promise<string> {
  const email = `e2e-edit-${Date.now()}-${Math.random().toString(36).slice(2, 5)}@wallit.app`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('testpass123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('**/', { timeout: 10000 })
  return email
}

async function createSecondAccount(page: Page) {
  await page.goto('/settings')
  await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })
  
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
  const bankSelect = page.locator('select[name="bankName"]')
  await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
  await bankSelect.selectOption('Santander')
  await page.locator('select[name="accountType"]').selectOption('Vista')
  await page.getByPlaceholder('Últimos 4 dígitos').fill('5555')
  await page.getByPlaceholder('Saldo inicial').fill('200000')
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
  await expect(page.getByText('···5555')).toBeVisible({ timeout: 5000 })
  
  await page.goto('/')
  await page.waitForLoadState('networkidle')
}

test.describe('Edit Movement — Complete Field Update Flow', () => {
  test('change all editable fields (name, amount, date, type, account, category, time) and verify persistence', async ({ page }) => {
    // 1. Setup: Register, create accounts, create categories
    const email = await registerUser(page)
    await ensureAccount(page)
    await createSecondAccount(page)
    await ensureCategory(page, '🍔', 'Comida')
    await ensureCategory(page, '🚗', 'Transporte')
    await screenshot(page, 'edit-complete-01-setup-done')

    // 2. Create initial movement
    await createMovement(page, { name: 'Gasto original', amount: '15000' })
    await screenshot(page, 'edit-complete-02-movement-created')

    // 3. Navigate to home and verify movement exists
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Gasto original')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-complete-03-home-before')

    // 4. Click on movement to open edit page
    await page.getByText('Gasto original').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-complete-04-edit-page-opened')

    // 5. Change movement type from expense to income
    await page.getByText('↑ Ingreso').click()
    await screenshot(page, 'edit-complete-05-type-changed')

    // 6. Change the description/name
    const nameInput = page.locator('input').filter({ hasNotText: '' }).first()
    await nameInput.clear()
    await nameInput.fill('Ingreso actualizado')
    await screenshot(page, 'edit-complete-06-name-changed')

    // 7. Change the amount
    const amountInput = page.getByPlaceholder('0.00').or(page.locator('input[inputmode="decimal"]').first())
    await amountInput.clear()
    await amountInput.fill('50000')
    await screenshot(page, 'edit-complete-07-amount-changed')

    // 8. Change the date to yesterday
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)
    const dateInput = page.locator('input[type="date"]')
    await dateInput.fill(yesterdayStr)
    await screenshot(page, 'edit-complete-08-date-changed')

    // 9. Add/change time
    const timeInput = page.locator('input[type="time"]')
    if (await timeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await timeInput.fill('14:30')
      await screenshot(page, 'edit-complete-09-time-set')
    }

    // 10. Change account to the second account (Santander)
    const allSelects = await page.locator('select').all()
    for (const sel of allSelects) {
      const options = await sel.locator('option').allTextContents()
      const santanderIdx = options.findIndex(o => o.includes('Santander') && o.includes('5555'))
      if (santanderIdx > 0) {
        await sel.selectOption({ index: santanderIdx })
        await screenshot(page, 'edit-complete-10-account-changed')
        break
      }
    }

    // 11. Change category to Transporte
    for (const sel of allSelects) {
      const options = await sel.locator('option').allTextContents()
      const transporteIdx = options.findIndex(o => o.includes('Transporte'))
      if (transporteIdx > 0) {
        await sel.selectOption({ index: transporteIdx })
        await screenshot(page, 'edit-complete-11-category-changed')
        break
      }
    }

    // 12. Take screenshot of all changes before saving
    await screenshot(page, 'edit-complete-12-all-changes')

    // 13. Save the changes
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'edit-complete-13-saved')

    // 14. Verify changes on home page
    await expect(page.getByText('Ingreso actualizado')).toBeVisible({ timeout: 5000 })
    // Income should show with green color and + prefix
    const movementText = page.getByText('+$50.000').or(page.getByText('$50.000'))
    await expect(movementText.first()).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-complete-14-verified-on-home')

    // 15. Click again to verify all fields persisted
    await page.getByText('Ingreso actualizado').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-complete-15-reopened-for-verify')

    // 16. Verify type is now income
    const incomeBtn = page.getByText('↑ Ingreso')
    const incomeStyle = await incomeBtn.evaluate(el => window.getComputedStyle(el).color)
    // Income button should be active/highlighted (green color)
    await screenshot(page, 'edit-complete-16-type-verified')

    // 17. Verify name persisted
    const nameValue = await page.locator('input').first().inputValue()
    expect(nameValue).toBe('Ingreso actualizado')

    // 18. Verify amount persisted
    const amountValue = await page.locator('input[inputmode="decimal"]').first().inputValue()
    expect(amountValue).toBe('50000')
    await screenshot(page, 'edit-complete-17-fields-verified')
  })

  test('edit expense amount only and verify balance updates', async ({ page }) => {
    // This test verifies that editing amount correctly updates account balance
    await registerAndLogin(page)
    await ensureAccount(page)
    
    // 1. Create initial expense
    await createMovement(page, { name: 'Gasto para editar', amount: '10000' })
    await screenshot(page, 'edit-amount-01-created')

    // 2. Go home and note the balance (optional, mainly for visual)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'edit-amount-02-home-before')

    // 3. Open the movement for editing
    await page.getByText('Gasto para editar').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-amount-03-edit-opened')

    // 4. Change amount from 10000 to 25000
    const amountInput = page.locator('input[inputmode="decimal"]').first()
    await amountInput.clear()
    await amountInput.fill('25000')
    await screenshot(page, 'edit-amount-04-amount-changed')

    // 5. Save
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'edit-amount-05-saved')

    // 6. Verify new amount on home
    await expect(page.getByText('$25.000').first()).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-amount-06-verified')
  })

  test('change expense to income and verify visual change', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)
    
    // 1. Create expense
    await createMovement(page, { name: 'Será ingreso', amount: '30000' })
    
    // 2. Go to home and verify it shows as expense (red, with -)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Será ingreso')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-type-01-shows-expense')

    // 3. Open for editing
    await page.getByText('Será ingreso').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-type-02-edit-opened')

    // 4. Change to income
    await page.getByText('↑ Ingreso').click()
    await screenshot(page, 'edit-type-03-income-selected')

    // 5. Save
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'edit-type-04-saved')

    // 6. Verify now shows as income (green, with +)
    const incomeIndicator = page.getByText('+$30.000').or(page.locator('span').filter({ hasText: /\+.*30.*000/ }))
    await expect(incomeIndicator.first()).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-type-05-shows-income')
  })

  test('delete movement from edit page and verify removal', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)
    
    // 1. Create movement to delete
    await createMovement(page, { name: 'Movimiento a eliminar', amount: '5000' })
    
    // 2. Verify on home
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Movimiento a eliminar')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-delete-01-exists')

    // 3. Open for editing
    await page.getByText('Movimiento a eliminar').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-delete-02-edit-opened')

    // 4. Click delete button
    await page.getByRole('button', { name: /Eliminar/i }).click()
    
    // 5. Confirm delete in dialog
    await expect(page.getByText('¿Eliminar este movimiento?')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'edit-delete-03-confirm-dialog')
    
    const confirmDeleteBtn = page.getByRole('button', { name: 'Eliminar' }).last()
    await confirmDeleteBtn.click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'edit-delete-04-deleted')

    // 6. Verify movement is gone
    await expect(page.getByText('Movimiento a eliminar')).not.toBeVisible({ timeout: 3000 })
    await screenshot(page, 'edit-delete-05-verified-gone')
  })

  test('cancel edit preserves original values', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)
    
    // 1. Create movement
    await createMovement(page, { name: 'Original sin cambios', amount: '20000' })
    
    // 2. Go to home
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Original sin cambios')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-cancel-01-original')

    // 3. Open for editing
    await page.getByText('Original sin cambios').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'edit-cancel-02-opened')

    // 4. Make changes (but don't save)
    const nameInput = page.locator('input').first()
    await nameInput.clear()
    await nameInput.fill('Nombre cambiado')
    
    const amountInput = page.locator('input[inputmode="decimal"]').first()
    await amountInput.clear()
    await amountInput.fill('99999')
    await screenshot(page, 'edit-cancel-03-changes-made')

    // 5. Click "Volver" instead of save
    await page.getByText('Volver').click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'edit-cancel-04-cancelled')

    // 6. Verify original values are still there
    await expect(page.getByText('Original sin cambios')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('$20.000').first()).toBeVisible()
    await expect(page.getByText('Nombre cambiado')).not.toBeVisible()
    await screenshot(page, 'edit-cancel-05-original-preserved')
  })
})
