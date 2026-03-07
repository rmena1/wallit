import { test, expect, Page } from '@playwright/test'
import { registerAndLogin, ensureAccount, createMovement, screenshot } from './helpers'
import { getUserId, getFirstAccountId, seedManyMovements } from './db-helper'

async function registerUser(page: Page): Promise<string> {
  const email = `e2e-acc-detail-${Date.now()}-${Math.random().toString(36).slice(2, 5)}@wallit.app`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill('testpass123')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await page.waitForURL('**/', { timeout: 10000 })
  return email
}

test.describe('Account Detail Page — Complete Flow', () => {
  test('navigate to account detail, view balance chart, list movements, load more, and navigate to edit', async ({ page }) => {
    // 1. Register and create account
    const email = await registerUser(page)
    await ensureAccount(page)
    await screenshot(page, 'acc-detail-01-account-created')

    // 2. Create some movements via UI
    await createMovement(page, { name: 'Gasto inicial', amount: '15000' })
    await createMovement(page, { name: 'Ingreso trabajo', amount: '500000', type: 'income' })
    await createMovement(page, { name: 'Compra supermercado', amount: '45000' })

    // 3. Seed many movements in DB for pagination
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)
    if (!accountId) throw new Error('Account not found in DB')
    await seedManyMovements(userId, accountId, 60)

    // 4. Navigate to account detail from home
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'acc-detail-02-home-with-account')

    // Click on the first account card
    const accountCards = page.locator('[data-testid^="account-card-"]')
    const cardCount = await accountCards.count()
    expect(cardCount).toBeGreaterThan(0)
    await accountCards.first().click()
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'acc-detail-03-account-detail-page')

    // 5. Verify account detail page elements
    await expect(page.getByText('Balance Actual')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('BCI')).toBeVisible()
    await expect(page.getByText('Corriente')).toBeVisible()
    await screenshot(page, 'acc-detail-04-balance-visible')

    // 6. Verify balance chart is visible (if enough data)
    const chartTitle = page.getByText('Balance en el Tiempo')
    if (await chartTitle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await screenshot(page, 'acc-detail-05-balance-chart')
    }

    // 7. Verify movements list
    await expect(page.getByText('Movimientos')).toBeVisible()
    // Wait for movements to load
    await page.waitForTimeout(1000)
    // Look for one of our created movements (use partial match)
    await expect(page.getByText(/Gasto inicial|Compra supermercado/).first()).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'acc-detail-06-movements-list')

    // 8. Test "load more" functionality if available
    const loadMoreBtn = page.getByRole('button', { name: /Ver más/i })
    if (await loadMoreBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await screenshot(page, 'acc-detail-07-before-load-more')
      await loadMoreBtn.click()
      await page.waitForTimeout(1000)
      await screenshot(page, 'acc-detail-08-after-load-more')
    }

    // 9. Click on a movement to navigate to edit page
    await page.getByText(/Gasto inicial/).first().click()
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'acc-detail-09-edit-from-detail')

    // 10. Go back to account detail
    await page.getByRole('button', { name: /Volver/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'acc-detail-10-back-to-home')
  })

  test('account detail with empty movements', async ({ page }) => {
    // Register with new account but no movements
    await registerAndLogin(page)
    await ensureAccount(page)

    // Navigate to account detail
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const accountCards = page.locator('[data-testid^="account-card-"]')
    await accountCards.first().click()
    await page.waitForLoadState('networkidle')

    // Should show empty state
    await expect(page.getByText('Sin movimientos en esta cuenta')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'acc-detail-empty-01-no-movements')
  })
})
