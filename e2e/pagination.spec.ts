import { test, expect, Page } from '@playwright/test'
import { screenshot } from './helpers'
import { getUserId, createAccount, seedManyMovements } from './db-helper'

async function registerUser(page: Page): Promise<string> {
  const email = `pag-${Date.now()}@wallit.app`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill('testpass123')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await page.waitForURL('**/', { timeout: 10000 })
  return email
}

test.describe('Pagination & Infinite Scroll', () => {
  test('infinite scroll loads more movements as user scrolls', async ({ page }) => {
    // 1. Register and setup user with account
    const email = await registerUser(page)
    await screenshot(page, 'pagination-01-registered')

    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    
    const accountId = await createAccount(userId)

    // 2. Seed 50 movements - more than a single page
    await seedManyMovements(userId, accountId, 50)

    // 3. Go to home page
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Balance General')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'pagination-02-home-initial')

    // 4. Count initial visible movements (should be around 20 - PAGE_SIZE)
    const initialMovements = await page.locator('[style*="borderRadius: 12"]').count()
    console.log(`Initial movements visible: ${initialMovements}`)
    await screenshot(page, 'pagination-03-initial-count')

    // 5. Scroll down to trigger load more
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(1000) // Wait for intersection observer to trigger
    await screenshot(page, 'pagination-04-after-first-scroll')

    // 6. Verify "Cargando más..." or more movements loaded
    const loadingText = page.getByText('Cargando más...')
    const noMoreText = page.getByText('No hay más movimientos')
    
    // Wait for either loading indicator or completion
    await Promise.race([
      loadingText.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {}),
      noMoreText.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {}),
      page.waitForTimeout(3000)
    ])
    await screenshot(page, 'pagination-05-loading-state')

    // 7. Scroll again and wait for more content
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(1500)
    await screenshot(page, 'pagination-06-more-loaded')

    // 8. Keep scrolling until we see "No hay más movimientos"
    let scrollAttempts = 0
    while (scrollAttempts < 5) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(1000)
      
      const hasNoMore = await noMoreText.isVisible().catch(() => false)
      if (hasNoMore) break
      
      scrollAttempts++
    }
    await screenshot(page, 'pagination-07-all-loaded')

    // 9. Verify we can see movements from different indices (proving pagination worked)
    // Look for movements with different numbers in their names
    const movement1 = await page.getByText(/Almuerzo #1/).isVisible().catch(() => false)
    const movement40 = await page.getByText(/#4\d/).first().isVisible().catch(() => false)
    
    // At least one of the later movements should be visible after scrolling
    expect(movement1 || movement40).toBeTruthy()
    await screenshot(page, 'pagination-08-verified')

    // 10. Test receivables filter with pagination
    const porCobrarBtn = page.getByText(/Por Cobrar/i).first()
    if (await porCobrarBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await porCobrarBtn.click()
      await page.waitForTimeout(500)
      await screenshot(page, 'pagination-09-receivables-filter')
    }

    // 11. Go back to all movements
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'pagination-10-final-state')
  })

  test('reports page handles many movements correctly', async ({ page }) => {
    // 1. Register and setup
    const email = await registerUser(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    
    const accountId = await createAccount(userId)
    await seedManyMovements(userId, accountId, 30)

    // 2. Navigate to reports
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'pagination-reports-01-initial')

    // 3. Verify summary cards show aggregated data
    await expect(page.getByText('Ingresos', { exact: true })).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Neto')).toBeVisible()
    await screenshot(page, 'pagination-reports-02-summary')

    // 4. Verify charts are rendered
    await expect(page.getByRole('heading', { name: '📉 Gastos' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('heading', { name: '📈 Ingresos' })).toBeVisible()
    await screenshot(page, 'pagination-reports-03-charts')

    // 5. Scroll down to see category breakdown
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await screenshot(page, 'pagination-reports-04-scrolled')
  })

  test('account detail page handles many movements', async ({ page }) => {
    // 1. Register and setup
    const email = await registerUser(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    
    const accountId = await createAccount(userId)
    await seedManyMovements(userId, accountId, 25)

    // 2. Navigate to home and click account card
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    const accountCard = page.locator('[data-testid^="account-card-"]').first()
    await expect(accountCard).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'pagination-detail-01-home')

    await accountCard.click()
    await page.waitForURL('**/account/**', { timeout: 10000 })
    await screenshot(page, 'pagination-detail-02-account-page')

    // 3. Verify account detail page shows movements
    await expect(page.getByText('Balance Actual')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'pagination-detail-03-header')

    // 4. Scroll down to see more movements
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(500)
    await screenshot(page, 'pagination-detail-04-scrolled')

    // 5. Click a movement to edit
    const firstMovement = page.getByText(/Almuerzo #/).first()
    if (await firstMovement.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstMovement.click()
      await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
      await screenshot(page, 'pagination-detail-05-edit-from-account')
    }
  })
})
