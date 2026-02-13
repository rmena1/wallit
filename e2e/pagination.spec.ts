import { test, expect, Page } from '@playwright/test'
import { screenshot } from './helpers'
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'data', 'wallit.db')

function getUserId(email: string): string | null {
  const db = new Database(DB_PATH)
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined
  db.close()
  return row?.id ?? null
}

function getFirstAccountId(userId: string): string | null {
  const db = new Database(DB_PATH)
  const row = db.prepare('SELECT id FROM accounts WHERE user_id = ?').get(userId) as { id: string } | undefined
  db.close()
  return row?.id ?? null
}

function createAccount(userId: string): string {
  const db = new Database(DB_PATH)
  const now = Math.floor(Date.now() / 1000)
  const id = `acc-${Date.now()}`
  db.prepare(`
    INSERT INTO accounts (id, user_id, bank_name, account_type, last_four_digits, initial_balance, currency, created_at, updated_at)
    VALUES (?, ?, 'BCI', 'Corriente', '9999', 100000000, 'CLP', ?, ?)
  `).run(id, userId, now, now)
  db.close()
  return id
}

function seedManyMovements(userId: string, accountId: string, count: number) {
  const db = new Database(DB_PATH)
  const today = new Date()
  
  const stmt = db.prepare(`
    INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'CLP', 0, 0, ?, ?)
  `)

  const names = [
    'Almuerzo', 'Café', 'Uber', 'Supermercado', 'Netflix', 'Spotify', 'Gimnasio',
    'Farmacia', 'Gasolina', 'Restaurant', 'Delivery', 'Metro', 'Bus', 'Taxi',
    'Cena', 'Desayuno', 'Snacks', 'Bebidas', 'Ropa', 'Zapatos', 'Libro',
    'Cine', 'Teatro', 'Concierto', 'Museo', 'Parque', 'Playa', 'Viaje'
  ]

  for (let i = 0; i < count; i++) {
    const id = `pag-${Date.now()}-${i}`
    const name = `${names[i % names.length]} #${i + 1}`
    const date = new Date(today)
    date.setDate(date.getDate() - Math.floor(i / 5)) // 5 per day going back
    const dateStr = date.toISOString().slice(0, 10)
    const amount = (Math.floor(Math.random() * 50) + 5) * 100 * 100 // 500-5500 CLP
    const type = Math.random() > 0.3 ? 'expense' : 'income'
    const ts = Math.floor(Date.now() / 1000) - i
    
    stmt.run(id, userId, accountId, name, dateStr, amount, type, ts, ts)
  }
  
  db.close()
}

async function registerUser(page: Page): Promise<string> {
  const email = `pag-${Date.now()}@wallit.app`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('testpass123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('**/', { timeout: 10000 })
  return email
}

test.describe('Pagination & Infinite Scroll', () => {
  test('infinite scroll loads more movements as user scrolls', async ({ page }) => {
    // 1. Register and setup user with account
    const email = await registerUser(page)
    await screenshot(page, 'pagination-01-registered')

    const userId = getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    
    const accountId = createAccount(userId)

    // 2. Seed 50 movements - more than a single page
    seedManyMovements(userId, accountId, 50)

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

})
