import { test, expect, Page, Locator, Browser } from '@playwright/test'
import { screenshot, TEST_PASSWORD } from './helpers'
import { movementLedger } from '../src/lib/domain/movement-ledger'
import {
  addUserToSpace,
  countMovementsInSpace,
  createRegularAccount,
  createSpaceForUser,
  getClpAccountBalance,
  getMovementIdByName,
  getMovementWorkflowState,
  getPersonalSpaceId,
  getReportTotalsForSpace,
  getTransferIdForMovement,
  getTransferMovementAmounts,
  getUserId,
  removeUserFromSpace,
  seedCategory,
  seedConfirmedWorkflowMovement,
  seedReviewMovement,
  seedUsdReviewMovement,
  seedUsdToClpRate,
} from './db-helper'

async function registerUser(page: Page): Promise<string> {
  const email = `e2e-interspace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@wallit.app`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await page.waitForURL('**/', { timeout: 10_000 })
  return email
}


async function registerUserInNewContext(browser: Browser): Promise<string> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const email = await registerUser(page)
  await context.close()
  return email
}

async function login(page: Page, email: string) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await page.waitForURL('**/', { timeout: 10_000 })
}

async function recordTransferDirect(spaceId: string, actorUserId: string, params: {
  fromAccountId: string
  toAccountId?: string | null
  destinationSpaceId?: string
  fromAmount: number
  toAmount: number
  fromCurrency: 'CLP' | 'USD'
  toCurrency: 'CLP' | 'USD'
  date: string
  note?: string
  source?: { reportable?: boolean; categoryId?: string | null; receivable?: boolean; receivableText?: string | null }
  destination?: { reportable?: boolean; categoryId?: string | null }
}) {
  process.env.DATABASE_URL ||= 'postgresql://127.0.0.1:5432/wallit_e2e'
  return movementLedger.recordTransfer(spaceId, actorUserId, params)
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

async function selectOptionContaining(select: Locator, text: string) {
  await expect(select).toBeVisible({ timeout: 10_000 })
  const value = await expect.poll(async () => select.evaluate((element, searchText) => {
    const option = Array.from((element as HTMLSelectElement).options).find((candidate) =>
      !candidate.disabled && candidate.textContent?.includes(searchText)
    )
    return option?.value ?? null
  }, text), { timeout: 10_000 }).not.toBeNull().then(async () => select.evaluate((element, searchText) => {
    const option = Array.from((element as HTMLSelectElement).options).find((candidate) =>
      !candidate.disabled && candidate.textContent?.includes(searchText)
    )
    return option?.value ?? null
  }, text))
  if (!value) throw new Error(`No enabled option containing ${text}`)
  await select.selectOption(value)
}

async function expectOptionDisabled(select: Locator, text: string) {
  const disabled = await select.evaluate((element, searchText) => {
    const option = Array.from((element as HTMLSelectElement).options).find((candidate) =>
      candidate.textContent?.includes(searchText)
    )
    return option ? option.disabled : null
  }, text)
  expect(disabled).toBe(true)
}

async function readSummaryAmount(page: Page, label: 'Ingresos' | 'Gastos') {
  return page.locator(`text=${label}`).locator('..').locator('div').filter({ hasText: /\$/ }).first().textContent()
}

test.describe('Inter-Space Transfers', () => {
  test.describe.configure({ timeout: 120_000 })



  test('creates a transfer from a shared Space to another member Personal Space without exposing personal accounts', async ({ browser, page }) => {
    const ownerEmail = await registerUser(page)
    const ownerUserId = await getUserId(ownerEmail)
    if (!ownerUserId) throw new Error('Owner user not found')

    const memberEmail = await registerUserInNewContext(browser)
    const memberUserId = await getUserId(memberEmail)
    if (!memberUserId) throw new Error('Member user not found')

    const memberPersonalSpaceId = await getPersonalSpaceId(memberUserId)
    const memberPersonalAccountId = await createRegularAccount(memberUserId, {
      bankName: 'Member Secret Bank',
      lastFourDigits: '7788',
      initialBalance: 0,
      spaceId: memberPersonalSpaceId,
    })

    const sharedSpaceId = await createSpaceForUser(ownerUserId, 'Shared Member Transfer', '🤝')
    const sharedAccountId = await createRegularAccount(ownerUserId, {
      bankName: 'Shared Wallet',
      lastFourDigits: '8899',
      initialBalance: 100_000_000,
      spaceId: sharedSpaceId,
    })
    await addUserToSpace(memberUserId, sharedSpaceId)

    await switchSpace(page, 'Shared Member Transfer')
    await page.goto('/add')
    await page.getByText('↔️ Transferencia').click()
    await selectOptionContaining(page.getByLabel('Desde cuenta'), 'Shared Wallet')
    await selectOptionContaining(page.getByLabel('Space destino'), memberEmail)
    await expect(page.getByText('Member Secret Bank')).not.toBeVisible({ timeout: 3_000 })
    await expect(page.getByLabel('Hacia cuenta')).not.toBeVisible({ timeout: 3_000 })
    await expect(page.getByText(/Cuenta destino pendiente/i)).toBeVisible({ timeout: 10_000 })
    await page.getByLabel('Monto origen').fill('42000')
    await selectOptionContaining(page.getByLabel('Categoría origen'), 'Home')
    await page.getByPlaceholder('ej: Pago tarjeta de crédito').fill('Member pending destination')
    await screenshot(page, 'interspace-member-pending-01-owner-form')
    await page.getByRole('button', { name: /Crear Transferencia/i }).click()
    await page.waitForURL('**/', { timeout: 10_000 })
    await expect(page.getByText(/Transferencia a Personal del receptor · Member pending destination/)).toBeVisible({ timeout: 10_000 })

    const sourceMovement = await getMovementWorkflowState(sharedSpaceId, 'Member pending destination')
    expect(sourceMovement).toMatchObject({ accountId: sharedAccountId, type: 'expense', needsReview: false, reportable: true, amount: 4_200_000 })

    const destinationMovement = await getMovementWorkflowState(memberPersonalSpaceId, 'Member pending destination')
    expect(destinationMovement).toMatchObject({ accountId: null, type: 'income', needsReview: true, reportable: true, amount: 4_200_000 })

    await login(page, memberEmail)
    await switchSpace(page, 'Personal')
    await expect(page.getByText(/Transferencia desde Shared Member Transfer · Member pending destination/)).toBeVisible({ timeout: 10_000 })
    await page.getByText(/Transferencia desde Shared Member Transfer · Member pending destination/).first().click()
    await page.waitForURL('**/edit/**', { timeout: 10_000 })
    await expect(page.getByText('Editar Transferencia')).toBeVisible({ timeout: 10_000 })
    await selectOptionContaining(page.getByLabel('Cuenta destino'), 'Member Secret Bank')
    await selectOptionContaining(page.getByLabel('Categoría destino transferencia'), 'Home')
    await screenshot(page, 'interspace-member-pending-02-receiver-confirm')
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 10_000 })

    const confirmedDestination = await getMovementWorkflowState(memberPersonalSpaceId, 'Member pending destination')
    expect(confirmedDestination).toMatchObject({ accountId: memberPersonalAccountId, type: 'income', needsReview: false, reportable: true, amount: 4_200_000 })
  })

  test('server rejects forged pending Personal destinations and forged destination accounts', async ({ browser, page }) => {
    const ownerEmail = await registerUser(page)
    const ownerUserId = await getUserId(ownerEmail)
    if (!ownerUserId) throw new Error('Owner user not found')

    const memberEmail = await registerUserInNewContext(browser)
    const memberUserId = await getUserId(memberEmail)
    if (!memberUserId) throw new Error('Member user not found')

    const outsiderEmail = await registerUserInNewContext(browser)
    const outsiderUserId = await getUserId(outsiderEmail)
    if (!outsiderUserId) throw new Error('Outsider user not found')

    const memberPersonalSpaceId = await getPersonalSpaceId(memberUserId)
    const memberPersonalAccountId = await createRegularAccount(memberUserId, {
      bankName: 'Member Private Account',
      lastFourDigits: '4545',
      initialBalance: 0,
      spaceId: memberPersonalSpaceId,
    })
    const outsiderPersonalSpaceId = await getPersonalSpaceId(outsiderUserId)

    const sharedSpaceId = await createSpaceForUser(ownerUserId, 'Shared Server Guard', '🛡️')
    const sharedAccountId = await createRegularAccount(ownerUserId, {
      bankName: 'Shared Guard Wallet',
      lastFourDigits: '1212',
      initialBalance: 100_000_000,
      spaceId: sharedSpaceId,
    })
    await addUserToSpace(memberUserId, sharedSpaceId)

    const arbitraryDestination = await recordTransferDirect(sharedSpaceId, ownerUserId, {
      fromAccountId: sharedAccountId,
      toAccountId: null,
      destinationSpaceId: outsiderPersonalSpaceId,
      fromAmount: 12_300,
      toAmount: 12_300,
      fromCurrency: 'CLP',
      toCurrency: 'CLP',
      date: new Date().toISOString().slice(0, 10),
      note: 'forged outsider destination',
    })

    expect(arbitraryDestination.success).toBe(false)
    expect(await getMovementWorkflowState(outsiderPersonalSpaceId, 'forged outsider destination')).toBeNull()

    const forgedAccount = await recordTransferDirect(sharedSpaceId, ownerUserId, {
      fromAccountId: sharedAccountId,
      toAccountId: memberPersonalAccountId,
      destinationSpaceId: memberPersonalSpaceId,
      fromAmount: 45_600,
      toAmount: 45_600,
      fromCurrency: 'CLP',
      toCurrency: 'CLP',
      date: new Date().toISOString().slice(0, 10),
      note: 'forged member account',
    })

    expect(forgedAccount.success).toBe(false)
    expect(await getMovementWorkflowState(memberPersonalSpaceId, 'forged member account')).toBeNull()
  })

  test('ledger requires explicit categories for reportable Inter-Space Transfer sides', async ({ page }) => {
    const email = await registerUser(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found')

    const personalSpaceId = await getPersonalSpaceId(userId)
    const casaSpaceId = await createSpaceForUser(userId, 'Casa Ledger Rule', '🏠')
    const personalAccountId = await createRegularAccount(userId, { bankName: 'Ledger Personal', lastFourDigits: '1010', initialBalance: 100_000_000, spaceId: personalSpaceId })
    const casaAccountId = await createRegularAccount(userId, { bankName: 'Ledger Casa', lastFourDigits: '2020', initialBalance: 0, spaceId: casaSpaceId })
    const personalCategoryId = await seedCategory(userId, { name: 'Ledger gasto', emoji: '🧾', spaceId: personalSpaceId })
    const casaCategoryId = await seedCategory(userId, { name: 'Ledger ingreso', emoji: '💰', spaceId: casaSpaceId })

    const missingCategories = await recordTransferDirect(personalSpaceId, userId, {
      fromAccountId: personalAccountId,
      toAccountId: casaAccountId,
      destinationSpaceId: casaSpaceId,
      fromAmount: 10_000,
      toAmount: 10_000,
      fromCurrency: 'CLP',
      toCurrency: 'CLP',
      date: new Date().toISOString().slice(0, 10),
      note: 'Sin categorías ledger',
    })
    expect(missingCategories).toMatchObject({ success: false })

    const classified = await recordTransferDirect(personalSpaceId, userId, {
      fromAccountId: personalAccountId,
      toAccountId: casaAccountId,
      destinationSpaceId: casaSpaceId,
      fromAmount: 10_000,
      toAmount: 10_000,
      fromCurrency: 'CLP',
      toCurrency: 'CLP',
      date: new Date().toISOString().slice(0, 10),
      note: 'Con categorías ledger',
      source: { reportable: true, categoryId: personalCategoryId },
      destination: { reportable: true, categoryId: casaCategoryId },
    })
    expect(classified).toMatchObject({ success: true })
  })

  test('creates, reports, edits and deletes an Inter-Space Transfer across timelines', async ({ page }) => {
    const email = await registerUser(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found')

    const personalSpaceId = await getPersonalSpaceId(userId)
    const casaSpaceId = await createSpaceForUser(userId, 'Casa', '🏠')
    const fondoSpaceId = await createSpaceForUser(userId, 'Fondo', '🐷')
    await createSpaceForUser(userId, 'Sin Cuentas', '🫙')

    const personalAccountId = await createRegularAccount(userId, { bankName: 'BCI Personal', lastFourDigits: '1111', initialBalance: 100_000_000, spaceId: personalSpaceId })
    const casaAccountId = await createRegularAccount(userId, { bankName: 'BCI Casa', lastFourDigits: '2222', initialBalance: 20_000_000, spaceId: casaSpaceId })
    const fondoAccountId = await createRegularAccount(userId, { bankName: 'BCI Fondo', lastFourDigits: '3333', initialBalance: 5_000_000, spaceId: fondoSpaceId })

    await page.goto('/add')
    await page.getByText('↔️ Transferencia').click()
    await screenshot(page, 'interspace-01-unified-transfer-form')

    await expectOptionDisabled(page.getByLabel('Space destino'), 'Sin Cuentas')
    await page.getByLabel('Desde cuenta').selectOption({ index: 1 })
    await selectOptionContaining(page.getByLabel('Space destino'), 'Casa')
    await selectOptionContaining(page.getByLabel('Hacia cuenta'), 'BCI Casa')
    await page.getByLabel('Monto origen').fill('50000')
    await selectOptionContaining(page.getByLabel('Categoría origen'), 'Home')
    await selectOptionContaining(page.getByLabel('Categoría destino'), 'Salary')
    await page.getByPlaceholder('ej: Pago tarjeta de crédito').fill('Arriendo mayo')
    await screenshot(page, 'interspace-02-personal-to-casa-filled')

    await page.getByRole('button', { name: /Crear Transferencia/i }).click()
    await page.waitForURL('**/', { timeout: 10_000 })
    await expect(page.getByText(/Transferencia a Casa · Arriendo mayo/)).toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'interspace-03-personal-timeline')

    expect(await getClpAccountBalance(personalAccountId)).toBe(95_000_000)
    expect(await getClpAccountBalance(casaAccountId)).toBe(25_000_000)

    await switchSpace(page, 'Casa')
    await expect(page.getByText(/Transferencia desde Personal · Arriendo mayo/)).toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'interspace-04-casa-timeline')

    await seedConfirmedWorkflowMovement(userId, personalAccountId, { name: 'Personal report expense', clpAmount: 1_000_000, type: 'expense', spaceId: personalSpaceId })
    await seedConfirmedWorkflowMovement(userId, casaAccountId, { name: 'Casa report expense', clpAmount: 2_000_000, type: 'expense', spaceId: casaSpaceId })

    expect(await getReportTotalsForSpace(personalSpaceId)).toMatchObject({ totalExpense: 6_000_000, count: 2 })
    expect(await getReportTotalsForSpace(casaSpaceId)).toMatchObject({ totalIncome: 5_000_000, totalExpense: 2_000_000, count: 2 })

    await switchSpace(page, 'Personal')
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 10_000 })
    await expect.poll(() => readSummaryAmount(page, 'Gastos'), { timeout: 10_000 }).toContain('$60.000')
    await screenshot(page, 'interspace-05-personal-reports-include-transfer')

    await switchSpace(page, 'Casa')
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 10_000 })
    await expect.poll(() => readSummaryAmount(page, 'Ingresos'), { timeout: 10_000 }).toContain('$50.000')
    await expect.poll(() => readSummaryAmount(page, 'Gastos'), { timeout: 10_000 }).toContain('$20.000')
    await screenshot(page, 'interspace-06-casa-reports-include-transfer')

    await switchSpace(page, 'Personal')
    await page.getByText(/Transferencia a Casa · Arriendo mayo/).first().click()
    await page.waitForURL('**/edit/**', { timeout: 10_000 })
    await expect(page.getByText('Editar Transferencia')).toBeVisible({ timeout: 10_000 })
    await selectOptionContaining(page.getByLabel('Space destino'), 'Fondo')
    await selectOptionContaining(page.getByLabel('Cuenta destino'), 'BCI Fondo')
    await selectOptionContaining(page.getByLabel('Categoría destino transferencia'), 'Salary')
    await screenshot(page, 'interspace-07-edit-destination-space')
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 10_000 })
    await expect(page.getByText(/Transferencia a Fondo · Arriendo mayo/)).toBeVisible({ timeout: 10_000 })

    expect(await getClpAccountBalance(casaAccountId)).toBe(18_000_000)
    expect(await getClpAccountBalance(fondoAccountId)).toBe(10_000_000)
    expect(await countMovementsInSpace(casaSpaceId, 'Arriendo mayo')).toBe(0)
    expect(await countMovementsInSpace(fondoSpaceId, 'Arriendo mayo')).toBe(1)

    await switchSpace(page, 'Fondo')
    await expect(page.getByText(/Transferencia desde Personal · Arriendo mayo/)).toBeVisible({ timeout: 10_000 })
    await page.getByText(/Transferencia desde Personal · Arriendo mayo/).first().click()
    await page.waitForURL('**/edit/**', { timeout: 10_000 })
    await page.getByRole('button', { name: /Eliminar transferencia/i }).click()
    await expect(page.getByText('¿Eliminar esta transferencia?')).toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'interspace-08-delete-from-destination-side')
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click()
    await page.waitForURL('**/', { timeout: 10_000 })

    expect(await countMovementsInSpace(personalSpaceId, 'Arriendo mayo')).toBe(0)
    expect(await countMovementsInSpace(fondoSpaceId, 'Arriendo mayo')).toBe(0)
  })

  test('allows one Inter-Space side to be operational while balances still move', async ({ page }) => {
    const email = await registerUser(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found')

    const personalSpaceId = await getPersonalSpaceId(userId)
    const casaSpaceId = await createSpaceForUser(userId, 'Casa Operacional', '🏠')
    const personalAccountId = await createRegularAccount(userId, { bankName: 'BCI Personal Op', lastFourDigits: '1122', initialBalance: 100_000_000, spaceId: personalSpaceId })
    const casaAccountId = await createRegularAccount(userId, { bankName: 'BCI Casa Op', lastFourDigits: '3344', initialBalance: 0, spaceId: casaSpaceId })

    await page.goto('/add')
    await page.getByText('↔️ Transferencia').click()
    await selectOptionContaining(page.getByLabel('Desde cuenta'), 'BCI Personal Op')
    await selectOptionContaining(page.getByLabel('Space destino'), 'Casa Operacional')
    await selectOptionContaining(page.getByLabel('Hacia cuenta'), 'BCI Casa Op')
    await page.getByLabel('Monto origen').fill('30000')
    await selectOptionContaining(page.getByLabel('Categoría origen'), 'Home')
    await page.getByLabel('Destino en reportes').uncheck()
    await page.getByPlaceholder('ej: Pago tarjeta de crédito').fill('Aporte operacional destino')
    await screenshot(page, 'interspace-operational-side-01-form')
    await page.getByRole('button', { name: /Crear Transferencia/i }).click()
    await page.waitForURL('**/', { timeout: 10_000 })

    expect(await getClpAccountBalance(personalAccountId)).toBe(97_000_000)
    expect(await getClpAccountBalance(casaAccountId)).toBe(3_000_000)
    expect(await getReportTotalsForSpace(personalSpaceId)).toMatchObject({ totalExpense: 3_000_000, count: 1 })
    expect(await getReportTotalsForSpace(casaSpaceId)).toMatchObject({ totalIncome: 0, count: 0 })

    const sourceMovement = await getMovementWorkflowState(personalSpaceId, 'Aporte operacional destino')
    expect(sourceMovement).toMatchObject({ type: 'expense', needsReview: false, reportable: true })
    const destinationMovement = await getMovementWorkflowState(casaSpaceId, 'Aporte operacional destino')
    expect(destinationMovement).toMatchObject({ type: 'income', needsReview: false, reportable: false, categoryId: null })
    await switchSpace(page, 'Casa Operacional')
    const operationalTimelineItem = page.getByRole('button', { name: /Editar movimiento/ }).filter({ hasText: /Transferencia desde Personal · Aporte operacional destino/ }).first()
    await expect(operationalTimelineItem).toBeVisible({ timeout: 10_000 })
    await expect(operationalTimelineItem).toContainText('operacional')
    await screenshot(page, 'interspace-operational-side-02-timeline')
  })

  test('transforms a pending review movement into an Inter-Space Transfer', async ({ page }) => {
    const email = await registerUser(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found')

    const personalSpaceId = await getPersonalSpaceId(userId)
    const casaSpaceId = await createSpaceForUser(userId, 'Casa Review', '🏠')
    const personalAccountId = await createRegularAccount(userId, { bankName: 'Review Personal', lastFourDigits: '4444', initialBalance: 100_000_000, spaceId: personalSpaceId })
    await createRegularAccount(userId, { bankName: 'Review Casa', lastFourDigits: '5555', initialBalance: 0, spaceId: casaSpaceId })
    await seedReviewMovement(userId, personalAccountId, 'Transferencia banco a casa', 12_000_000, personalSpaceId)

    await page.goto('/review')
    await expect(page.getByText('Transferencia banco a casa')).toBeVisible({ timeout: 10_000 })
    await page.getByText('↔️ Transfer').click()
    await selectOptionContaining(page.getByLabel('Space destino'), 'Casa Review')
    await selectOptionContaining(page.getByLabel('Hacia cuenta (destino)'), 'Review Casa')
    await selectOptionContaining(page.getByLabel('Categoría origen transferencia'), 'Home')
    await selectOptionContaining(page.getByLabel('Categoría destino transferencia'), 'Salary')
    await page.getByPlaceholder('ej: Pago tarjeta de crédito').fill('Fondo común')
    await screenshot(page, 'interspace-review-01-transform-form')
    const createTransferButton = page.getByRole('button', { name: /Crear Transfer/i })
    await createTransferButton.scrollIntoViewIfNeeded()
    await createTransferButton.evaluate((button) => (button as HTMLButtonElement).click())
    await expect(page.getByText(/Revisión completada|No hay movimientos pendientes/)).toBeVisible({ timeout: 10_000 })

    await page.goto('/')
    await expect(page.getByText(/Transferencia a Casa Review · Fondo común/)).toBeVisible({ timeout: 10_000 })
    const sourceMovement = await getMovementWorkflowState(personalSpaceId, 'Fondo común')
    expect(sourceMovement).toMatchObject({ type: 'expense', needsReview: false, reportable: true })
    await switchSpace(page, 'Casa Review')
    await expect(page.getByText(/Transferencia desde Personal · Fondo común/)).toBeVisible({ timeout: 10_000 })
    const destinationMovement = await getMovementWorkflowState(casaSpaceId, 'Fondo común')
    expect(destinationMovement).toMatchObject({ type: 'income', needsReview: false, reportable: true })
    await screenshot(page, 'interspace-review-02-destination-timeline')
  })

  test('lost destination Space access makes transfer edit unavailable without leaking destination details', async ({ page }) => {
    const email = await registerUser(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found')

    const personalSpaceId = await getPersonalSpaceId(userId)
    const casaSpaceId = await createSpaceForUser(userId, 'Casa Lost', '🏠')
    await createRegularAccount(userId, { bankName: 'Visible Personal Bank', lastFourDigits: '1010', initialBalance: 100_000_000, spaceId: personalSpaceId })
    await createRegularAccount(userId, { bankName: 'Secret Casa Bank', lastFourDigits: '2020', initialBalance: 0, spaceId: casaSpaceId })

    await page.goto('/add')
    await page.getByText('↔️ Transferencia').click()
    await page.getByLabel('Desde cuenta').selectOption({ index: 1 })
    await selectOptionContaining(page.getByLabel('Space destino'), 'Casa Lost')
    await selectOptionContaining(page.getByLabel('Hacia cuenta'), 'Secret Casa Bank')
    await page.getByLabel('Monto origen').fill('25000')
    await selectOptionContaining(page.getByLabel('Categoría origen'), 'Home')
    await selectOptionContaining(page.getByLabel('Categoría destino'), 'Salary')
    await page.getByPlaceholder('ej: Pago tarjeta de crédito').fill('Lost access audit')
    await page.getByRole('button', { name: /Crear Transferencia/i }).click()
    await page.waitForURL('**/', { timeout: 10_000 })
    await expect(page.getByText(/Transferencia a Casa Lost · Lost access audit/)).toBeVisible({ timeout: 10_000 })

    const sourceMovementId = await getMovementIdByName(userId, 'Transferencia a Casa Lost · Lost access audit', personalSpaceId)
    if (!sourceMovementId) throw new Error('Source transfer movement not found')

    await removeUserFromSpace(userId, casaSpaceId)
    await page.goto(`/edit/${sourceMovementId}`)
    await expect(page.getByText('Editar Transferencia')).not.toBeVisible({ timeout: 3_000 })
    await expect(page.getByText('Secret Casa Bank')).not.toBeVisible({ timeout: 3_000 })
    await screenshot(page, 'interspace-lost-access-no-leak')
  })

  test('pending review USD to USD transfer keeps USD amount instead of CLP equivalent', async ({ page }) => {
    await seedUsdToClpRate(95000)
    const email = await registerUser(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found')

    const personalSpaceId = await getPersonalSpaceId(userId)
    const sourceUsdAccountId = await createRegularAccount(userId, { bankName: 'USD Source', lastFourDigits: '3030', initialBalance: 100_000, currency: 'USD', spaceId: personalSpaceId })
    await createRegularAccount(userId, { bankName: 'USD Destination', lastFourDigits: '4040', initialBalance: 0, currency: 'USD', spaceId: personalSpaceId })
    const pendingMovementId = await seedUsdReviewMovement(userId, sourceUsdAccountId, 'Pending USD transfer audit', {
      clpAmount: 9_500_000,
      usdAmount: 10_000,
      exchangeRate: 95_000,
      spaceId: personalSpaceId,
    })

    await page.goto('/review')
    await expect(page.getByText('Pending USD transfer audit')).toBeVisible({ timeout: 10_000 })
    await page.getByText('↔️ Transfer').click()
    await selectOptionContaining(page.getByLabel('Hacia cuenta (destino)'), 'USD Destination')
    await page.waitForTimeout(300)
    await screenshot(page, 'interspace-review-usd-usd-amount')
    const createTransferButton = page.getByRole('button', { name: /Crear Transfer/i })
    await createTransferButton.scrollIntoViewIfNeeded()
    await createTransferButton.evaluate((button) => (button as HTMLButtonElement).click())
    await expect(page.getByText(/Revisión completada|No hay movimientos pendientes/)).toBeVisible({ timeout: 10_000 })

    const transferId = await getTransferIdForMovement(pendingMovementId)
    if (!transferId) throw new Error('Transfer was not created for pending USD movement')
    const amounts = await getTransferMovementAmounts(transferId)
    expect(amounts).toEqual({
      sourceAmount: 9_500_000,
      destinationAmount: 9_500_000,
      sourceAmountUsd: 10_000,
      destinationAmountUsd: 10_000,
    })
  })
})
