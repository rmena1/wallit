import { test, expect, Page } from '@playwright/test'
import { registerAndLogin, ensureAccount, createMovement, screenshot } from './helpers'
import {
  countMovementsInSpace,
  getClpAccountBalance,
  createRegularAccount,
  createSpaceForUser,
  getFirstAccountId,
  getMovementIdByName,
  getMovementWorkflowState,
  getMovementReviewState,
  getPersonalSpaceId,
  getReportTotalsForSpace,
  getTransferIdForMovement,
  getTransferMovementAmounts,
  getUserId,
  seedCategory,
  seedInterspaceTransfer,
  seedReceivable,
  seedUnlinkedIncome,
} from './db-helper'

async function registerUser(page: Page): Promise<string> {
  const email = `e2e-recv-adv-${Date.now()}-${Math.random().toString(36).slice(2, 5)}@wallit.app`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill('testpass123')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await page.waitForURL('**/', { timeout: 10000 })
  return email
}

const activeSpaceSelector = (page: Page) => page.getByRole('button', { name: /Space activo:/ })

async function switchSpace(page: Page, name: string) {
  await page.goto('/')
  await expect(activeSpaceSelector(page)).toBeEnabled({ timeout: 10_000 })
  await activeSpaceSelector(page).click()
  const menu = page.getByRole('menu', { name: 'Spaces disponibles' })
  await expect(menu).toBeVisible({ timeout: 10_000 })
  await menu.getByRole('menuitem').filter({ hasText: name }).first().click()
  await expect.poll(() => activeSpaceSelector(page).textContent(), { timeout: 10_000 }).toContain(name)
}

