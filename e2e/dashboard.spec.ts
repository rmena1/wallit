import { test, expect, Page } from '@playwright/test'

const TEST_EMAIL = 'e2e-test@wallit.app'
const TEST_PASSWORD = 'testpass123'

async function registerAndLogin(page: Page) {
  await page.goto('/register')
  await page.getByLabel('Email').fill(TEST_EMAIL)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()

  const onDashboard = await page.waitForURL('**/', { timeout: 3000 }).then(() => true).catch(() => false)
  if (!onDashboard) {
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_EMAIL)
    await page.getByLabel('Password').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL('**/', { timeout: 5000 })
  }
}

async function ensureAccount(page: Page) {
  // Check if we have accounts by looking for the "Cuentas" section on home
  const hasAccounts = await page.locator('text=Cuentas').first().isVisible().catch(() => false)
  if (hasAccounts) return

  // No accounts — go to settings to create one
  await page.goto('/settings')
  await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })

  await page.locator('select[name="bankName"]').selectOption('BCI')
  await page.locator('select[name="accountType"]').selectOption('Corriente')
  await page.getByPlaceholder('Últimos 4 dígitos').fill('1234')
  await page.getByPlaceholder('Saldo inicial').fill('1000')
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()

  // Wait for account to be created
  await expect(page.getByText('BCI')).toBeVisible({ timeout: 5000 })

  // Navigate back to home
  await page.goto('/')
  await expect(page.getByText('Balance General')).toBeVisible({ timeout: 5000 })
}

test.describe('Dashboard - Home', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page)
  })

  test('home page renders with balance card', async ({ page }) => {
    await expect(page.getByText('Balance General')).toBeVisible()
    await expect(page.getByText('Ingresos')).toBeVisible()
    await expect(page.getByText('Gastos')).toBeVisible()
    await expect(page.getByText('Movimientos Recientes')).toBeVisible()

    await page.screenshot({ path: './e2e-results/screenshots/home-page.png', fullPage: true })
  })

  test('bottom navigation is visible', async ({ page }) => {
    // Check bottom nav items
    await expect(page.getByText('Inicio')).toBeVisible()
    await expect(page.getByText('Reportes')).toBeVisible()
    await expect(page.getByText('Config')).toBeVisible()

    await page.screenshot({ path: './e2e-results/screenshots/bottom-nav.png', fullPage: true })
  })

  test('navigate to settings via bottom nav', async ({ page }) => {
    await page.getByText('Config').click()
    await page.waitForURL('**/settings')
    await expect(page.getByText('Configuración')).toBeVisible()

    await page.screenshot({ path: './e2e-results/screenshots/settings-page.png', fullPage: true })
  })

  test('navigate to reports via bottom nav', async ({ page }) => {
    await page.getByText('Reportes').click()
    await page.waitForURL('**/reports')
    await expect(page.getByText('Reportes').first()).toBeVisible()

    await page.screenshot({ path: './e2e-results/screenshots/reports-page.png', fullPage: true })
  })

  test('navigate to add movement page', async ({ page }) => {
    await ensureAccount(page)

    // Click the + button (the green circle in nav)
    const addButton = page.locator('a[href="/add"]')
    await addButton.click()
    await page.waitForURL('**/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible()

    await page.screenshot({ path: './e2e-results/screenshots/add-movement-page.png', fullPage: true })
  })
})

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page)
    await page.goto('/settings')
  })

  test('create an account with initial balance', async ({ page }) => {
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })

    const digits = String(Date.now()).slice(-4)
    await page.locator('select[name="bankName"]').selectOption('Santander')
    await page.locator('select[name="accountType"]').selectOption('Vista')
    await page.getByPlaceholder('Últimos 4 dígitos').fill(digits)
    await page.getByPlaceholder('Saldo inicial').fill('500.00')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()

    await expect(page.getByText(`···${digits}`)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('$500.00').first()).toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: './e2e-results/screenshots/account-created.png', fullPage: true })
  })

  test('categories panel in settings', async ({ page }) => {
    await expect(page.getByText('Categorías')).toBeVisible()
    await expect(page.getByPlaceholder('🍕')).toBeVisible()

    const catName = `Cat-${Date.now()}`
    await page.getByPlaceholder('🍕').fill('🎮')
    await page.getByPlaceholder('Nombre de categoría').fill(catName)
    await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()

    await expect(page.getByText(catName)).toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: './e2e-results/screenshots/category-created.png', fullPage: true })
  })
})

test.describe('Movements', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)
  })

  test('create an expense', async ({ page }) => {
    const name = `Coffee-${Date.now()}`

    // Go to add movement page
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })

    // Expense is default
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill(name)
    await page.getByPlaceholder('0.00').fill('4.50')
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()

    // Should redirect to home
    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText(name)).toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: './e2e-results/screenshots/expense-created.png', fullPage: true })
  })

  test('create an income', async ({ page }) => {
    const name = `Salary-${Date.now()}`

    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })

    // Switch to income
    await page.getByText('↑ Ingreso').click()
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill(name)
    await page.getByPlaceholder('0.00').fill('1000')
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()

    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText(name)).toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: './e2e-results/screenshots/income-created.png', fullPage: true })
  })

  test('delete a movement', async ({ page }) => {
    const name = `Del-${Date.now()}`

    // Create movement
    await page.goto('/add')
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill(name)
    await page.getByPlaceholder('0.00').fill('1.00')
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()

    await page.waitForURL('**/', { timeout: 5000 })
    await expect(page.getByText(name)).toBeVisible({ timeout: 5000 })

    // Delete it
    page.on('dialog', dialog => dialog.accept())
    const nameEl = page.getByText(name)
    const row = nameEl.locator('xpath=ancestor::div[contains(@style,"justify-content")]')
    await row.locator('button:has(svg)').click()

    await expect(page.getByText(name)).not.toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: './e2e-results/screenshots/movement-deleted.png', fullPage: true })
  })

  test('account balance updates with movements', async ({ page }) => {
    const ts = Date.now()

    // Create expense
    await page.goto('/add')
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill(`Test-${ts}`)
    await page.getByPlaceholder('0.00').fill('50.00')
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()

    await page.waitForURL('**/', { timeout: 5000 })

    // Verify the balance is shown on home (account cards section)
    await expect(page.getByText('Cuentas')).toBeVisible()

    await page.screenshot({ path: './e2e-results/screenshots/balance-updated.png', fullPage: true })
  })

  test('full flow: account + movements + balance', async ({ page }) => {
    const ts = Date.now()
    const items = [
      { name: `Lunch-${ts}`, amount: '12.50', type: 'expense' },
      { name: `Uber-${ts}`, amount: '8.00', type: 'expense' },
      { name: `Freelance-${ts}`, amount: '250', type: 'income' },
    ]

    for (const item of items) {
      await page.goto('/add')
      await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })

      if (item.type === 'income') {
        await page.getByText('↑ Ingreso').click()
      }
      await page.locator('select[name="accountId"]').selectOption({ index: 1 })
      await page.getByPlaceholder('¿En qué se gastó?').fill(item.name)
      await page.getByPlaceholder('0.00').fill(item.amount)
      await page.getByRole('button', { name: /Guardar Movimiento/i }).click()

      await page.waitForURL('**/', { timeout: 5000 })
      await expect(page.getByText(item.name)).toBeVisible({ timeout: 5000 })
    }

    await page.screenshot({ path: './e2e-results/screenshots/dashboard-populated.png', fullPage: true })
  })
})
