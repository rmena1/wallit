import { test, expect, Page } from '@playwright/test'
import { registerAndLogin, ensureAccount } from './helpers'

async function addExpenseMovement(page: Page, name: string, amount: string) {
  await page.goto('/add')
  await page.waitForLoadState('networkidle')

  // Select expense type
  await page.getByRole('button', { name: '↓ Gasto' }).click()

  // Fill form
  await page.getByLabel('Descripción').fill(name)
  await page.getByLabel('Monto').fill(amount)

  // Select first account
  const accountSelect = page.locator('select').filter({ hasText: /Seleccionar cuenta/ }).first()
  if (await accountSelect.isVisible()) {
    const options = await accountSelect.locator('option').allTextContents()
    const accountOption = options.find(o => !o.includes('Seleccionar'))
    if (accountOption) {
      await accountSelect.selectOption({ label: accountOption })
    }
  }

  // Submit
  await page.getByRole('button', { name: /Guardar/i }).click()
  await page.waitForURL('**/', { timeout: 10000 })
}

async function markAsEmergency(page: Page, movementName: string) {
  // Click on the movement to edit it
  await page.locator('div').filter({ hasText: new RegExp(`^${movementName}`) }).first().click()
  await page.waitForLoadState('networkidle')

  // Check the emergency checkbox
  const emergencyCheckbox = page.getByText('Gasto de emergencia')
  await expect(emergencyCheckbox).toBeVisible()
  await emergencyCheckbox.click()

  // Save
  await page.getByRole('button', { name: /Guardar cambios/i }).click()
  await page.waitForURL('**/', { timeout: 10000 })
}

test.describe('Emergency Expenses', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)
  })

  test('mark expense as emergency and see badge on dashboard', async ({ page }) => {
    // Add an expense
    await addExpenseMovement(page, 'Reparación auto', '500000')

    // Go home and click on the expense to edit
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Click on the movement
    await page.locator('div').filter({ hasText: /Reparación auto/ }).first().click()
    await page.waitForLoadState('networkidle')

    // Screenshot: edit page before marking emergency
    await page.screenshot({ path: 'e2e-results/screenshots/emergency-01-edit-before.png' })

    // Should see emergency checkbox (only for expenses)
    await expect(page.getByText('Gasto de emergencia')).toBeVisible()

    // Check the checkbox
    await page.locator('input[type="checkbox"]').check()

    // Screenshot: with emergency checked
    await page.screenshot({ path: 'e2e-results/screenshots/emergency-02-edit-checked.png' })

    // Save
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 10000 })

    // Dashboard should show emergency badge
    await page.waitForLoadState('networkidle')
    const badge = page.locator('a[href="/emergency"]')
    await expect(badge).toBeVisible({ timeout: 5000 })
    await expect(badge).toContainText('🚨')

    // Screenshot: dashboard with badge
    await page.screenshot({ path: 'e2e-results/screenshots/emergency-03-dashboard-badge.png' })
  })

  test('emergency list and detail page', async ({ page }) => {
    // Add and mark as emergency
    await addExpenseMovement(page, 'Emergencia médica', '300000')
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.locator('div').filter({ hasText: /Emergencia médica/ }).first().click()
    await page.waitForLoadState('networkidle')
    await page.locator('input[type="checkbox"]').check()
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 10000 })

    // Navigate to emergency list
    await page.goto('/emergency')
    await page.waitForLoadState('networkidle')

    // Should see the emergency
    await expect(page.getByText('Emergencia médica')).toBeVisible()

    // Screenshot: emergency list
    await page.screenshot({ path: 'e2e-results/screenshots/emergency-04-list.png' })

    // Click on it
    await page.getByText('Emergencia médica').click()
    await page.waitForLoadState('networkidle')

    // Should see detail page
    await expect(page.getByText('Total')).toBeVisible()
    await expect(page.getByText('Pagado')).toBeVisible()
    await expect(page.getByText('Restante')).toBeVisible()
    await expect(page.getByText('Abonar')).toBeVisible()

    // Screenshot: emergency detail
    await page.screenshot({ path: 'e2e-results/screenshots/emergency-05-detail.png' })
  })

  test('make partial payment on emergency', async ({ page }) => {
    // Add and mark as emergency
    await addExpenseMovement(page, 'Reparación techo', '200000')
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.locator('div').filter({ hasText: /Reparación techo/ }).first().click()
    await page.waitForLoadState('networkidle')
    await page.locator('input[type="checkbox"]').check()
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 10000 })

    // Go to emergency detail
    await page.goto('/emergency')
    await page.waitForLoadState('networkidle')
    await page.getByText('Reparación techo').click()
    await page.waitForLoadState('networkidle')

    // Click Abonar
    await page.getByRole('button', { name: /Abonar/i }).click()

    // Should see modal
    await expect(page.getByText('Abonar a emergencia')).toBeVisible()

    // Screenshot: payment modal
    await page.screenshot({ path: 'e2e-results/screenshots/emergency-06-payment-modal.png' })

    // Change amount to partial payment
    const amountInput = page.locator('input[inputmode="decimal"]')
    await amountInput.clear()
    await amountInput.fill('100000')

    // Confirm
    await page.getByRole('button', { name: /Confirmar abono/i }).click()
    await page.waitForLoadState('networkidle')

    // Should see payment in list
    await expect(page.getByText('Abonos (1)')).toBeVisible()

    // Screenshot: after payment
    await page.screenshot({ path: 'e2e-results/screenshots/emergency-07-after-payment.png' })
  })

  test('emergency checkbox not visible for income type', async ({ page }) => {
    // Add an expense and go to edit
    await addExpenseMovement(page, 'Test income check', '10000')
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.locator('div').filter({ hasText: /Test income check/ }).first().click()
    await page.waitForLoadState('networkidle')

    // Switch to income type
    await page.getByRole('button', { name: '↑ Ingreso' }).click()

    // Emergency checkbox should not be visible
    await expect(page.getByText('Gasto de emergencia')).not.toBeVisible()

    // Screenshot
    await page.screenshot({ path: 'e2e-results/screenshots/emergency-08-income-no-checkbox.png' })
  })
})
