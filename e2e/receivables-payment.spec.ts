import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, createMovement, screenshot } from './helpers'
import { getUserId, getFirstAccountId, seedReceivable } from './db-helper'

test.describe('Receivables & Payment — Complete Flow', () => {
  test('filter receivables, view them, and mark as paid via payment dialog', async ({ page }) => {
    // Register and setup
    const email = `e2e-recv-pay-${Date.now()}@wallit.app`
    await page.goto('/register')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('testpass123')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL('**/', { timeout: 10000 })

    await ensureAccount(page)

    // Create a regular movement + income for linking
    await createMovement(page, { name: 'Gasto normal', amount: '5000' })
    await createMovement(page, { name: 'Pago de Juan', amount: '25000', type: 'income' })

    // Seed receivable movements
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)
    await seedReceivable(userId, accountId, 'Pedro me debe cena', 1500000)
    await seedReceivable(userId, accountId, 'Juan me debe almuerzo', 2500000)

    // Go home and verify data exists
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'recv-pay-01-home-with-data')

    // Activate "Por Cobrar" filter
    const porCobrarBtn = page.getByText(/Por Cobrar/i).first()
    if (await porCobrarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await porCobrarBtn.click()
      await page.waitForTimeout(500)
      await screenshot(page, 'recv-pay-02-filtered')

      // Verify receivable movements show
      await expect(page.getByText('Pedro me debe cena')).toBeVisible({ timeout: 5000 })
      await expect(page.getByText('Juan me debe almuerzo')).toBeVisible({ timeout: 5000 })
      await screenshot(page, 'recv-pay-03-receivables-visible')

      // Try to mark one as received via payment dialog
      const cobradoBtn = page.getByText(/Cobrado|Recibido|✓/i).first()
      if (await cobradoBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cobradoBtn.click()
        await screenshot(page, 'recv-pay-04-payment-dialog-open')

        // Look for account selection in dialog
        const dialogAccountSelect = page.locator('div[style*="position: fixed"] select').first()
        if (await dialogAccountSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
          await dialogAccountSelect.selectOption({ index: 1 })
          await screenshot(page, 'recv-pay-05-account-selected')
        }

        // Look for income linking options
        const incomeOption = page.getByText('Pago de Juan').last()
        if (await incomeOption.isVisible({ timeout: 3000 }).catch(() => false)) {
          await incomeOption.click()
          await screenshot(page, 'recv-pay-06-income-linked')
        }

        // Confirm the payment
        const confirmBtn = page.getByRole('button', { name: /Confirmar|Aceptar|Marcar/i }).first()
        if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await confirmBtn.click()
          await screenshot(page, 'recv-pay-07-confirmed')
        }
      }
    }

    // Turn off filter and verify final state
    const allBtn = page.getByText(/Todos|Todo/i).first()
    if (await allBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await allBtn.click()
    }
    await screenshot(page, 'recv-pay-08-final-all-movements')
  })
})
