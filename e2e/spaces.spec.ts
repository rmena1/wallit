import { test, expect, type Browser, type Page } from '@playwright/test'
import { createAccount, createMovement, ensureCategory, registerAndLogin, screenshot, TEST_PASSWORD } from './helpers'
import {
  createRegularAccount,
  getMovementCreatedByByName,
  getMovementIdByName,
  getPersonalSpaceId,
  getSpaceIdByName,
  getUserId,
  seedCategory,
  seedConfirmedWorkflowMovement,
  seedReviewMovement,
} from './db-helper'

const selector = (page: Page) => page.getByRole('button', { name: /Space activo:/ })

async function selectedSpaceText(page: Page) {
  return selector(page).textContent()
}

async function openSpaceMenu(page: Page) {
  await expect(selector(page)).toBeEnabled({ timeout: 10_000 })
  if (await page.getByRole('menu', { name: 'Spaces disponibles' }).isVisible().catch(() => false)) return
  await selector(page).click()
  await expect(page.getByRole('menu', { name: 'Spaces disponibles' })).toBeVisible({ timeout: 10_000 })
}

async function switchSpace(page: Page, name: string) {
  await openSpaceMenu(page)
  const option = page.getByRole('menuitem').filter({ hasText: name }).first()
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()
  await expect.poll(() => selectedSpaceText(page), { timeout: 10_000 }).toContain(name)
}

async function expectSpaceOption(page: Page, name: string, visible: boolean) {
  await openSpaceMenu(page)
  await expect.poll(async () => {
    const options = await page.getByRole('menuitem').allTextContents().catch(() => [])
    return options.some((text) => text.toLowerCase().includes(name.toLowerCase()))
  }, { timeout: 10_000 }).toBe(visible)
  await page.keyboard.press('Escape').catch(() => {})
  await page.mouse.click(10, 10).catch(() => {})
}

async function createSpace(page: Page, name: string, emoji = '🏠') {
  await page.goto('/settings')
  await expect(page.getByText('Spaces')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('textbox', { name: 'Emoji del Space', exact: true }).fill(emoji)
  await page.getByRole('textbox', { name: 'Nombre del Space', exact: true }).fill(name)
  const button = page.getByRole('button', { name: 'Crear Space' })

  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(button).toBeEnabled({ timeout: 10_000 })
    await button.click()
    const switched = await expect.poll(() => selectedSpaceText(page), { timeout: 5_000 }).toContain(name.trim()).then(() => true).catch(() => false)
    if (switched) {
      await screenshot(page, `spaces-created-${name.toLowerCase().replace(/\W+/g, '-')}`)
      return
    }
  }

  await expect.poll(() => selectedSpaceText(page), { timeout: 10_000 }).toContain(name.trim())
  await screenshot(page, `spaces-created-${name.toLowerCase().replace(/\W+/g, '-')}`)
}

async function addMemberAndExpect(page: Page, email: string, expected: string | RegExp) {
  const field = page.getByLabel('Email del miembro')
  const button = page.getByRole('button', { name: 'Agregar', exact: true })

  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(field).toBeVisible({ timeout: 10_000 })
    await field.fill(email)
    await expect(button).toBeEnabled({ timeout: 10_000 })
    await button.click()
    const visible = await page.getByText(expected).isVisible({ timeout: 5_000 }).catch(() => false)
    if (visible) return
  }

  await expect(page.getByText(expected)).toBeVisible({ timeout: 10_000 })
}

