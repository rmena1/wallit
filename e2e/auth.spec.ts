import { test, expect } from '@playwright/test'
import { screenshot } from './helpers'

test.describe('Auth - Login Flow', () => {
  test('complete login flow - form, validation, errors, and navigation', async ({ page }) => {
    // 1. Render login form
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByText('Create one')).toBeVisible()
    await screenshot(page, 'auth-login-01-initial')

    // 2. Empty email — HTML5 validation keeps focus on email
    await page.getByLabel('Password').fill('somepassword')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByLabel('Email')).toBeFocused()
    await screenshot(page, 'auth-login-02-empty-email')

    // 3. Empty password — focus stays on password
    await page.getByLabel('Password').fill('')
    await page.getByLabel('Email').fill('test@test.com')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByLabel('Password')).toBeFocused()
    await screenshot(page, 'auth-login-03-empty-password')

    // 4. Invalid credentials
    await page.getByLabel('Email').fill('fake@test.com')
    await page.getByLabel('Password').fill('wrongpassword')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText(/invalid|error|incorrect/i)).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'auth-login-04-invalid-credentials')

    // 5. Navigate to register
    await page.getByText('Create one').click()
    await expect(page).toHaveURL(/\/register/)
    await screenshot(page, 'auth-login-05-navigated-to-register')
  })
})

test.describe('Auth - Register Flow', () => {
  test('complete register flow - form, validation, success, and duplicate', async ({ page }) => {
    // 1. Render register form
    await page.goto('/register')
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
    await expect(page.getByText('Sign in')).toBeVisible()
    await screenshot(page, 'auth-register-01-initial')

    // 2. Short password error
    await page.getByLabel('Email').fill(`short-${Date.now()}@wallit.app`)
    await page.getByLabel('Password').fill('123')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('Must be at least 8 characters')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'auth-register-02-short-password')

    // 3. Successful registration
    const email = `reg-${Date.now()}@wallit.app`
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('testpass123')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(/localhost:3002\/(?!login)(?!register)/, { timeout: 5000 })
    await screenshot(page, 'auth-register-03-success')

    // 4. Duplicate email error
    await page.context().clearCookies()
    await page.goto('/register')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('testpass123')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('An account with this email already exists')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'auth-register-04-duplicate-email')

    // 5. Navigate to login
    await page.getByText('Sign in').click()
    await expect(page).toHaveURL(/\/login/)
    await screenshot(page, 'auth-register-05-navigated-to-login')
  })
})

test.describe('Auth - Redirects & Logout', () => {
  test('unauthenticated redirects, authenticated redirect, and logout', async ({ page }) => {
    // 1. Unauthenticated user redirected from protected routes
    await page.context().clearCookies()

    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await screenshot(page, 'auth-redirects-01-home-to-login')

    await page.goto('/settings')
    await expect(page).toHaveURL(/\/login/)

    await page.goto('/reports')
    await expect(page).toHaveURL(/\/login/)

    await page.goto('/add')
    await expect(page).toHaveURL(/\/login/)
    await screenshot(page, 'auth-redirects-02-all-protected-redirected')

    // 2. Register to get authenticated
    const email = `redir-${Date.now()}@wallit.app`
    await page.goto('/register')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('testpass123')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(/localhost:3002\/(?!login)(?!register)/, { timeout: 5000 })
    await screenshot(page, 'auth-redirects-03-authenticated')

    // 3. Authenticated user accessing login is redirected to home
    await page.goto('/login')
    await expect(page).toHaveURL(/localhost:3002\/(?!login)(?!register)/, { timeout: 5000 })
    await screenshot(page, 'auth-redirects-04-login-redirects-home')

    // 4. Logout
    await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible()
    await page.getByRole('button', { name: 'Salir' }).click()
    await page.waitForURL(/\/login/, { timeout: 10000 })
    await screenshot(page, 'auth-redirects-05-logged-out')
  })
})
