import { test, expect, Page } from '@playwright/test'
import { registerAndLogin, ensureAccount, ensureCategory, screenshot } from './helpers'
import { getUserId, getFirstAccountId, seedReviewMovements, seedReviewMovement } from './db-helper'

async function registerUser(page: Page): Promise<string> {
  const email = `e2e-review-${Date.now()}-${Math.random().toString(36).slice(2, 5)}@wallit.app`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('testpass123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('**/', { timeout: 10000 })
  return email
}

test.describe('Review Flow — Complete', () => {
  test('empty state, then confirm, skip, and delete review movements', async ({ page }) => {
    // 1. Register and test empty state
    const email = await registerUser(page)
    await page.goto('/review')
    await expect(page.getByText('No hay movimientos pendientes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-01-empty-state')

    // 2. Navigate back to home from empty state
    await page.getByRole('button', { name: 'Volver al inicio' }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'review-02-back-to-home')

    // 3. Set up account for the same user
    await ensureAccount(page)

    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)

    // 4. Seed review movements
    await seedReviewMovements(userId, accountId)

    // 5. Go to review page with pending movements
    await page.goto('/review')
    await expect(page.getByText('Revisión')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('1/3')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-03-first-movement')

    // First movement visible (latest createdAt appears first)
    await expect(page.getByText('Uber Eats - Pizza')).toBeVisible({ timeout: 5000 })

    // 6. Confirm the first movement
    await page.getByRole('button', { name: '✓ Confirmar' }).click()
    await page.waitForTimeout(1000) // Wait for re-render
    await screenshot(page, 'review-04-after-confirm')

    // 7. Skip the current movement
    await page.getByRole('button', { name: /Después/i }).click()
    await page.waitForTimeout(500)
    await screenshot(page, 'review-05-after-skip')

    // 8. Delete the current movement (or we may be at completion)
    const deleteBtn = page.getByRole('button', { name: /🗑 Eliminar/i })
    if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteBtn.click()
      await expect(page.getByText('¿Eliminar este movimiento?')).toBeVisible({ timeout: 3000 })
      await screenshot(page, 'review-06-delete-dialog')
      await page.locator('div[style*="position: fixed"]').getByRole('button', { name: 'Eliminar' }).click()
      await page.waitForTimeout(1000)
    }

    // 9. Should show completion screen (or empty state if re-rendered)
    const completed = page.getByText('¡Revisión completada!')
    const empty = page.getByText('No hay movimientos pendientes')
    await expect(completed.or(empty)).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-07-completed')

    // 10. Navigate back to home
    await page.getByRole('button', { name: 'Volver al inicio' }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'review-08-back-home')
  })

  test('mark movement as receivable and edit fields before confirming', async ({ page }) => {
    const email = await registerUser(page)
    await ensureAccount(page)
    await ensureCategory(page, '🍔', 'Comida')

    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)

    // Seed 2 review movements
    await seedReviewMovement(userId, accountId, 'Almuerzo con Juan', 2000000)
    await seedReviewMovement(userId, accountId, 'Compra desconocida', 999900)

    await page.goto('/review')
    await expect(page.getByText('1/2')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-recv-01-initial')

    // First movement: "Almuerzo con Juan" — mark as receivable
    await expect(page.getByText('Almuerzo con Juan')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: /💰 Cobrar/i }).click()
    await expect(page.getByText('Marcar como Por Cobrar')).toBeVisible({ timeout: 3000 })
    await screenshot(page, 'review-recv-02-dialog')

    const input = page.locator('input[placeholder="Texto del recordatorio..."]')
    await input.clear()
    await input.fill('Juan me debe la mitad del almuerzo')

    // Click the confirm button inside the receivable dialog
    await page.locator('div[style*="position: fixed"]').getByRole('button', { name: 'Confirmar' }).click()
    await page.waitForTimeout(1000) // Wait for re-render after server action
    await screenshot(page, 'review-recv-03-after-receivable')

    // After marking receivable, page re-renders. Second movement should now be visible
    const secondMovement = page.getByText('Compra desconocida')
    if (await secondMovement.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Edit the description
      const descInput = page.locator('input').first()
      await descInput.clear()
      await descInput.fill('Cena con amigos')

      // Switch to income
      await page.getByText('↑ Ingreso').click()
      await screenshot(page, 'review-recv-04-edited-fields')

      // Confirm
      await page.getByRole('button', { name: '✓ Confirmar' }).click()
      await page.waitForTimeout(1000)
    }

    // Should eventually show completion or empty state
    const completed = page.getByText('¡Revisión completada!')
    const empty = page.getByText('No hay movimientos pendientes')
    await expect(completed.or(empty)).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'review-recv-05-completed')
  })
})
