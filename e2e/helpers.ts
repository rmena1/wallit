import { Page, expect } from '@playwright/test'

export const TEST_EMAIL = `e2e-${Date.now()}@wallit.app`
export const TEST_PASSWORD = 'testpass123'

let registered = false

export async function registerAndLogin(page: Page) {
  if (!registered) {
    await page.goto('/register')
    await page.getByLabel('Email').fill(TEST_EMAIL)
    await page.getByLabel('Password').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Create account' }).click()
    const ok = await page.waitForURL('**/', { timeout: 5000 }).then(() => true).catch(() => false)
    if (ok) { registered = true; return }
  }

  await page.goto('/login')
  await page.getByLabel('Email').fill(TEST_EMAIL)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/', { timeout: 5000 })
  registered = true
}

export async function ensureAccount(page: Page) {
  await page.goto('/settings')
  await expect(page.getByText('Cuentas Bancarias')).toBeVisible({ timeout: 5000 })

  // Check if already have an account
  const hasAccount = await page.locator('div').filter({ hasText: /^BCI$/ }).first().isVisible().catch(() => false)
  if (hasAccount) {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    return
  }

  await page.locator('select[name="bankName"]').selectOption('BCI')
  await page.locator('select[name="accountType"]').selectOption('Corriente')
  await page.getByPlaceholder('Últimos 4 dígitos').fill('9999')
  await page.getByPlaceholder('Saldo inicial').fill('100000')
  await page.getByRole('button', { name: /Agregar Cuenta/i }).click()
  await expect(page.locator('div').filter({ hasText: /^BCI$/ })).toBeVisible({ timeout: 5000 })

  await page.goto('/')
  await page.waitForLoadState('networkidle')
}

export async function ensureCategory(page: Page, emoji: string, name: string) {
  await page.goto('/settings')
  await expect(page.getByText('Categorías')).toBeVisible({ timeout: 5000 })

  const exists = await page.getByText(name).isVisible().catch(() => false)
  if (exists) return

  await page.getByPlaceholder('🍕').fill(emoji)
  await page.getByPlaceholder('Nombre de categoría').fill(name)
  await page.locator('form').filter({ has: page.getByPlaceholder('Nombre de categoría') }).locator('button[type="submit"]').click()
  await expect(page.getByText(name)).toBeVisible({ timeout: 5000 })
}

export async function createMovement(page: Page, opts: {
  name: string
  amount: string
  type?: 'expense' | 'income'
}) {
  await page.goto('/add')
  await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })

  if (opts.type === 'income') {
    await page.getByText('↑ Ingreso').click()
  }

  await page.locator('select[name="accountId"]').selectOption({ index: 1 })
  await page.getByPlaceholder('¿En qué se gastó?').fill(opts.name)
  await page.getByPlaceholder('0.00').fill(opts.amount)
  await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
  await page.waitForURL('**/', { timeout: 5000 })
  await expect(page.getByText(opts.name)).toBeVisible({ timeout: 5000 })
}

export function screenshot(page: Page, name: string) {
  return page.screenshot({ path: `./e2e-results/screenshots/${name}.png`, fullPage: true })
}