async function registerUserInNewContext(browser: Browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const email = await registerAndLogin(page)
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

test.describe('Spaces — multi-user financial contexts', () => {
  test.describe.configure({ timeout: 240_000 })

  test('new user gets Personal, can create/switch Spaces, categories and data stay isolated', async ({ page }) => {
    const email = await registerAndLogin(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found')
    const personalSpaceId = await getPersonalSpaceId(userId)
    await expect(selector(page)).toBeVisible({ timeout: 10_000 })
    await expect.poll(() => selectedSpaceText(page), { timeout: 10_000 }).toContain('Personal')
    await screenshot(page, 'spaces-01-new-user-personal')

    await createAccount(page, { lastFourDigits: '1111', initialBalance: '100000' })
    await ensureCategory(page, '☕', 'Coffee Personal')
    await createMovement(page, { name: 'Personal Lunch', amount: '5000', categoryName: 'Coffee Personal' })
    await expect.poll(() => getMovementCreatedByByName(personalSpaceId, 'Personal Lunch')).toBe(userId)
    await screenshot(page, 'spaces-02-personal-basic-flow')

    await createSpace(page, 'Family', '🏠')
    await expect(page.getByText('Coffee Personal')).toBeVisible({ timeout: 10_000 })
    await ensureCategory(page, '🧪', 'Shared Only')
    await createAccount(page, { bankName: 'Santander', lastFourDigits: '2222', initialBalance: '200000' })
    await createMovement(page, { name: 'Family Groceries', amount: '12000', categoryName: 'Shared Only' })
    const familySpaceId = await getSpaceIdByName(userId, 'Family')
    if (!familySpaceId) throw new Error('Family space not found')
    await expect.poll(() => getMovementCreatedByByName(familySpaceId, 'Family Groceries')).toBe(userId)
    await screenshot(page, 'spaces-03-family-data')

    await switchSpace(page, 'Personal')
    await expect(page.getByText('Personal Lunch')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Family Groceries')).not.toBeVisible({ timeout: 3_000 })
    await page.goto('/settings')
    await expect(page.getByText('Shared Only')).not.toBeVisible({ timeout: 3_000 })
    await screenshot(page, 'spaces-04-personal-isolated')

    await page.getByLabel('Emoji del Space').fill('🏠')
    await page.getByLabel('Nombre del Space').fill('  FAMILY  ')
    await page.getByRole('button', { name: 'Crear Space' }).click()
    await expect(page.getByText(/Ya tienes un Space activo con ese nombre/i)).toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'spaces-05-duplicate-name-rejected')

    await page.context().addCookies([{ name: 'wallit_active_space', value: 'missing-space', domain: 'localhost', path: '/' }])
    await page.goto('/')
    await expect.poll(() => selectedSpaceText(page), { timeout: 10_000 }).toContain('Personal')
    await screenshot(page, 'spaces-06-invalid-cookie-fallback')

    const personalAccountId = await createRegularAccount(userId, { lastFourDigits: '3333', spaceId: personalSpaceId })
    const familyAccountId = await createRegularAccount(userId, { lastFourDigits: '4444', spaceId: familySpaceId })
    await seedConfirmedWorkflowMovement(userId, personalAccountId, { name: 'Personal Report Only', clpAmount: 900000, type: 'expense', spaceId: personalSpaceId })
    await seedConfirmedWorkflowMovement(userId, familyAccountId, { name: 'Family Report Only', clpAmount: 1500000, type: 'expense', spaceId: familySpaceId })
    await seedReviewMovement(userId, personalAccountId, 'Personal Pending Review', 100000, personalSpaceId)
    await seedReviewMovement(userId, familyAccountId, 'Family Pending Review', 100000, familySpaceId)

    await switchSpace(page, 'Family')
    await page.goto('/reports')
    await expect(page.getByText(/15\.000/).first()).toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'spaces-07-family-reports')
    await page.goto('/review')
    await expect(page.getByText('Family Pending Review')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Personal Pending Review')).not.toBeVisible({ timeout: 3_000 })
    await screenshot(page, 'spaces-08-family-review')

    const familyMovementId = await getMovementIdByName(userId, 'Family Report Only', familySpaceId)
    if (!familyMovementId) throw new Error('Family movement not found')
    await page.goto('/')
    await switchSpace(page, 'Personal')
    await page.goto(`/edit/${familyMovementId}`)
    await expect(page.getByText('Family Report Only')).not.toBeVisible({ timeout: 3_000 })
    await screenshot(page, 'spaces-09-detail-no-leak')

    await page.goto('/add')
    await page.getByText('↔️ Transfer').click()
    await expect(page.getByLabel('Desde cuenta')).not.toContainText('4444', { timeout: 3_000 })
    await screenshot(page, 'spaces-10-transfer-selectors-space-scoped')
  })

  test('defensive Space joins hide labels from malformed cross-Space movement references', async ({ page }) => {
    const email = await registerAndLogin(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found')
    const personalSpaceId = await getPersonalSpaceId(userId)

    await createSpace(page, 'Malformed Joins', '🧯')
    const foreignSpaceId = await getSpaceIdByName(userId, 'Malformed Joins')
    if (!foreignSpaceId) throw new Error('Malformed Joins space not found')

    const foreignAccountId = await createRegularAccount(userId, { bankName: 'Foreign Secret Bank', lastFourDigits: '9090', spaceId: foreignSpaceId })
    const foreignCategoryId = await seedCategory(userId, { name: 'Foreign Secret Category', emoji: '🕵️', spaceId: foreignSpaceId })

    await switchSpace(page, 'Personal')
    await createRegularAccount(userId, { bankName: 'Personal Safe Bank', lastFourDigits: '1010', spaceId: personalSpaceId })
    await seedConfirmedWorkflowMovement(userId, foreignAccountId, {
      name: 'Malformed Personal Expense',
      clpAmount: 123400,
      type: 'expense',
      categoryId: foreignCategoryId,
      spaceId: personalSpaceId,
    })

    await page.goto('/')
    await expect(page.getByText('Malformed Personal Expense')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Foreign Secret Bank')).not.toBeVisible({ timeout: 3_000 })
    await expect(page.getByText('Foreign Secret Category')).not.toBeVisible({ timeout: 3_000 })

    await page.goto('/reports')
    await expect(page.getByText('Foreign Secret Category')).not.toBeVisible({ timeout: 3_000 })
    await screenshot(page, 'spaces-joins-hide-malformed-cross-space-labels')
  })

  test('sharing, membership permissions, leave/remove/archive, collisions, and Personal protections', async ({ browser, page }) => {
    const ownerEmail = await registerAndLogin(page)
    const memberEmail = await registerUserInNewContext(browser)
    const memberUserId = await getUserId(memberEmail)
    if (!memberUserId) throw new Error('Member user not found')

    await createSpace(page, 'Team', '🤝')
    await page.goto('/settings')
    await addMemberAndExpect(page, `missing-${Date.now()}@wallit.app`, /No existe un usuario con ese email/i)
    await screenshot(page, 'spaces-10-non-existing-email-rejected')
    await page.reload()
    await addMemberAndExpect(page, memberEmail, memberEmail)
    await screenshot(page, 'spaces-11-owner-added-member')

    await login(page, memberEmail)
    await page.reload()
    await expectSpaceOption(page, 'Team', true)
    await switchSpace(page, 'Team')
    await createAccount(page, { bankName: 'BCI', lastFourDigits: '5555', initialBalance: '100000' })
    await createMovement(page, { name: 'Member Shared Expense', amount: '7000' })
    const teamSpaceId = await getSpaceIdByName(memberUserId, 'Team')
    if (!teamSpaceId) throw new Error('Team space not found for member')
    await expect.poll(() => getMovementCreatedByByName(teamSpaceId, 'Member Shared Expense')).toBe(memberUserId)
    await page.getByText('Member Shared Expense').click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 10_000 })
    await page.locator('input').first().fill('Member Edited Expense')
    await page.getByRole('button', { name: /Guardar cambios/i }).click()
    await page.waitForURL('**/', { timeout: 10_000 })
    await expect(page.getByText('Member Edited Expense')).toBeVisible({ timeout: 10_000 })
    await expect.poll(() => getMovementCreatedByByName(teamSpaceId, 'Member Edited Expense')).toBe(memberUserId)
    await page.goto('/settings')
    await expect(page.getByLabel('Email del miembro')).not.toBeVisible({ timeout: 3_000 })
    await expect(page.getByRole('button', { name: 'Archivar Space' })).not.toBeVisible({ timeout: 3_000 })
    await expect(page.getByRole('button', { name: 'Salir del Space' })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Salir del Space' }).click()
    await expectSpaceOption(page, 'Team', false)
    await screenshot(page, 'spaces-12-member-left')

    await login(page, ownerEmail)
    await createSpace(page, 'Ops', '⚙️')
    await page.goto('/settings')
    await expect(page.getByRole('button', { name: 'Salir del Space' })).not.toBeVisible({ timeout: 3_000 })
    await addMemberAndExpect(page, memberEmail, memberEmail)
    await page.getByRole('button', { name: 'Remover' }).click()
    await expect(page.getByText(memberEmail)).not.toBeVisible({ timeout: 10_000 })
    await login(page, memberEmail)
    await expectSpaceOption(page, 'Ops', false)
    await screenshot(page, 'spaces-13-owner-removed-member')

    await createSpace(page, 'Collision', '🧱')
    await login(page, ownerEmail)
    await createSpace(page, 'Collision', '🧱')
    await page.goto('/settings')
    await addMemberAndExpect(page, memberEmail, /mismo nombre|Renombra/i)
    await screenshot(page, 'spaces-14-add-member-collision')

    await createSpace(page, 'Archive', '🗄️')
    await page.goto('/settings')
    await addMemberAndExpect(page, memberEmail, memberEmail)
    await page.getByRole('button', { name: 'Archivar Space' }).click()
    await expectSpaceOption(page, 'Archive', false)
    await login(page, memberEmail)
    await expectSpaceOption(page, 'Archive', false)
    await screenshot(page, 'spaces-15-archive-disappears')

    await switchSpace(page, 'Personal')
    await page.goto('/settings')
    await expect(page.getByLabel('Email del miembro')).not.toBeVisible({ timeout: 3_000 })
    await expect(page.getByRole('button', { name: 'Archivar Space' })).not.toBeVisible({ timeout: 3_000 })
    await expect(page.getByRole('button', { name: 'Salir del Space' })).not.toBeVisible({ timeout: 3_000 })
    await screenshot(page, 'spaces-16-personal-protected')
  })
})
