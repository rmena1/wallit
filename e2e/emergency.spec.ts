import { test, expect, Page } from '@playwright/test'
import { registerAndLogin, ensureAccount } from './helpers'
import {
  createRegularAccount,
  getEmergencyPaymentTransferInfo,
  getFirstAccountId,
  getUserId,
  seedConfirmedWorkflowMovement,
  seedUsdToClpRate,
  transferAndEmergencyPaymentStillLinked,
} from './db-helper'

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

test.describe('Emergency Expenses', () => {
  test.setTimeout(90_000)

  let email: string

  test.beforeEach(async ({ page }) => {
    email = await registerAndLogin(page)
    await ensureAccount(page)
  })

  test('mark expense as emergency and see badge on dashboard', async ({ page }) => {
    // Add an expense
    await addExpenseMovement(page, 'Reparación auto', '500000')

    // Go home and click on the expense to edit
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Click on the movement
    await page.getByRole('button', { name: /Editar movimiento Reparación auto/ }).click()
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
    await page.getByRole('button', { name: /Editar movimiento Emergencia médica/ }).click()
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
    await page.getByRole('button', { name: /Editar movimiento Reparación techo/ }).click()
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

  test('rejects emergency partial payment above remaining balance', async ({ page }) => {
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)

    await seedConfirmedWorkflowMovement(userId, accountId, {
      name: 'Emergency Overpay Guard',
      clpAmount: 5000000,
      type: 'expense',
      emergency: true,
    })

    await page.goto('/emergency')
    await expect(page.getByText('Emergency Overpay Guard')).toBeVisible({ timeout: 5000 })
    await page.getByText('Emergency Overpay Guard').click()
    await expect(page.getByText('Restante')).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: /Abonar/i }).click()
    await expect(page.getByText('Abonar a emergencia')).toBeVisible()
    const amountInput = page.locator('input[inputmode="decimal"]').first()
    await amountInput.clear()
    await amountInput.fill('60000')
    await page.getByRole('button', { name: /Confirmar abono/i }).click()

    await expect(page.getByText('El abono no puede ser mayor al saldo restante')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.locator('main')).toContainText('$50.000')
    await expect(page.locator('main')).toContainText('$0')
    await expect(page.locator('main')).not.toContainText('-$')
    await expect(page.getByText('Abonos (0)')).toBeVisible()
    await page.screenshot({ path: 'e2e-results/screenshots/emergency-overpay-rejected.png' })
  })

  test('blocks normal edit and delete of transfer linked to emergency partial payment', async ({ page }) => {
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const emergencyAccountId = await getFirstAccountId(userId)
    if (!emergencyAccountId) throw new Error('Emergency account not found')
    const paymentAccountId = await createRegularAccount(userId, { bankName: 'Emergency Pay Source', lastFourDigits: '9090', initialBalance: 50_000_000 })

    const emergencyId = await seedConfirmedWorkflowMovement(userId, emergencyAccountId, {
      name: 'Emergency linked transfer guard',
      clpAmount: 20_000_000,
      type: 'expense',
      emergency: true,
    })

    await page.goto('/emergency')
    await expect(page.getByText('Emergency linked transfer guard')).toBeVisible({ timeout: 5_000 })
    await page.getByText('Emergency linked transfer guard').click()
    await expect(page.getByText('Restante')).toBeVisible({ timeout: 5_000 })

    await page.getByRole('button', { name: /Abonar/i }).click()
    await expect(page.getByText('Abonar a emergencia')).toBeVisible()
    await page.locator('select').nth(0).selectOption(paymentAccountId)
    await page.locator('select').nth(1).selectOption(emergencyAccountId)
    const amountInput = page.locator('input[inputmode="decimal"]').first()
    await amountInput.clear()
    await amountInput.fill('100000')
    await page.getByRole('button', { name: /Confirmar abono/i }).click()
    await expect(page.getByText('Abonos (1)')).toBeVisible({ timeout: 5_000 })

    const transferInfo = await getEmergencyPaymentTransferInfo(emergencyId)
    if (!transferInfo) throw new Error('Emergency payment transfer not found')

    await page.goto(`/edit/${transferInfo.sourceMovementId}`)
    await expect(page.getByText('Editar Transferencia')).toBeVisible({ timeout: 5_000 })
    const transferAmountInput = page.locator('input[inputmode="decimal"]').first()
    await transferAmountInput.clear()
    await transferAmountInput.fill('75000')
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await expect(page.getByText(/vinculada a un abono de emergencia.*no se puede editar/i)).toBeVisible({ timeout: 5_000 })

    await page.getByRole('button', { name: /Eliminar transferencia/i }).click()
    await expect(page.getByText('¿Eliminar esta transferencia?')).toBeVisible({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click()
    await expect(page.getByText(/vinculada a un abono de emergencia.*no se puede eliminar/i)).toBeVisible({ timeout: 5_000 })
    expect(await transferAndEmergencyPaymentStillLinked(transferInfo.transferId)).toBe(true)
    await page.screenshot({ path: 'e2e-results/screenshots/emergency-linked-transfer-blocked.png' })
  })

  test('USD emergency keeps total paid and remaining in USD after partial payment', async ({ page }) => {
    await seedUsdToClpRate(95000)

    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)

    await seedConfirmedWorkflowMovement(userId, accountId, {
      name: 'USD Emergency Exact',
      clpAmount: 9500000,
      usdAmount: 10000,
      exchangeRate: 95000,
      type: 'expense',
      currency: 'USD',
      emergency: true,
    })

    await page.goto('/emergency')
    await expect(page.getByText('USD Emergency Exact')).toBeVisible({ timeout: 5000 })
    const emergencyCard = page.locator('main').locator('div').filter({ hasText: 'USD Emergency Exact' }).first()
    await expect(emergencyCard).toContainText('US$100,00')
    await expect(emergencyCard).toContainText('Pagado: US$0,00')
    await expect(emergencyCard).toContainText('Restante: US$100,00')

    await page.getByText('USD Emergency Exact').click()
    await page.waitForLoadState('networkidle')
    const emergencySummary = page.locator('main').locator('div').filter({ hasText: 'Total' }).filter({ hasText: 'Pagado' }).filter({ hasText: 'Restante' }).first()
    await expect(emergencySummary).toContainText('US$100,00')
    await expect(emergencySummary).toContainText('US$0,00')
    await page.screenshot({ path: 'e2e-results/screenshots/emergency-usd-01-before-payment.png' })

    await page.getByRole('button', { name: /Abonar/i }).click()
    await expect(page.getByText('Abonar a emergencia')).toBeVisible()
    await expect(page.getByText('Monto (USD)')).toBeVisible()
    const amountInput = page.locator('input[inputmode="decimal"]').first()
    await amountInput.clear()
    await amountInput.fill('40')
    await page.getByRole('button', { name: /Confirmar abono/i }).click()

    await expect(page.getByText('Abonos (1)')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('main')).toContainText('US$40,00')
    await expect(page.locator('main')).toContainText('US$60,00')
    await page.screenshot({ path: 'e2e-results/screenshots/emergency-usd-02-after-payment.png' })
  })

  test('emergency checkbox not visible for income type', async ({ page }) => {
    // Add an expense and go to edit
    await addExpenseMovement(page, 'Test income check', '10000')
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /Editar movimiento Test income check/ }).click()
    await page.waitForLoadState('networkidle')

    // Switch to income type
    await page.getByRole('button', { name: '↑ Ingreso' }).click()

    // Emergency checkbox should not be visible
    await expect(page.getByText('Gasto de emergencia')).not.toBeVisible()

    // Screenshot
    await page.screenshot({ path: 'e2e-results/screenshots/emergency-08-income-no-checkbox.png' })
  })
})
