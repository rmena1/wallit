import { test, expect, type Page } from '@playwright/test'
import { registerAndLogin } from './helpers'
import { createRegularAccount, createSpaceForUser, getPersonalSpaceId, getUserId, seedCategory, seedConfirmedWorkflowMovement, seedInterspaceTransfer, seedUsdToClpRate } from './db-helper'

const pesos = (n: number) => `$${n.toLocaleString('es-CL')}`
async function totals(page: Page, income: number, expense: number) {
  await expect(page.getByText('Ingresos', { exact: true }).locator('..')).toContainText(pesos(income))
  await expect(page.getByText('Gastos', { exact: true }).locator('..')).toContainText(pesos(expense))
}

test('category nets reconcile reports, dashboard, refunds, uncategorized and CLP-converted USD', async ({ page }) => {
  const userId = (await getUserId(await registerAndLogin(page)))!
  const accountId = await createRegularAccount(userId)
  const restaurant = await seedCategory(userId, { name: 'Restaurante net fixture' })
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
  const yesterdayDate = new Date(`${today}T12:00:00`)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = yesterdayDate.toISOString().slice(0, 10)
  await seedConfirmedWorkflowMovement(userId, accountId, { name: 'Restaurant bill', clpAmount: 3000000, type: 'expense', categoryId: restaurant, date: yesterday })
  await seedConfirmedWorkflowMovement(userId, accountId, { name: 'Restaurant refund', clpAmount: 2000000, type: 'income', categoryId: restaurant, date: today })
  await page.goto('/reports')
  // Use 100 days so the refund test also spans month/year boundaries.
  await page.getByTestId('reports-period-trigger').click()
  await page.getByRole('button', { name: '100 días', exact: true }).click()
  await totals(page, 0, 10000)
  const chart = JSON.parse((await page.getByTestId('expense-chart').getAttribute('data-expense-chart'))!) as { date: string; actual: number | null }[]
  expect(chart.find(p => p.date === yesterday)?.actual).toBe(30000)
  expect(chart.find(p => p.date === today)?.actual).toBe(10000)
  const category = page.getByRole('button').filter({ hasText: 'Restaurante net fixture' }).last()
  await expect(category).toContainText('-$10.000')
  await category.click()
  await expect(page.getByText('Restaurant refund', { exact: true })).toBeVisible()
  await expect(page.getByText('Restaurant bill', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await seedConfirmedWorkflowMovement(userId, accountId, { name: 'Uncategorized income', clpAmount: 500000, type: 'income', date: today })
  await seedConfirmedWorkflowMovement(userId, accountId, { name: 'Uncategorized expense', clpAmount: 300000, type: 'expense', date: today })
  const usdAccount = await createRegularAccount(userId, { currency: 'USD', lastFourDigits: '7766' })
  await seedUsdToClpRate(95000)
  const usdCategory = await seedCategory(userId, { name: 'USD net fixture' })
  await seedConfirmedWorkflowMovement(userId, usdAccount, { name: 'USD bill', clpAmount: 9500000, usdAmount: 10000, exchangeRate: 95000, currency: 'USD', type: 'expense', categoryId: usdCategory, date: today })
  await seedConfirmedWorkflowMovement(userId, usdAccount, { name: 'USD refund', clpAmount: 1900000, usdAmount: 2000, exchangeRate: 95000, currency: 'USD', type: 'income', categoryId: usdCategory, date: today })
  await page.goto('/')
  await totals(page, 5000, 89000)
  await page.goto('/reports')
  await page.getByTestId('reports-period-trigger').click()
  await page.getByRole('button', { name: '100 días', exact: true }).click()
  await totals(page, 5000, 89000)
  const expenses = JSON.parse((await page.getByTestId('expense-chart').getAttribute('data-expense-chart'))!)
  expect(expenses.filter((p: { actual: number | null }) => p.actual !== null).at(-1).actual).toBe(89000)
  const incomes = JSON.parse((await page.getByTestId('income-chart').getAttribute('data-income-chart'))!)
  expect(incomes.filter((p: { income: number | null }) => p.income !== null).at(-1).income).toBe(5000)
  await page.locator('select').selectOption(usdAccount)
  await totals(page, 0, 76000)
  await expect(page.getByTestId('balance-chart')).toHaveAttribute('data-balance-currency', 'USD')
})

test('Personal salary and reportable outgoing transfer net to allowance; Casa nets salaries', async ({ page }) => {
  const userId = (await getUserId(await registerAndLogin(page)))!
  const personal = await getPersonalSpaceId(userId)
  const casa = await createSpaceForUser(userId, 'Casa net fixture')
  const personalAccount = await createRegularAccount(userId)
  const casaAccount = await createRegularAccount(userId, { spaceId: casa })
  const salary = await seedCategory(userId, { name: 'Sueldo net fixture' })
  const casaSalary = await seedCategory(userId, { name: 'Sueldo net fixture', spaceId: casa })
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
  await seedConfirmedWorkflowMovement(userId, personalAccount, { name: 'Salary', clpAmount: 248425500, type: 'income', categoryId: salary, date })
  await seedInterspaceTransfer(userId, { sourceSpaceId: personal, destinationSpaceId: casa, sourceAccountId: personalAccount, destinationAccountId: casaAccount, amount: 248425500, sourceCategoryId: salary, date })
  await seedConfirmedWorkflowMovement(userId, personalAccount, { name: 'Allowance', clpAmount: 110000000, type: 'income', categoryId: salary, date })
  await page.goto('/reports')
  await totals(page, 1100000, 0)
  await expect(page.getByRole('button').filter({ hasText: 'Sueldo net fixture' }).last()).toContainText('+$1.100.000')
  await page.goto('/')
  await totals(page, 1100000, 0)
  for (const [type, amount] of [['income', 240000000], ['income', 210000000], ['expense', 110000000], ['expense', 110000000]] as const) {
    await seedConfirmedWorkflowMovement(userId, casaAccount, { name: `Casa ${type}`, clpAmount: amount, type, categoryId: casaSalary, spaceId: casa, date })
  }
  await page.context().addCookies([{ name: 'wallit_active_space', value: casa, domain: 'localhost', path: '/' }])
  await page.goto('/reports')
  await totals(page, 2300000, 0)
  await page.goto('/')
  await totals(page, 2300000, 0)
})
