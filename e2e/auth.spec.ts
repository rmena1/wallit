import { test, expect } from '@playwright/test'
import { screenshot } from './helpers'

test.describe('Auth - Login Flow', () => {
  test('complete login flow - form, validation, errors, and navigation', async ({ page }) => {
    // 1. Render login form
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Contraseña')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible()
    await expect(page.getByText('Crear una')).toBeVisible()
    await screenshot(page, 'auth-login-01-initial')

    // 2. Empty email — HTML5 validation keeps focus on email
    await page.getByLabel('Contraseña').fill('somepassword')
    await page.getByRole('button', { name: 'Iniciar sesión' }).click()
    await expect(page.getByLabel('Email')).toBeFocused()
    await screenshot(page, 'auth-login-02-empty-email')

    // 3. Empty password — focus stays on password
    await page.getByLabel('Contraseña').fill('')
    await page.getByLabel('Email').fill('test@test.com')
    await page.getByRole('button', { name: 'Iniciar sesión' }).click()
    await expect(page.getByLabel('Contraseña')).toBeFocused()
    await screenshot(page, 'auth-login-03-empty-password')

    // 4. Invalid credentials
    await page.getByLabel('Email').fill('fake@test.com')
    await page.getByLabel('Contraseña').fill('wrongpassword')
    await page.getByRole('button', { name: 'Iniciar sesión' }).click()
    await expect(page.getByText(/invalid|error|incorrect|too many/i)).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'auth-login-04-invalid-credentials')

    // 5. Navigate to register
    await page.getByText('Crear una').click()
    await expect(page).toHaveURL(/\/register/)
    await screenshot(page, 'auth-login-05-navigated-to-register')
  })
})

test.describe('Auth - Register Flow', () => {
  test('complete register flow - form, validation, success, and duplicate', async ({ page }) => {
    // 1. Render register form
    await page.goto('/register')
    await expect(page.getByRole('heading', { name: 'Crea tu cuenta' })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Contraseña')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Crear cuenta' })).toBeVisible()
    await expect(page.getByText('Iniciar sesión')).toBeVisible()
    await screenshot(page, 'auth-register-01-initial')

    // 2. Short password error
    await page.getByLabel('Email').fill(`short-${Date.now()}@wallit.app`)
    await page.getByLabel('Contraseña').fill('123')
    await page.getByRole('button', { name: 'Crear cuenta' }).click()
    await expect(page.getByText('Debe tener al menos 8 caracteres')).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'auth-register-02-short-password')

    // 3. Successful registration
    const email = `reg-${Date.now()}@wallit.app`
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Contraseña').fill('testpass123')
    await page.getByRole('button', { name: 'Crear cuenta' }).click()
    await expect(page).toHaveURL(/localhost:3001\/(?!login)(?!register)/, { timeout: 5000 })
    await screenshot(page, 'auth-register-03-success')

    // 4. Duplicate email error
    await page.context().clearCookies()
    await page.goto('/register')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Contraseña').fill('testpass123')
    await page.getByRole('button', { name: 'Crear cuenta' }).click()
    await expect(page.getByText(/Could not create account|already exists|email already/i)).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'auth-register-04-duplicate-email')

    // 5. Navigate to login
    await page.getByText('Iniciar sesión').click()
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
    await page.getByLabel('Contraseña').fill('testpass123')
    await page.getByRole('button', { name: 'Crear cuenta' }).click()
    await expect(page).toHaveURL(/localhost:3001\/(?!login)(?!register)/, { timeout: 5000 })
    await screenshot(page, 'auth-redirects-03-authenticated')

    // 3. Authenticated user accessing login is redirected to home
    await page.goto('/login')
    await expect(page).toHaveURL(/localhost:3001\/(?!login)(?!register)/, { timeout: 5000 })
    await screenshot(page, 'auth-redirects-04-login-redirects-home')

    // 4. Logout via user avatar menu
    const avatarBtn = page.locator('header button').last()
    await expect(avatarBtn).toBeVisible()
    await avatarBtn.click()
    await page.getByText('Cerrar sesión').click()
    await page.waitForURL(/\/login/, { timeout: 10000 })
    await screenshot(page, 'auth-redirects-05-logged-out')
  })
})
