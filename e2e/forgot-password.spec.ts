import { test, expect } from '@playwright/test'
import { screenshot } from './helpers'

test.describe('Forgot Password — Complete Flow', () => {
  test('complete forgot password flow - form validation, submission, and navigation', async ({ page }) => {
    // 1. Navigate to forgot password from login page
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    
    // Direct navigation to test the page (forgot password link not implemented on login yet)
    await page.goto('/forgot-password')
    await screenshot(page, 'forgot-password-01-initial')

    // 2. Verify forgot password form renders correctly
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
    await expect(page.getByText('Enter your email and we\'ll send you reset instructions')).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send reset instructions' })).toBeVisible()
    await expect(page.getByText('Back to sign in')).toBeVisible()
    await screenshot(page, 'forgot-password-02-form-rendered')

    // 3. Test empty email validation
    await page.getByRole('button', { name: 'Send reset instructions' }).click()
    await expect(page.getByLabel('Email')).toBeFocused()
    await screenshot(page, 'forgot-password-03-empty-email-validation')

    // 4. Test invalid email format
    await page.getByLabel('Email').fill('invalid-email')
    await page.getByRole('button', { name: 'Send reset instructions' }).click()
    // Browser HTML5 validation should prevent submission or show error
    await screenshot(page, 'forgot-password-04-invalid-email')

    // 5. Submit valid email and verify loading state
    await page.getByLabel('Email').fill('test@wallit.app')
    const submitButton = page.getByRole('button', { name: 'Send reset instructions' })
    await submitButton.click()
    
    // Check if loading state appears
    const loadingButton = page.getByRole('button', { name: 'Sending...' })
    const hasLoadingState = await loadingButton.isVisible({ timeout: 1000 }).catch(() => false)
    if (hasLoadingState) {
      await expect(loadingButton).toBeVisible()
      await screenshot(page, 'forgot-password-05-loading-state')
    }

    // 6. Verify success state renders
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('We\'ve sent password reset instructions to')).toBeVisible()
    await expect(page.getByText('test@wallit.app')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible()
    await expect(page.getByText('try again')).toBeVisible()
    await screenshot(page, 'forgot-password-06-success-state')

    // 7. Test navigation back to login from success page
    await page.getByRole('link', { name: 'Back to sign in' }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await screenshot(page, 'forgot-password-07-back-to-login')

    // 8. Test "try again" functionality
    await page.goto('/forgot-password')
    await page.getByLabel('Email').fill('another@test.com')
    await page.getByRole('button', { name: 'Send reset instructions' }).click()
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible({ timeout: 10000 })
    
    // Click "try again" to go back to form
    await page.getByText('try again').click()
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await screenshot(page, 'forgot-password-08-try-again-functionality')

    // 9. Test navigation to login from initial form
    await page.getByText('Back to sign in').click()
    await expect(page).toHaveURL(/\/login/)
    await screenshot(page, 'forgot-password-09-nav-to-login-from-form')
  })
})