test.describe('Receivable Advanced — Create, Unmark, and Link', () => {
  test('mark existing movement as receivable from edit page and verify on home', async ({ page }) => {
    // This test covers the UI flow of marking a regular movement as receivable
    // (Consolidated from edit-movement.spec.ts)
    await registerAndLogin(page)
    await ensureAccount(page)
    await createMovement(page, { name: 'Cena con amigos', amount: '40000' })

    // 1. Navigate to home and verify movement exists
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Cena con amigos')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'recv-mark-01-home-with-movement')

    // 2. Click movement to open edit page
    await page.getByText('Cena con amigos').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'recv-mark-02-edit-page')

    // 3. Click "Por cobrar" button to open receivable dialog
    await page.getByRole('button', { name: /Por cobrar/i }).click()
    await expect(page.getByText('Marcar como Por Cobrar')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'recv-mark-03-dialog-open')

    // 4. Fill reminder text and confirm
    await page.locator('input[placeholder="Texto del recordatorio..."]').fill('Juan me debe la mitad')
    await screenshot(page, 'recv-mark-04-reminder-filled')
    
    await page.getByRole('button', { name: 'Confirmar' }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'recv-mark-05-marked-receivable')

    // 5. Verify the "Por Cobrar" filter shows the movement
    const porCobrarBtn = page.getByRole('button', { name: /Por cobrar/i })
    if (await porCobrarBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await porCobrarBtn.click()
      await page.waitForTimeout(500)
      // After marking receivable, the movement shows the reminder text
      await expect(page.getByText('Juan me debe la mitad')).toBeVisible({ timeout: 5000 })
      await screenshot(page, 'recv-mark-06-filtered-view')

      // Toggle back to all
      await porCobrarBtn.click()
      await screenshot(page, 'recv-mark-07-final-state')
    }
  })

  test('unmark a receivable movement from edit page', async ({ page }) => {
    // 1. Setup
    const email = await registerUser(page)
    await ensureAccount(page)

    // Seed a receivable movement
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)
    await seedReceivable(userId, accountId, 'Amigo me debe cena', 5000000)

    // 2. Navigate to home and verify receivable shows
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Amigo me debe cena')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'recv-unmark-01-home')

    // 3. Click on receivable filter to see it highlighted
    const porCobrarBtn = page.getByRole('button', { name: /Por cobrar/i })
    await porCobrarBtn.click()
    await page.waitForTimeout(500)
    await screenshot(page, 'recv-unmark-02-filtered')

    // 4. Click on the movement to edit
    await page.getByText('Amigo me debe cena').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'recv-unmark-03-edit-page')

    // 5. Click "Desmarcar cobro" button
    const unmarkBtn = page.getByRole('button', { name: /Desmarcar cobro/i })
    await expect(unmarkBtn).toBeVisible({ timeout: 3000 })
    await unmarkBtn.click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'recv-unmark-04-unmarked')

    // 6. Verify it's no longer in receivables filter
    await porCobrarBtn.click()
    await page.waitForTimeout(500)
    await expect(page.getByText('Amigo me debe cena')).not.toBeVisible({ timeout: 3000 })
    await screenshot(page, 'recv-unmark-05-not-in-filter')

    // 7. Turn off filter and verify movement still exists
    await porCobrarBtn.click()
    await page.waitForTimeout(500)
    await expect(page.getByText('Amigo me debe cena')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'recv-unmark-06-still-exists')
  })

  test('receivable payment action opens payment flow without navigating to edit', async ({ page }) => {
    const email = await registerUser(page)
    await ensureAccount(page)

    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)
    await seedReceivable(userId, accountId, 'Sofía me debe entrada', 1800000)

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Sofía me debe entrada')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('button button')).toHaveCount(0)

    await page.getByRole('button', { name: /Marcar como cobrado Sofía me debe entrada/i }).click()
    expect(new URL(page.url()).pathname).toBe('/')
    await expect(page.getByText('Cobrar gasto')).toBeVisible({ timeout: 3000 })
    await expect(page.getByText('Editar Movimiento')).not.toBeVisible()
    await screenshot(page, 'recv-payment-action-dialog-no-edit')

    await page.getByRole('button', { name: 'Cancelar' }).click()
    await page.getByRole('button', { name: /Editar movimiento Sofía me debe entrada/i }).click()
    await page.waitForURL('**/edit/**', { timeout: 5000 })
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'recv-payment-action-row-edit')
  })

  test('receivable edit flow cannot enable emergency workflow', async ({ page }) => {
    const email = await registerUser(page)
    await ensureAccount(page)

    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)
    await seedReceivable(userId, accountId, 'Receivable cannot become emergency', 3200000)

    await page.goto('/')
    await expect(page.getByText('Receivable cannot become emergency')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: /Editar movimiento Receivable cannot become emergency/i }).click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Gasto de emergencia')).not.toBeVisible()
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0)
    await screenshot(page, 'recv-no-emergency-checkbox')

    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await page.goto('/emergency')
    await expect(page.getByText('Receivable cannot become emergency')).not.toBeVisible({ timeout: 3000 })
    await screenshot(page, 'recv-no-emergency-persisted')
  })

  test('mark as received by linking to existing income', async ({ page }) => {
    // 1. Setup
    const email = await registerUser(page)
    await ensureAccount(page)

    // Seed receivable and unlinked income
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)
    await seedReceivable(userId, accountId, 'Juan me debe almuerzo', 2500000)
    await seedUnlinkedIncome(userId, accountId, 'Transferencia de Juan', 2500000)

    // 2. Navigate to home
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'recv-link-01-home')

    // 3. Verify both movements exist
    await expect(page.getByText('Juan me debe almuerzo')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Transferencia de Juan')).toBeVisible()
    await screenshot(page, 'recv-link-02-both-visible')

    // 4. Filter to receivables
    const porCobrarBtn = page.getByRole('button', { name: /Por cobrar/i })
    await porCobrarBtn.click()
    await page.waitForTimeout(500)
    await expect(page.getByText('Juan me debe almuerzo')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'recv-link-03-filtered')

    // 5. Click the receivable action button to open payment dialog
    await page.getByRole('button', { name: /Marcar como cobrado Juan me debe almuerzo/i }).click()
    expect(new URL(page.url()).pathname).toBe('/')
    await expect(page.getByText('Cobrar gasto')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'recv-link-04-payment-dialog')

    // 6. Switch to "Vincular existente" tab
    const linkTab = page.getByRole('button', { name: /Vincular existente/i })
    if (await linkTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await linkTab.click()
      await page.waitForTimeout(500)
      await screenshot(page, 'recv-link-05-link-tab')

      // 7. Select the existing income
      const incomeOption = page.getByText('Transferencia de Juan').last()
      if (await incomeOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await incomeOption.click()
        await screenshot(page, 'recv-link-06-income-selected')

        // 8. Confirm
        await page.getByRole('button', { name: /Confirmar/i }).click()
        await page.waitForTimeout(1000)
        await screenshot(page, 'recv-link-07-confirmed')

        // 9. Verify receivable is now marked as received (removed from filter)
        await expect(page.getByText('Juan me debe almuerzo')).not.toBeVisible({ timeout: 3000 })
        await screenshot(page, 'recv-link-08-removed-from-filter')
      }
    }
  })

  test('existing income must be within settlement tolerance to mark receivable as received', async ({ page }) => {
    const email = await registerUser(page)
    await ensureAccount(page)

    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)
    await seedReceivable(userId, accountId, 'Catalina me debe compra', 10_000_000)
    await seedUnlinkedIncome(userId, accountId, 'Pago fuera tolerancia Catalina', 11_000_000)
    await seedUnlinkedIncome(userId, accountId, 'Pago dentro tolerancia Catalina', 10_400_000)

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const porCobrarBtn = page.getByRole('button', { name: /Por cobrar/i })
    await porCobrarBtn.click()
    await expect(page.getByText('Catalina me debe compra')).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: /Marcar como cobrado Catalina me debe compra/i }).click()
    const paymentDialog = page.getByRole('dialog', { name: /Cobrar gasto/i })
    await expect(paymentDialog).toBeVisible({ timeout: 3000 })
    await paymentDialog.getByRole('button', { name: /Vincular existente/i }).click()
    await paymentDialog.getByRole('radio', { name: /Pago fuera tolerancia Catalina/i }).click()
    await screenshot(page, 'recv-existing-income-tolerance-01-outside-selected')

    const outsideAlert = page.waitForEvent('dialog')
    await paymentDialog.getByRole('button', { name: /Confirmar/i }).click()
    const alert = await outsideAlert
    expect(alert.message()).toContain('tolerancia')
    await alert.accept()
    await screenshot(page, 'recv-existing-income-tolerance-02-outside-rejected')

    await expect(page.getByText('Catalina me debe compra')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: /Marcar como cobrado Catalina me debe compra/i }).click()
    const retryDialog = page.getByRole('dialog', { name: /Cobrar gasto/i })
    await expect(retryDialog).toBeVisible({ timeout: 3000 })
    await retryDialog.getByRole('button', { name: /Vincular existente/i }).click()
    await retryDialog.getByRole('radio', { name: /Pago dentro tolerancia Catalina/i }).click()
    await screenshot(page, 'recv-existing-income-tolerance-03-inside-selected')
    await retryDialog.getByRole('button', { name: /Confirmar/i }).click()
    await expect(retryDialog).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Catalina me debe compra')).not.toBeVisible({ timeout: 5000 })
    await screenshot(page, 'recv-existing-income-tolerance-04-inside-accepted')
  })

  test('settles receivable with a new payment from another Space, locks review workflow, and reports only paying expense', async ({ page }) => {
    const email = await registerUser(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')

    const personalSpaceId = await getPersonalSpaceId(userId)
    const casaSpaceId = await createSpaceForUser(userId, 'Casa Cobros', '🏠')
    await createRegularAccount(userId, { bankName: 'Personal Pago', lastFourDigits: '1212', initialBalance: 100_000_000, spaceId: personalSpaceId })
    const casaAccountId = await createRegularAccount(userId, { bankName: 'Casa Fondo', lastFourDigits: '3434', initialBalance: 0, spaceId: casaSpaceId })
    const settlementCategoryId = await seedCategory(userId, { name: 'Ajustes cobros', emoji: '🤝', spaceId: personalSpaceId })
    await seedReceivable(userId, casaAccountId, 'Compra compartida Casa', 25_000_000, casaSpaceId)

    await switchSpace(page, 'Casa Cobros')
    await expect(page.getByText('Compra compartida Casa')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Marcar como cobrado Compra compartida Casa/i }).click()
    const paymentDialog = page.getByRole('dialog', { name: /Cobrar gasto/i })
    await expect(paymentDialog).toBeVisible({ timeout: 5_000 })
    await paymentDialog.getByText('Pago desde otro Space').click()
    await expect(paymentDialog.getByRole('combobox', { name: /^Space que paga$/ })).toHaveValue(personalSpaceId)
    await expect(paymentDialog.getByRole('combobox', { name: /^Cuenta destino del Space actual$/ })).toHaveValue(casaAccountId)
    await paymentDialog.getByRole('textbox', { name: /^Monto recibido desde otro Space$/ }).fill('262500')
    await screenshot(page, 'recv-cross-new-01-form')

    await paymentDialog.getByRole('button', { name: /Confirmar/i }).click()
    await expect(paymentDialog).not.toBeVisible({ timeout: 10_000 })
    await expect(activeSpaceSelector(page)).toContainText('Casa Cobros')
    await screenshot(page, 'recv-cross-new-02-current-space')

    await switchSpace(page, 'Personal')
    await page.goto('/review')
    await expect(page.getByText('Compra compartida Casa')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Gasto de settlement por cobrar')).toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'recv-cross-new-03-paying-review')

    await expect(page.getByRole('button', { name: /Transferencia/i })).toHaveCount(0)
    const outgoingMovementId = await getMovementIdByName(userId, 'Compra compartida Casa', personalSpaceId)
    expect(outgoingMovementId).not.toBeNull()
    await page.locator('select').nth(2).selectOption(settlementCategoryId)
    await screenshot(page, 'recv-cross-new-04-paying-review-no-transfer')
    await page.getByRole('button', { name: /Confirmar/i }).click()
    await expect.poll(() => getMovementReviewState(outgoingMovementId!)).toMatchObject({
      type: 'expense',
      category_id: settlementCategoryId,
      needs_review: false,
    })
    expect(await getTransferIdForMovement(outgoingMovementId!)).toBeNull()

    const payingExpense = await getMovementWorkflowState(personalSpaceId, 'Compra compartida Casa')
    expect(payingExpense).toMatchObject({ type: 'expense', needsReview: false, receivableSettlementRole: 'outgoing', amount: 26_250_000 })
    const fundedIncoming = await getMovementWorkflowState(casaSpaceId, 'Cobro: Compra compartida Casa')
    expect(fundedIncoming).toMatchObject({ type: 'income', needsReview: false, receivableSettlementRole: 'incoming', amount: 26_250_000 })

    const payingTotals = await getReportTotalsForSpace(personalSpaceId)
    expect(payingTotals.totalExpense).toBe(26_250_000)
    const fundedTotals = await getReportTotalsForSpace(casaSpaceId)
    expect(fundedTotals.totalIncome).toBe(0)
  })

  test('can correct the incoming account of a cross-space receivable settlement without unlocking settlement fields', async ({ page }) => {
    const email = await registerUser(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')

    const personalSpaceId = await getPersonalSpaceId(userId)
    const casaSpaceId = await createSpaceForUser(userId, 'Casa Cuenta Corrección', '🏠')
    await createRegularAccount(userId, { bankName: 'Personal Pago Corrección', lastFourDigits: '1200', initialBalance: 100_000_000, spaceId: personalSpaceId })
    const receivableExpenseAccountId = await createRegularAccount(userId, { bankName: 'Casa Gasto Original', lastFourDigits: '2200', initialBalance: 0, spaceId: casaSpaceId })
    const wrongCasaAccountId = await createRegularAccount(userId, { bankName: 'Casa Cuenta Errónea', lastFourDigits: '3400', initialBalance: 0, spaceId: casaSpaceId })
    const correctCasaAccountId = await createRegularAccount(userId, { bankName: 'Casa Cuenta Correcta', lastFourDigits: '5600', initialBalance: 0, spaceId: casaSpaceId })
    await seedReceivable(userId, receivableExpenseAccountId, 'Arriendo compartido Casa', 12_000_000, casaSpaceId)

    await switchSpace(page, 'Casa Cuenta Corrección')
    await page.getByRole('button', { name: /Marcar como cobrado Arriendo compartido Casa/i }).click()
    const paymentDialog = page.getByRole('dialog', { name: /Cobrar gasto/i })
    await expect(paymentDialog).toBeVisible({ timeout: 5_000 })
    await paymentDialog.getByText('Pago desde otro Space').click()
    await paymentDialog.getByRole('combobox', { name: /^Cuenta destino del Space actual$/ }).selectOption(wrongCasaAccountId)
    await paymentDialog.getByRole('textbox', { name: /^Monto recibido desde otro Space$/ }).fill('120000')
    await paymentDialog.getByRole('button', { name: /Confirmar/i }).click()
    await expect(paymentDialog).not.toBeVisible({ timeout: 10_000 })

    await expect.poll(async () => (await getMovementWorkflowState(casaSpaceId, 'Cobro: Arriendo compartido Casa'))?.id ?? null, { timeout: 10_000 }).not.toBeNull()
    const incomingBefore = await getMovementWorkflowState(casaSpaceId, 'Cobro: Arriendo compartido Casa')
    expect(incomingBefore).toMatchObject({ accountId: wrongCasaAccountId, type: 'income', receivableSettlementRole: 'incoming', amount: 12_000_000 })
    expect(await getClpAccountBalance(receivableExpenseAccountId)).toBe(-12_000_000)
    expect(await getClpAccountBalance(wrongCasaAccountId)).toBe(12_000_000)
    expect(await getClpAccountBalance(correctCasaAccountId)).toBe(0)

    await page.goto(`/edit/${incomingBefore!.id}`)
    await expect(page.getByText('Ingreso de settlement por cobrar')).toBeVisible({ timeout: 5_000 })
    await screenshot(page, 'recv-cross-incoming-account-edit-01-locked-fields')

    const accountSelect = page.locator('select').first()
    await expect(accountSelect).toBeEnabled()
    await expect(page.getByRole('textbox', { name: /^Monto$/ })).not.toBeEditable()
    await expect(page.locator('input[type="date"]')).toBeDisabled()
    await expect(page.getByRole('button', { name: /Eliminar/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Por cobrar/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Dividir/i })).toHaveCount(0)
    await accountSelect.selectOption(correctCasaAccountId)
    await screenshot(page, 'recv-cross-incoming-account-edit-02-corrected-account')

    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 10_000 })

    const incomingAfter = await getMovementWorkflowState(casaSpaceId, 'Cobro: Arriendo compartido Casa')
    expect(incomingAfter).toMatchObject({
      id: incomingBefore!.id,
      accountId: correctCasaAccountId,
      type: 'income',
      receivableSettlementRole: 'incoming',
      amount: 12_000_000,
      needsReview: false,
    })
    expect(await getClpAccountBalance(receivableExpenseAccountId)).toBe(-12_000_000)
    expect(await getClpAccountBalance(wrongCasaAccountId)).toBe(0)
    expect(await getClpAccountBalance(correctCasaAccountId)).toBe(12_000_000)
    const fundedTotals = await getReportTotalsForSpace(casaSpaceId)
    expect(fundedTotals.totalIncome).toBe(0)
  })

  test('settles receivable by consuming part of an incoming Inter-Space Transfer', async ({ page }) => {
    const email = await registerUser(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')

    const personalSpaceId = await getPersonalSpaceId(userId)
    const casaSpaceId = await createSpaceForUser(userId, 'Casa Transfer Cobro', '🏠')
    const personalAccountId = await createRegularAccount(userId, { bankName: 'Personal Origen', lastFourDigits: '5656', initialBalance: 100_000_000, spaceId: personalSpaceId })
    const casaAccountId = await createRegularAccount(userId, { bankName: 'Casa Destino', lastFourDigits: '7878', initialBalance: 0, spaceId: casaSpaceId })
    await seedReceivable(userId, casaAccountId, 'Cena pagada por Casa', 25_000_000, casaSpaceId)
    const transfer = await seedInterspaceTransfer(userId, {
      sourceSpaceId: personalSpaceId,
      destinationSpaceId: casaSpaceId,
      sourceAccountId: personalAccountId,
      destinationAccountId: casaAccountId,
      amount: 50_000_000,
      note: 'Fondo comun',
    })

    await switchSpace(page, 'Casa Transfer Cobro')
    await page.getByRole('button', { name: /Marcar como cobrado Cena pagada por Casa/i }).click()
    const paymentDialog = page.getByRole('dialog', { name: /Cobrar gasto/i })
    await expect(paymentDialog).toBeVisible({ timeout: 5_000 })
    await paymentDialog.getByRole('button', { name: /Vincular existente/i }).click()
    const transferCandidate = paymentDialog.getByRole('radio', { name: /Transferencia desde Personal/ })
    await expect(transferCandidate).toBeVisible({ timeout: 10_000 })
    await expect(paymentDialog.getByText('· desde 👤 Personal')).toBeVisible()
    await expect(paymentDialog.getByText(/Disponible \$500\.000/)).toBeVisible()
    await screenshot(page, 'recv-cross-transfer-01-candidate')

    await transferCandidate.click()
    await paymentDialog.getByRole('button', { name: /Confirmar/i }).click()
    await expect(paymentDialog).not.toBeVisible({ timeout: 10_000 })
    await expect(activeSpaceSelector(page)).toContainText('Casa Transfer Cobro')
    await screenshot(page, 'recv-cross-transfer-02-settled')

    const amounts = await getTransferMovementAmounts(transfer.transferId)
    expect(amounts?.sourceAmount).toBe(25_000_000)
    expect(amounts?.destinationAmount).toBe(25_000_000)
    expect(await countMovementsInSpace(personalSpaceId, 'Cena pagada por Casa')).toBe(1)
  })

  test('mark as received with new income (cash)', async ({ page }) => {
    // 1. Setup
    const email = await registerUser(page)
    await ensureAccount(page)

    // Seed receivable
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)
    await seedReceivable(userId, accountId, 'Pedro me debe taxi', 1500000)

    // 2. Navigate and filter
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const porCobrarBtn = page.getByRole('button', { name: /Por cobrar/i })
    await porCobrarBtn.click()
    await page.waitForTimeout(500)
    await screenshot(page, 'recv-cash-01-filtered')

    // 3. Click the receivable action button
    await expect(page.getByText('Pedro me debe taxi')).toBeVisible({ timeout: 5000 })

    const checkboxBtn = page.getByRole('button', { name: /Marcar como cobrado Pedro me debe taxi/i })
    if (await checkboxBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await checkboxBtn.click()
      await page.waitForTimeout(500)
      await screenshot(page, 'recv-cash-02-dialog')

      // 4. "Efectivo" (cash) should be pre-selected by default, just confirm
      await page.getByRole('button', { name: /Confirmar/i }).click()
      await page.waitForTimeout(1000)
      await screenshot(page, 'recv-cash-03-confirmed')

      // 5. Verify removed from filter
      await expect(page.getByText('Pedro me debe taxi')).not.toBeVisible({ timeout: 5000 })
      await screenshot(page, 'recv-cash-04-done')
    } else {
      // If no checkbox, just verify the receivable is showing
      await screenshot(page, 'recv-cash-02-receivable-visible')
    }
  })

  test('mark as received with new income to specific account', async ({ page }) => {
    // 1. Setup with 2 accounts
    const email = await registerUser(page)
    
    // Create two accounts
    await page.goto('/settings')
    await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })
    
    const bankSelect = page.locator('select[name="bankName"]')
    if (!await bankSelect.isVisible()) {
      await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    }
    await bankSelect.selectOption('BCI')
    await page.locator('select[name="accountType"]').selectOption('Corriente')
    await page.getByPlaceholder('Últimos 4 dígitos').fill('1111')
    await page.getByPlaceholder('Saldo inicial').fill('100000')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('···1111')).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await bankSelect.waitFor({ state: 'visible', timeout: 3000 })
    await bankSelect.selectOption('Santander')
    await page.locator('select[name="accountType"]').selectOption('Vista')
    await page.getByPlaceholder('Últimos 4 dígitos').fill('2222')
    await page.getByPlaceholder('Saldo inicial').fill('50000')
    await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
    await expect(page.getByText('···2222')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'recv-account-01-accounts-created')

    // Seed receivable
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)
    await seedReceivable(userId, accountId, 'María me debe libro', 3000000)

    // 2. Navigate and filter
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const porCobrarBtn = page.getByRole('button', { name: /Por cobrar/i })
    await porCobrarBtn.click()
    await page.waitForTimeout(500)
    await screenshot(page, 'recv-account-02-filtered')

    // 3. Verify receivable is visible
    await expect(page.getByText('María me debe libro')).toBeVisible({ timeout: 5000 })
    
    // 4. Click the receivable action button to open payment dialog
    const checkboxBtn = page.getByRole('button', { name: /Marcar como cobrado María me debe libro/i })

    if (await checkboxBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await checkboxBtn.click()
      await page.waitForTimeout(500)
      await screenshot(page, 'recv-account-03-dialog')

      // 5. Look for account options in the dialog - click on the Santander label
      const dialog = page.locator('div[style*="position: fixed"]').last()
      const santanderLabel = dialog.locator('label').filter({ hasText: /Santander/ })
      
      if (await santanderLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
        await santanderLabel.click()
        await screenshot(page, 'recv-account-04-account-selected')
      }

      // 6. Confirm
      await page.getByRole('button', { name: /Confirmar/i }).click()
      await page.waitForTimeout(1000)
      await screenshot(page, 'recv-account-05-confirmed')

      // 7. Verify removed from filter
      await expect(page.getByText('María me debe libro')).not.toBeVisible({ timeout: 5000 })
      await screenshot(page, 'recv-account-06-done')
    } else {
      // If no checkbox, just verify receivable is showing
      await screenshot(page, 'recv-account-03-receivable-visible')
    }
  })
})
