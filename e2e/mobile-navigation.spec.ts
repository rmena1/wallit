import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, createMovement, screenshot } from './helpers'

// Use mobile viewport for this test suite (Chrome with mobile viewport, not webkit)
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})

test.describe('Mobile Navigation — Bottom Nav & Responsive Design', () => {
  test('bottom navigation functionality and mobile-specific interactions', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)

    // 1. Verify bottom navigation is visible on mobile
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    // Look for common bottom nav indicators
    const bottomNav = page.locator('nav').last() // Assuming bottom nav is the last nav element
    const navButtons = page.locator('nav button, nav a[href]')
    const hasBottomNav = await navButtons.count() > 0
    
    if (hasBottomNav) {
      await screenshot(page, 'mobile-nav-01-bottom-nav-visible')
      
      // 2. Test navigation between main sections via bottom nav
      const navItems = await navButtons.all()
      for (let i = 0; i < Math.min(navItems.length, 5); i++) {
        const navItem = navItems[i]
        await navItem.click()
        await page.waitForLoadState('networkidle')
        await screenshot(page, `mobile-nav-02-section-${i + 1}`)
      }
    }

    // 3. Test home/dashboard on mobile
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Balance General').or(page.getByText('¡Bienvenido a Wallit!'))).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'mobile-nav-03-home-mobile-view')

    // 4. Test add movement flow on mobile
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })
    
    // Test mobile form interactions
    const accountSelect = page.locator('select[name="accountId"]')
    await accountSelect.selectOption({ index: 1 })
    await page.getByPlaceholder('¿En qué se gastó?').fill('Compra móvil')
    await page.getByPlaceholder('0.00').fill('5000')
    await screenshot(page, 'mobile-nav-04-add-movement-mobile')

    // Save the movement
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'mobile-nav-05-movement-saved-mobile')

    // 5. Test settings page on mobile
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'mobile-nav-06-settings-mobile')

    // Test mobile scrolling and form interactions
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await screenshot(page, 'mobile-nav-07-settings-scrolled')

    // 6. Test reports page on mobile (if responsive charts work)
    await page.goto('/reports')
    await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'mobile-nav-08-reports-mobile')

    // 7. Test account detail page on mobile
    const accounts = await page.locator('[href^="/account/"]').all()
    if (accounts.length > 0) {
      await accounts[0].click()
      await page.waitForLoadState('networkidle')
      await screenshot(page, 'mobile-nav-09-account-detail-mobile')
    }

    // 8. Test mobile user avatar menu
    await page.goto('/')
    const avatarButton = page.locator('header button').last()
    const hasAvatarButton = await avatarButton.isVisible().catch(() => false)
    if (hasAvatarButton) {
      await avatarButton.click()
      await expect(page.getByText('Cerrar sesión')).toBeVisible()
      await screenshot(page, 'mobile-nav-10-avatar-menu-mobile')
      
      // Close menu by clicking elsewhere
      await page.locator('body').click()
    }

    // 9. Test mobile touch interactions (if any special behaviors exist)
    await createMovement(page, { name: 'Touch test', amount: '2500' })
    await page.goto('/')
    
    // Test swipe/touch on movement items (if implemented)
    const movementItems = page.locator('[data-testid="movement-item"], .movement-item, li')
    const hasMovementItems = await movementItems.count() > 0
    if (hasMovementItems) {
      const firstMovement = movementItems.first()
      await firstMovement.click()
      await screenshot(page, 'mobile-nav-11-movement-interaction')
    }

    // 10. Test responsive breakpoint behavior
    // Change to tablet size
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/')
    await screenshot(page, 'mobile-nav-12-tablet-view')

    // Change back to mobile
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await screenshot(page, 'mobile-nav-13-back-to-mobile')
  })

  test('mobile keyboard and input interactions', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)

    // 1. Test mobile keyboard behavior on add movement
    await page.goto('/add')
    await expect(page.getByText('Nuevo Movimiento')).toBeVisible({ timeout: 5000 })

    // Test numeric keyboard for amount field
    const amountField = page.getByPlaceholder('0.00')
    await amountField.click()
    await screenshot(page, 'mobile-keyboard-01-amount-field-focused')

    // Test different input types
    await amountField.fill('123.45')
    await screenshot(page, 'mobile-keyboard-02-amount-filled')

    // Test text field keyboard
    const nameField = page.getByPlaceholder('¿En qué se gastó?')
    await nameField.click()
    await nameField.fill('Prueba móvil teclado')
    await screenshot(page, 'mobile-keyboard-03-text-field-focused')

    // Test select dropdowns on mobile
    const accountSelect = page.locator('select[name="accountId"]')
    await accountSelect.click()
    await screenshot(page, 'mobile-keyboard-04-select-opened')
    await accountSelect.selectOption({ index: 1 })

    // Test form submission
    await page.getByRole('button', { name: /Guardar Movimiento/i }).click()
    await page.waitForURL('**/', { timeout: 5000 })
    await screenshot(page, 'mobile-keyboard-05-form-submitted')
  })
})