import { test, expect } from '@playwright/test'

test.describe('Auth Pages', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login')
    
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByText('Create one')).toBeVisible()
    
    await page.screenshot({ path: './e2e-results/screenshots/login-page.png', fullPage: true })
  })

  test('register page renders correctly', async ({ page }) => {
    await page.goto('/register')
    
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
    await expect(page.getByText('Sign in')).toBeVisible()
    
    await page.screenshot({ path: './e2e-results/screenshots/register-page.png', fullPage: true })
  })

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login')
    
    await page.getByLabel('Email').fill('fake@test.com')
    await page.getByLabel('Password').fill('wrongpassword')
    await page.getByRole('button', { name: 'Sign in' }).click()
    
    await expect(page.getByText(/invalid|error|incorrect/i)).toBeVisible({ timeout: 5000 })
    
    await page.screenshot({ path: './e2e-results/screenshots/login-error.png', fullPage: true })
  })

  test('navigate between login and register', async ({ page }) => {
    await page.goto('/login')
    await page.getByText('Create one').click()
    await expect(page).toHaveURL(/\/register/)
    
    await page.getByText('Sign in').click()
    await expect(page).toHaveURL(/\/login/)
  })
})
