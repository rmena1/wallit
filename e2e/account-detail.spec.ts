import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, createMovement, screenshot } from './helpers'

test.describe('Account Detail Page', () => {
  test('navigate to account detail, view movements + chart, and click movement to edit', async ({ page }) => {
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message))
    page.on('console', (msg) => { if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text()) })
    await registerAndLogin(page)
    await ensureAccount(page)

    // Create movements for the account
    await createMovement(page, { name: 'Almuerzo detail', amount: '12000' })
    await createMovement(page, { name: 'Freelance detail', amount: '500000', type: 'income' })
    await createMovement(page, { name: 'Super detail', amount: '35000' })
    await createMovement(page, { name: 'Gasto editable', amount: '5000' })

    // Go home and click account card
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // The account card contains "BCI" as the bank name label
    const accountCard = page.locator('[data-testid^="account-card-"]').first()
    await expect(accountCard).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'account-detail-00-home')

    await accountCard.click()
    await page.waitForURL('**/account/**', { timeout: 10000 })

    // Verify account detail page
    await expect(page.getByText('Balance Actual')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'account-detail-01-header')

    // Verify movements list
    await expect(page.getByText('Almuerzo detail')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Freelance detail')).toBeVisible()
    await expect(page.getByText('Super detail')).toBeVisible()
    await expect(page.getByText('Gasto editable')).toBeVisible()
    await screenshot(page, 'account-detail-02-movements')

    // Verify chart is rendered
    await expect(page.getByText('Balance en el Tiempo')).toBeVisible()
    await screenshot(page, 'account-detail-03-full-page')

    // Click on a movement to navigate to edit page
    await page.getByText('Gasto editable').click()
    await page.waitForURL('**/edit/**', { timeout: 5000 })
    await expect(page.getByText('Editar Movimiento')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'account-detail-04-edit-navigation')

    // Navigate back via browser back
    await page.goBack()
    await page.waitForURL('**/account/**', { timeout: 5000 })
    await expect(page.getByText('Balance Actual')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'account-detail-05-back-to-detail')

    // Click back button to go home
    await page.locator('header button').first().click()
    await page.waitForURL('/', { timeout: 5000 })
    await expect(page.getByText('Balance General')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'account-detail-06-back-to-home')
  })
})
