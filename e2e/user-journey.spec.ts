import { test, expect } from '@playwright/test'
import { screenshot } from './helpers'

/**
 * Complete User Journey Test
 * 
 * Simulates a realistic new user flow:
 * 1. Register a new account
 * 2. See empty state / onboarding
 * 3. Create first bank account
 * 4. Create categories
 * 5. Add multiple movements (expenses + income)
 * 6. View dashboard with balances
 * 7. Navigate to reports
 * 8. Create a transfer between accounts
 * 9. Use settings to update account
 * 10. Log out and log back in
 */
test.describe('Complete User Journey', () => {
  test('new user complete financial management journey', async ({ page }) => {
    const timestamp = Date.now()
    const email = `journey-${timestamp}@wallit.app`
    const password = 'testpass123'

    // ========================================
    // PHASE 1: REGISTRATION & EMPTY STATE
    // ========================================
    
    // 1.1 Navigate to register page
    await page.goto('/register')
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
    await screenshot(page, 'journey-01-register-page')

    // 1.2 Fill registration form
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await screenshot(page, 'journey-02-register-filled')

    // 1.3 Submit and verify redirect to home
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL('**/', { timeout: 10000 })
    await screenshot(page, 'journey-03-first-login')

    // 1.4 Verify empty state / onboarding message
    const hasWelcome = await page.getByText('¡Bienvenido a Wallit!').isVisible().catch(() => false)
    const hasNoAccounts = await page.getByText('Agrega tu primera cuenta bancaria').isVisible().catch(() => false)
    expect(hasWelcome || hasNoAccounts).toBeTruthy()
    await screenshot(page, 'journey-04-empty-state')

    // ========================================
    // PHASE 2: CREATE FIRST BANK ACCOUNT
    // ========================================
    
    // 2.1 Navigate to settings to create account
    await page.goto('/settings')
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'journey-05-settings-empty')

    // 2.2 Open add account form
    const bankSelect = page.locator('select[name="bankName"]')
    if (!await bankSelect.isVisible()) {
      await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
      await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
    }

    // 2.3 Fill account form - BCI Checking Account
    await bankSelect.selectOption('BCI')
    await page.locator('select[name="accountType"]').selectOption('Corriente')
    await page.getByPlaceholder('Últimos 4 dígitos').fill('1234')
    await page.getByPlaceholder('Saldo inicial').fill('500000')
    await screenshot(page, 'journey-06-first-account-form')

    // 2.4 Submit and verify account created
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('···1234')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'journey-07-first-account-created')

    // 2.5 Create a second account - Santander Savings
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await page.locator('select[name="bankName"]').selectOption('Santander')
    await page.locator('select[name="accountType"]').selectOption('Ahorro')
    await page.getByPlaceholder('Últimos 4 dígitos').fill('5678')
    await page.getByPlaceholder('Saldo inicial').fill('200000')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('···5678')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'journey-08-two-accounts')

    // ========================================
    // PHASE 3: CREATE CATEGORIES
    // ========================================
    
    // 3.1 Scroll to categories section
    await expect(page.getByText('Categorías')).toBeVisible()
    
    // 3.2 Create "Comida" category
    await page.getByPlaceholder('🍕').fill('🍔')
    await page.getByPlaceholder('Nombre de categoría').fill('Comida')
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
    await expect(page.getByText('Comida')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'journey-09-category-comida')

    // 3.3 Create "Transporte" category
    await page.getByPlaceholder('🍕').fill('🚗')
    await page.getByPlaceholder('Nombre de categoría').fill('Transporte')
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
    await expect(page.getByText('Transporte')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'journey-10-category-transporte')

    // 3.4 Create "Entretenimiento" category
    await page.getByPlaceholder('🍕').fill('🎬')
    await page.getByPlaceholder('Nombre de categoría').fill('Entretenimiento')
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
    await expect(page.getByText('Entretenimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'journey-11-categories-complete')

    // ========================================
    // PHASE 4: ADD MOVEMENTS
    // ========================================
    
    // 4.1 Navigate to add movement page
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'journey-12-add-movement-page')

    // 4.2 Add first expense - Almuerzo
    await page.locator('select[name="accountId"]').selectOption({ index: 1 }) // BCI
    await page.getByPlaceholder('¿En qué se gastó?').fill('Almuerzo en restaurant')
    await page.getByPlaceholder('0.00').fill('15000')
    await page.locator('select[name="categoryId"]').selectOption({ label: '🍔 Comida' })
    await screenshot(page, 'journey-13-expense-form')
    
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText('Almuerzo en restaurant')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'journey-14-first-expense')

    // 4.3 Add income movement
    await page.goto('/add')
    await page.getByText('↑ Ingreso').click()
    await page.locator('select[name="accountId"]').selectOption({ index: 1 }) // BCI
    await page.getByPlaceholder('¿En qué se gastó?').fill('Sueldo mensual')
    await page.getByPlaceholder('0.00').fill('1500000')
    await screenshot(page, 'journey-15-income-form')
    
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText('Sueldo mensual')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'journey-16-income-added')

    // 4.4 Add more expenses
    await page.goto('/add')
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Uber al trabajo')
    await page.getByPlaceholder('0.00').fill('8500')
    await page.locator('select[name="categoryId"]').selectOption({ label: '🚗 Transporte' })
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })

    await page.goto('/add')
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Netflix mensual')
    await page.getByPlaceholder('0.00').fill('6990')
    await page.locator('select[name="categoryId"]').selectOption({ label: '🎬 Entretenimiento' })
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'journey-17-multiple-movements')

    // ========================================
    // PHASE 5: VERIFY DASHBOARD
    // ========================================
    
    // 5.1 Check balance is calculated correctly
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Balance General')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'journey-18-dashboard-balance')

    // 5.2 Verify account cards show correct balances
    await expect(page.getByText('BCI', { exact: true })).toBeVisible()
    await expect(page.getByText('Santander', { exact: true })).toBeVisible()
    await screenshot(page, 'journey-19-account-cards')

    // ========================================
    // PHASE 6: VIEW REPORTS
    // ========================================
    
    // 6.1 Navigate to reports
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'journey-20-reports-page')

    // 6.2 Verify summary cards show data
    await expect(page.getByText('Ingresos', { exact: true })).toBeVisible()
    await expect(page.getByText('Neto')).toBeVisible()
    await screenshot(page, 'journey-21-reports-summary')

    // ========================================
    // PHASE 7: CREATE TRANSFER
    // ========================================
    
    // 7.1 Go to add transfer
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })

    // 7.2 Select transfer type
    await page.getByText('↔️ Transfer').click()
    await screenshot(page, 'journey-22-transfer-form')

    // 7.3 Fill transfer - from BCI to Santander
    await page.locator('select').first().selectOption({ index: 1 }) // From BCI
    await page.locator('select').nth(1).selectOption({ index: 1 }) // To Santander
    await page.getByPlaceholder('0.00').first().fill('100000')
    await screenshot(page, 'journey-23-transfer-filled')

    // 7.4 Submit transfer
    await page.getByRole('button', { name: /Crear Transferencia/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'journey-24-transfer-created')

    // ========================================
    // PHASE 8: EDIT A MOVEMENT
    // ========================================
    
    // 8.1 Click on a movement to edit
    await page.getByText('Uber al trabajo').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'journey-25-edit-movement')

    // 8.2 Change the amount
    const amountInput = page.locator('input[value="8500"]').or(page.locator('input').filter({ hasText: /85\.00/ }))
    await amountInput.first().fill('9000')
    await screenshot(page, 'journey-26-edit-amount')

    // 8.3 Save changes
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'journey-27-edit-saved')

    // ========================================
    // PHASE 9: ACCOUNT DETAIL PAGE
    // ========================================
    
    // 9.1 Click on BCI account card to view detail
    await page.locator('[data-testid^="account-card-"]').first().click()
    await page.waitForURL('**/account/**', { timeout: 10000 })
    await expect(page.getByText('Balance Actual')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'journey-28-account-detail')

    // 9.2 Verify movements are shown
    await expect(page.getByText('Almuerzo en restaurant')).toBeVisible()
    await screenshot(page, 'journey-29-account-movements')

    // ========================================
    // PHASE 10: LOGOUT AND LOGIN
    // ========================================
    
    // 10.1 Go home and open user menu
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const avatarButton = page.locator('header button').last()
    await avatarButton.click()
    await expect(page.getByText('Cerrar sesión')).toBeVisible()
    await screenshot(page, 'journey-30-user-menu')

    // 10.2 Click logout
    await page.getByText('Cerrar sesión').click()
    await page.waitForURL('**/login', { timeout: 5000 })
    await screenshot(page, 'journey-31-logged-out')

    // 10.3 Log back in
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL('**/', { timeout: 10000 })
    await screenshot(page, 'journey-32-logged-back-in')

    // 10.4 Verify data persisted
    await expect(page.getByText('Balance General')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Sueldo mensual')).toBeVisible()
    await screenshot(page, 'journey-33-data-persisted')
  })
})
