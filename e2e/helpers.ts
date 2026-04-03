import { type Locator, Page, expect } from '@playwright/test'

export const TEST_PASSWORD = 'testpass123'
const DEFAULT_TIMEOUT = 15_000
const REGISTER_TIMEOUT = 30_000

// Each test file gets a unique email at module load
export const TEST_EMAIL = `e2e-${Date.now()}@wallit.app`

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function waitForHome(page: Page) {
  await page.waitForURL(url => new URL(url.toString()).pathname === '/', { timeout: REGISTER_TIMEOUT })
  await expect.poll(async () => {
    const mainText = await page.locator('main').textContent().catch(() => '')
    return [
      'Movimientos Recientes',
      'Sin movimientos aún',
      '¡Bienvenido a Wallit!',
      'Agregar Cuenta',
    ].some(fragment => mainText?.includes(fragment))
  }, { timeout: DEFAULT_TIMEOUT }).toBe(true)
}

async function openSettings(page: Page) {
  await page.goto('/settings')
  await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: DEFAULT_TIMEOUT })
}

async function selectFirstMatchingOption(select: Locator, text?: string) {
  await expect(select).toBeVisible({ timeout: DEFAULT_TIMEOUT })

  const value = await select.evaluate((element, searchText) => {
    const options = Array.from((element as HTMLSelectElement).options)
    const normalizedSearch = typeof searchText === 'string' ? searchText.toLowerCase() : null

    const match = options.find(option => {
      if (option.disabled || !option.value) return false
      if (!normalizedSearch) return true
      return option.textContent?.toLowerCase().includes(normalizedSearch) ?? false
    })

    return match?.value ?? null
  }, text)

  if (!value) {
    throw new Error(`No option found${text ? ` containing "${text}"` : ''}`)
  }

  await select.selectOption(value)
}

export async function registerAndLogin(page: Page) {
  // Always register a fresh user to avoid rate limiting on login
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@wallit.app`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
  await Promise.all([
    waitForHome(page),
    page.getByRole('button', { name: 'Crear cuenta' }).click(),
  ])
}

type CreateAccountOptions = {
  bankName?: string
  accountType?: string
  lastFourDigits?: string
  initialBalance?: string
}

export async function createAccount(page: Page, opts: CreateAccountOptions = {}) {
  const bankName = opts.bankName ?? 'BCI'
  const accountType = opts.accountType ?? 'Corriente'
  const lastFourDigits = opts.lastFourDigits ?? '9999'
  const initialBalance = opts.initialBalance ?? '100000'

  await openSettings(page)

  const accountDetails = page.getByText(new RegExp(`···${escapeRegExp(lastFourDigits)}`)).first()
  if (await accountDetails.isVisible().catch(() => false)) {
    return
  }

  const bankSelect = page.locator('select[name="bankName"]').first()

  if (!await bankSelect.isVisible()) {
    await page.getByRole('button', { name: /^Agregar Cuenta$/i }).click()
    await expect(bankSelect).toBeVisible({ timeout: DEFAULT_TIMEOUT })
  }

  await bankSelect.selectOption(bankName)
  await page.locator('select[name="accountType"]').first().selectOption(accountType)
  await page.getByPlaceholder(/Últimos 4 dígitos/).fill(lastFourDigits)
  await page.getByPlaceholder(/Saldo inicial|Valor invertido actual/).fill(initialBalance)
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()

  await expect.poll(async () => {
    return await bankSelect.isVisible().catch(() => false)
  }, { timeout: DEFAULT_TIMEOUT }).toBe(false)

  await page.reload()
  await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: DEFAULT_TIMEOUT })
  await expect(page.getByText(new RegExp(`···${escapeRegExp(lastFourDigits)}`)).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT })
}

export async function ensureAccount(page: Page) {
  await createAccount(page)
  await page.goto('/')
  await waitForHome(page)
}

export async function ensureCategory(page: Page, emoji: string, name: string) {
  await openSettings(page)
  await expect(page.getByText('Categorías')).toBeVisible({ timeout: DEFAULT_TIMEOUT })

  const exists = await page.getByText(name, { exact: true }).isVisible().catch(() => false)
  if (exists) return

  const nameInput = page.getByPlaceholder('Nombre de categoría')
  await page.getByPlaceholder('🍕').fill(emoji)
  await nameInput.fill(name)
  await page.locator('form').filter({ has: nameInput }).locator('button[type="submit"]').click()
  await expect(nameInput).toHaveValue('', { timeout: DEFAULT_TIMEOUT })

  await page.reload()
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: DEFAULT_TIMEOUT })
}

export async function createMovement(page: Page, opts: {
  name: string
  amount: string
  type?: 'expense' | 'income'
  date?: string
  categoryName?: string
  accountLabel?: string
}) {
  await page.goto('/add')
  await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: DEFAULT_TIMEOUT })

  if (opts.type === 'income') {
    await page.getByText('↑ Ingreso').click()
  }

  await selectFirstMatchingOption(page.locator('select[name="accountId"]'), opts.accountLabel)
  await page.getByPlaceholder('¿En qué se gastó?').fill(opts.name)
  await page.getByPlaceholder('0.00').fill(opts.amount)
  if (opts.date) {
    await page.locator('input[type="date"]').first().fill(opts.date)
  }
  if (opts.categoryName) {
    await selectFirstMatchingOption(page.locator('select[name="categoryId"]'), opts.categoryName)
  }
  await Promise.all([
    waitForHome(page),
    page.getByRole('button', { name: /Guardar Movimiento/i }).click(),
  ])
  await expect(page.locator('main')).toContainText(opts.name, { timeout: DEFAULT_TIMEOUT })
}

export function screenshot(page: Page, name: string) {
  return page.screenshot({ path: `./e2e-results/screenshots/${name}.png`, fullPage: true })
}
