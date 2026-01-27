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
  // Check if "Add Movement" is visible — if so, accounts exist already
  const hasAddMovement = await page.getByRole('button', { name: /Add Movement/i }).isVisible().catch(() => false)
  if (hasAddMovement) return

  // No accounts — need to create one
  // Click "Add Account" from empty state
  const addAccountBtn = page.getByRole('button', { name: 'Add Account' })
  if (await addAccountBtn.isVisible().catch(() => false)) {
    await addAccountBtn.click()
  } else {
    await page.getByTitle('Manage Accounts').click()
  }

  // Wait for the form
  await expect(page.getByPlaceholder('Last 4 digits')).toBeVisible({ timeout: 5000 })

  await page.locator('select[name="bankName"]').selectOption('BCI')
  await page.locator('select[name="accountType"]').selectOption('Corriente')
  await page.getByPlaceholder('Last 4 digits').fill('1234')
  await page.getByRole('button', { name: /Add$/i }).click()

  // Wait for account to be created and page to refresh
  await expect(page.getByRole('button', { name: /Add Movement/i })).toBeVisible({ timeout: 5000 })
}

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page)
  })

  test('dashboard renders with balance card', async ({ page }) => {
    await expect(page.getByText('Balance').first()).toBeVisible()
    await expect(page.getByText('Income').first()).toBeVisible()
    await expect(page.getByText('Expenses').first()).toBeVisible()
    await expect(page.getByText('Recent Movements')).toBeVisible()

    await page.screenshot({ path: './e2e-results/screenshots/dashboard.png', fullPage: true })
  })

  test('empty state or accounts exist', async ({ page }) => {
    const hasAddMovement = await page.getByRole('button', { name: /Add Movement/i }).isVisible().catch(() => false)
    const hasEmptyState = await page.getByText('Add a bank account to start tracking').isVisible().catch(() => false)
    expect(hasAddMovement || hasEmptyState).toBeTruthy()

    await page.screenshot({ path: './e2e-results/screenshots/dashboard-state.png', fullPage: true })
  })

  test('create an account', async ({ page }) => {
    // Open accounts panel
    const addAccountBtn = page.getByRole('button', { name: 'Add Account' })
    if (await addAccountBtn.isVisible().catch(() => false)) {
      await addAccountBtn.click()
    } else {
      await page.getByTitle('Manage Accounts').click()
    }

    await expect(page.getByPlaceholder('Last 4 digits')).toBeVisible({ timeout: 5000 })

    const digits = String(Date.now()).slice(-4)
    await page.locator('select[name="bankName"]').selectOption('Santander')
    await page.locator('select[name="accountType"]').selectOption('Vista')
    await page.getByPlaceholder('Last 4 digits').fill(digits)
    await page.getByRole('button', { name: /Add$/i }).click()

    await expect(page.locator('div').filter({ hasText: new RegExp(`···${digits}`) }).first()).toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: './e2e-results/screenshots/account-created.png', fullPage: true })
  })

  test('add movement form with account selector', async ({ page }) => {
    await ensureAccount(page)

    await page.getByRole('button', { name: /Add Movement/i }).click()

    await expect(page.getByText('New Movement')).toBeVisible()
    await expect(page.locator('select[name="accountId"]')).toBeVisible()
    await expect(page.getByPlaceholder('What was it for?')).toBeVisible()
    await expect(page.getByPlaceholder('0.00')).toBeVisible()

    await page.screenshot({ path: './e2e-results/screenshots/add-form.png', fullPage: true })

    await page.getByRole('button', { name: /Add Movement/i }).click()
    await expect(page.getByText('New Movement')).not.toBeVisible()
  })

  test('create an expense', async ({ page }) => {
    await ensureAccount(page)

    const name = `Coffee-${Date.now()}`
    await page.getByRole('button', { name: /Add Movement/i }).click()
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('What was it for?').fill(name)
    await page.getByPlaceholder('0.00').fill('4.50')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText(name)).toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: './e2e-results/screenshots/expense-created.png', fullPage: true })
  })

  test('create an income', async ({ page }) => {
    await ensureAccount(page)

    const name = `Salary-${Date.now()}`
    await page.getByRole('button', { name: /Add Movement/i }).click()
    await page.getByText('↑ Income').click()
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('What was it for?').fill(name)
    await page.getByPlaceholder('0.00').fill('1000')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText(name)).toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: './e2e-results/screenshots/income-created.png', fullPage: true })
  })

  test('delete a movement', async ({ page }) => {
    await ensureAccount(page)

    const name = `Del-${Date.now()}`
    await page.getByRole('button', { name: /Add Movement/i }).click()
    await page.locator('select[name="accountId"]').selectOption({ index: 1 })
    await page.getByPlaceholder('What was it for?').fill(name)
    await page.getByPlaceholder('0.00').fill('1.00')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText(name)).toBeVisible({ timeout: 5000 })

    page.on('dialog', dialog => dialog.accept())

    const nameEl = page.getByText(name)
    const row = nameEl.locator('xpath=ancestor::div[contains(@style,"justify-content")]')
    await row.locator('button:has(svg)').click()

    await expect(page.getByText(name)).not.toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: './e2e-results/screenshots/movement-deleted.png', fullPage: true })
  })

  test('categories panel', async ({ page }) => {
    await page.getByTitle('Manage Categories').click()
    await expect(page.getByPlaceholder('🍕')).toBeVisible()

    const catName = `Cat-${Date.now()}`
    await page.getByPlaceholder('🍕').fill('🎮')
    await page.getByPlaceholder('Category name').fill(catName)
    await page.locator('form').filter({ has: page.getByPlaceholder('Category name') }).locator('button[type="submit"]').click()

    await expect(page.getByText(catName)).toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: './e2e-results/screenshots/category-created.png', fullPage: true })
  })

  test('full flow: account + movements', async ({ page }) => {
    await ensureAccount(page)

    const ts = Date.now()
    const items = [
      { name: `Lunch-${ts}`, amount: '12.50', type: 'expense' },
      { name: `Uber-${ts}`, amount: '8.00', type: 'expense' },
      { name: `Freelance-${ts}`, amount: '250', type: 'income' },
    ]

    for (const item of items) {
      await page.getByRole('button', { name: /Add Movement/i }).click()
      if (item.type === 'income') {
        await page.getByText('↑ Income').click()
      }
      await page.locator('select[name="accountId"]').selectOption({ index: 1 })
      await page.getByPlaceholder('What was it for?').fill(item.name)
      await page.getByPlaceholder('0.00').fill(item.amount)
      await page.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByText(item.name)).toBeVisible({ timeout: 5000 })
    }

    await page.screenshot({ path: './e2e-results/screenshots/dashboard-populated.png', fullPage: true })
  })
})
