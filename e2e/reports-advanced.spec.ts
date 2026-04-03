import { type Locator, type Page, test, expect } from '@playwright/test'
import {
  createAccount,
  createMovement,
  ensureAccount,
  ensureCategory,
  registerAndLogin,
} from './helpers'

const REPORT_TIMEOUT = 15_000
const REPORTS_SPEC_TIMEOUT = 90_000

function formatDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatClpFromPesos(amount: number) {
  return `$${Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

function getMonthDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

type ExpenseChartPoint = {
  date: string
  actual: number | null
  trend: number | null
}

async function selectOptionContaining(select: Locator, text: string) {
  const value = await select.evaluate((element, searchText) => {
    const options = Array.from((element as HTMLSelectElement).options)
    const normalizedSearch = String(searchText).toLowerCase()
    return options.find(option =>
      !option.disabled &&
      option.value &&
      (option.textContent?.toLowerCase().includes(normalizedSearch) ?? false)
    )?.value ?? null
  }, text)

  if (!value) {
    throw new Error(`No select option contains "${text}"`)
  }

  await select.selectOption(value)
}

async function openReports(page: Page) {
  await page.goto('/reports')
  await expect(page.getByRole('banner').getByText('Reportes')).toBeVisible({ timeout: REPORT_TIMEOUT })
}

async function readExpenseChart(page: Page): Promise<ExpenseChartPoint[]> {
  const rawChartData = await page.getByTestId('expense-chart').getAttribute('data-expense-chart')

  if (!rawChartData) {
    throw new Error('Expense chart data attribute is missing')
  }

  return JSON.parse(rawChartData) as ExpenseChartPoint[]
}

async function expectMovementCount(page: Page, count: number) {
  const movementCountCard = page.getByText('Total movimientos').locator('xpath=..')
  await expect(movementCountCard).toContainText(String(count), { timeout: REPORT_TIMEOUT })
}

function categoryRow(page: Page, name: string) {
  return page.locator('button').filter({ has: page.getByText(name, { exact: true }) }).first()
}

async function openCategorySheet(page: Page, name: string) {
  const row = categoryRow(page, name)
  await expect(row).toBeVisible({ timeout: REPORT_TIMEOUT })
  await row.click()
  await expect(page.getByText('Movimientos de la categoría')).toBeVisible({ timeout: REPORT_TIMEOUT })
}

async function closeCategorySheet(page: Page) {
  await page.getByRole('button', { name: 'Cerrar' }).click()
  await expect(page.getByText('Movimientos de la categoría')).toHaveCount(0)
}

async function pickCustomRange(page: Page, startDay: number, endDay: number) {
  await page.getByRole('button', { name: /📅/ }).click()
  await expect(page.getByRole('button', { name: 'Últimos 7 días' })).toBeVisible({ timeout: REPORT_TIMEOUT })

  await page.getByRole('button', { name: new RegExp(`^${startDay}$`) }).click()
  await expect(page.getByText('Selecciona fecha fin')).toBeVisible({ timeout: REPORT_TIMEOUT })
  await page.getByRole('button', { name: new RegExp(`^${endDay}$`) }).click()
}

async function selectPreset(page: Page, label: string) {
  await page.getByRole('button', { name: /📅/ }).click()
  await expect(page.getByRole('button', { name: 'Últimos 7 días' })).toBeVisible({ timeout: REPORT_TIMEOUT })
  await page.getByRole('button', { name: label }).click()
}

test.describe('Reports — Advanced Calendar & Filters', () => {
  test.describe.configure({ timeout: REPORTS_SPEC_TIMEOUT })

  test('current month expense trend uses the elapsed-day daily average', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)

    const now = new Date()
    const today = formatDate(now)
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const day = now.getDate()
    const monthStart = getMonthDate(year, month, 1)
    const totalDaysInMonth = new Date(year, month, 0).getDate()

    await createMovement(page, { name: 'Arriendo parcial', amount: '20000', date: monthStart })

    let totalActualAmount = 20_000
    if (today !== monthStart) {
      await createMovement(page, { name: 'Supermercado', amount: '10000', date: today })
      totalActualAmount += 10_000
    }

    const trendTotal = Math.round((totalActualAmount / day) * totalDaysInMonth)
    const averageDailyExpense = totalActualAmount / day

    await openReports(page)
    await expect(page.getByText(`Tendencia lineal: ${formatClpFromPesos(trendTotal)}`)).toBeVisible({
      timeout: REPORT_TIMEOUT,
    })

    const expenseChart = await readExpenseChart(page)

    expect(expenseChart).toHaveLength(totalDaysInMonth)

    for (const [index, point] of expenseChart.entries()) {
      const dayNumber = index + 1

      expect(point.date).toBe(getMonthDate(year, month, dayNumber))
      expect(point.trend).not.toBeNull()
      expect(point.trend ?? 0).toBeCloseTo(averageDailyExpense * dayNumber, 6)
    }

    const expectedActualSeries = Array.from({ length: totalDaysInMonth }, (_, index) => {
      const dayNumber = index + 1

      if (dayNumber > day) {
        return null
      }

      if (today !== monthStart && dayNumber >= day) {
        return totalActualAmount
      }

      return 20_000
    })

    expect(expenseChart.map(point => point.actual)).toEqual(expectedActualSeries)
    expect(expenseChart[day - 1]?.trend ?? 0).toBeCloseTo(totalActualAmount, 6)
    expect(expenseChart[totalDaysInMonth - 1]?.trend ?? 0).toBeCloseTo(trendTotal, 6)
  })

  test('year range expense trend stays straight through future dates', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)

    const now = new Date()
    const today = formatDate(now)
    const year = now.getFullYear()
    const yearStart = getMonthDate(year, 1, 1)

    await createMovement(page, { name: 'Patente anual', amount: '24000', date: yearStart })

    let totalActualAmount = 24_000
    if (today !== yearStart) {
      await createMovement(page, { name: 'Bencina actual', amount: '12000', date: today })
      totalActualAmount += 12_000
    }

    await openReports(page)
    await selectPreset(page, 'Este año')
    await expect(page.getByRole('button', { name: /📅/ })).toContainText('Este año')
    await expect(page.getByText(/Tendencia lineal:/)).toBeVisible({ timeout: REPORT_TIMEOUT })

    const expenseChart = await readExpenseChart(page)
    const observedDays = expenseChart.findLastIndex(point => point.actual !== null) + 1
    const rangeDays = expenseChart.length
    const averageDailyExpense = totalActualAmount / observedDays
    const trendTotal = averageDailyExpense * rangeDays

    expect(observedDays).toBeGreaterThan(0)
    expect(rangeDays).toBeGreaterThan(observedDays)
    expect(expenseChart[0]).toMatchObject({
      date: yearStart,
      actual: 24_000,
    })

    for (const [index, point] of expenseChart.entries()) {
      expect(point.trend).not.toBeNull()
      expect(point.trend ?? 0).toBeCloseTo(averageDailyExpense * (index + 1), 6)
    }

    expect(expenseChart[observedDays - 1]?.actual ?? 0).toBeCloseTo(totalActualAmount, 6)
    expect(expenseChart[observedDays - 1]?.trend ?? 0).toBeCloseTo(totalActualAmount, 6)
    expect(expenseChart[rangeDays - 1]?.trend ?? 0).toBeCloseTo(trendTotal, 6)

    if (observedDays < rangeDays) {
      expect(expenseChart[observedDays]?.actual).toBeNull()
      expect(expenseChart[observedDays]?.trend ?? 0).toBeCloseTo(averageDailyExpense * (observedDays + 1), 6)
    }
  })

  test('custom date range selection and report filters update the data meaningfully', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)
    await createAccount(page, {
      bankName: 'Santander',
      accountType: 'Vista',
      lastFourDigits: '1111',
      initialBalance: '50000',
    })
    await ensureCategory(page, '🍔', 'Comida')
    await ensureCategory(page, '🚗', 'Transporte')

    const now = new Date()
    const today = formatDate(now)
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const day = now.getDate()
    const monthStart = getMonthDate(year, month, 1)
    const secondDay = getMonthDate(year, month, Math.min(day, 2))
    const hasEarlierSubset = day >= 3

    await createMovement(page, {
      name: 'Desayuno',
      amount: '8000',
      date: monthStart,
      categoryName: 'Comida',
      accountLabel: 'BCI',
    })
    await createMovement(page, {
      name: 'Uber',
      amount: '6000',
      date: secondDay,
      categoryName: 'Transporte',
      accountLabel: 'Santander',
    })
    await createMovement(page, {
      name: 'Almuerzo',
      amount: '15000',
      date: today,
      categoryName: 'Comida',
      accountLabel: 'BCI',
    })
    await createMovement(page, {
      name: 'Sueldo freelance',
      amount: '800000',
      type: 'income',
      date: today,
      accountLabel: 'BCI',
    })

    await openReports(page)
    await expectMovementCount(page, 4)
    await expect(categoryRow(page, 'Comida')).toBeVisible()
    await expect(categoryRow(page, 'Transporte')).toBeVisible()

    await pickCustomRange(page, 1, hasEarlierSubset ? 2 : 1)
    await expect(page.getByRole('button', { name: /📅/ })).toContainText(
      hasEarlierSubset ? `${monthStart.slice(5)} → ${secondDay.slice(5)}` : `${monthStart.slice(5)} → ${monthStart.slice(5)}`,
    )

    if (hasEarlierSubset) {
      await expectMovementCount(page, 2)
      await expect(page.getByText('Sin ingresos en este período')).toBeVisible()

      await openCategorySheet(page, 'Comida')
      await expect(page.getByText('Desayuno')).toBeVisible()
      await expect(page.getByText('Almuerzo')).toHaveCount(0)
      await closeCategorySheet(page)
    }

    await selectPreset(page, 'Este mes')
    await expectMovementCount(page, 4)

    const categorySelect = page.locator('select').first()
    await selectOptionContaining(categorySelect, 'Comida')
    await expectMovementCount(page, 2)
    await expect(page.getByText('Sin ingresos en este período')).toBeVisible()

    await openCategorySheet(page, 'Comida')
    await expect(page.getByText('Desayuno')).toBeVisible()
    await expect(page.getByText('Almuerzo')).toBeVisible()
    await expect(page.getByText('Uber')).toHaveCount(0)
    await closeCategorySheet(page)

    await categorySelect.selectOption('')
    await expectMovementCount(page, 4)

    const accountSelect = page.locator('select').nth(1)
    await selectOptionContaining(accountSelect, 'Santander')
    await expectMovementCount(page, 1)
    await expect(page.getByText('Sin ingresos en este período')).toBeVisible()
    await expect(categoryRow(page, 'Transporte')).toBeVisible()
    await expect(categoryRow(page, 'Comida')).toHaveCount(0)

    await openCategorySheet(page, 'Transporte')
    await expect(page.getByText('Uber')).toBeVisible()
    await expect(page.getByText('Desayuno')).toHaveCount(0)
  })

  test('reports empty state scenarios respond to real filter choices', async ({ page }) => {
    await registerAndLogin(page)
    await ensureAccount(page)
    await ensureCategory(page, '🎮', 'Entretenimiento')
    await ensureCategory(page, '🍔', 'Comida')

    const today = formatDate(new Date())

    await createMovement(page, {
      name: 'Netflix',
      amount: '12000',
      date: today,
      categoryName: 'Comida',
    })
    await createMovement(page, {
      name: 'Spotify',
      amount: '5000',
      date: today,
      categoryName: 'Comida',
    })

    await openReports(page)
    await expect(page.getByRole('heading', { name: '📈 Ingresos' })).toBeVisible()
    await expect(page.getByText('Sin ingresos en este período')).toBeVisible()

    const categorySelect = page.locator('select').first()
    await selectOptionContaining(categorySelect, 'Entretenimiento')
    await expect(page.getByText('Sin datos en este período')).toBeVisible({ timeout: REPORT_TIMEOUT })

    await categorySelect.selectOption('')
    await expectMovementCount(page, 2)
    await expect(page.getByText('Sin ingresos en este período')).toBeVisible()

    await createMovement(page, { name: 'Pago', amount: '100000', type: 'income', date: today })

    await openReports(page)
    await expectMovementCount(page, 3)
    await expect(page.getByRole('heading', { name: '📈 Ingresos' })).toBeVisible()
    await expect(page.getByText('Sin ingresos en este período')).toHaveCount(0)
  })
})
