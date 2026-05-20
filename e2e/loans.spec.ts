import { test, expect } from '@playwright/test'
import { registerAndLogin, ensureAccount, screenshot } from './helpers'
import { getFirstAccountId, getUserId, seedConfirmedWorkflowMovement, seedReceivable, seedReviewMovement, seedUsdToClpRate } from './db-helper'

test.describe('Loans', () => {
  test('USD loan totals use USD paybacks and hide CLP-only candidate expenses', async ({ page }) => {
    const email = await registerAndLogin(page)
    await ensureAccount(page)
    await seedUsdToClpRate(95000)

    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)

    const loanId = await seedConfirmedWorkflowMovement(userId, accountId, {
      name: 'USD Loan Exact',
      clpAmount: 19000000,
      usdAmount: 20000,
      exchangeRate: 95000,
      type: 'income',
      currency: 'USD',
      loan: true,
    })

    await seedConfirmedWorkflowMovement(userId, accountId, {
      name: 'USD Payback Exact',
      clpAmount: 4750000,
      usdAmount: 5000,
      exchangeRate: 95000,
      type: 'expense',
      currency: 'USD',
      loanId,
    })

    await seedConfirmedWorkflowMovement(userId, accountId, {
      name: 'CLP Candidate Not For USD Loan',
      clpAmount: 3000000,
      type: 'expense',
      currency: 'CLP',
    })

    await page.goto(`/loans/${loanId}`)
    await expect(page.getByText('USD Loan Exact')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Total', { exact: true }).locator('xpath=..')).toContainText('US$200,00')
    await expect(page.getByText('Pagado', { exact: true }).locator('xpath=..')).toContainText('US$50,00')
    await expect(page.getByText('Restante', { exact: true }).locator('xpath=..')).toContainText('US$150,00')
    await expect(page.getByText('USD Payback Exact')).toBeVisible()
    await screenshot(page, 'loan-usd-01-detail')

    await page.getByRole('button', { name: /Saldar préstamo/i }).click()
    await page.getByRole('button', { name: 'Vincular gasto' }).click()
    await expect(page.getByText('CLP Candidate Not For USD Loan')).not.toBeVisible()
    await screenshot(page, 'loan-usd-02-candidates')
  })

  test('loan payback candidate list hides expenses already in other workflows', async ({ page }) => {
    const email = await registerAndLogin(page)
    await ensureAccount(page)

    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found in DB')
    const accountId = await getFirstAccountId(userId)

    const loanId = await seedConfirmedWorkflowMovement(userId, accountId, {
      name: 'Loan Candidate Filter',
      clpAmount: 10000000,
      type: 'income',
      loan: true,
    })
    const otherLoanId = await seedConfirmedWorkflowMovement(userId, accountId, {
      name: 'Other Existing Loan',
      clpAmount: 1000000,
      type: 'income',
      loan: true,
    })

    await seedConfirmedWorkflowMovement(userId, accountId, {
      name: 'Valid Payback Candidate',
      clpAmount: 2000000,
      type: 'expense',
    })
    await seedReviewMovement(userId, accountId, 'Pending Candidate Hidden', 2000000)
    await seedReceivable(userId, accountId, 'Receivable Candidate Hidden', 2000000)
    await seedConfirmedWorkflowMovement(userId, accountId, {
      name: 'Emergency Candidate Hidden',
      clpAmount: 2000000,
      type: 'expense',
      emergency: true,
    })
    await seedConfirmedWorkflowMovement(userId, accountId, {
      name: 'Linked Candidate Hidden',
      clpAmount: 2000000,
      type: 'expense',
      loanId: otherLoanId,
    })

    await page.goto(`/loans/${loanId}`)
    await expect(page.getByText('Loan Candidate Filter')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: /Saldar préstamo/i }).click()
    await page.getByRole('button', { name: 'Vincular gasto' }).click()

    await expect(page.getByText('Valid Payback Candidate')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Pending Candidate Hidden')).not.toBeVisible()
    await expect(page.getByText('Receivable Candidate Hidden')).not.toBeVisible()
    await expect(page.getByText('Emergency Candidate Hidden')).not.toBeVisible()
    await expect(page.getByText('Linked Candidate Hidden')).not.toBeVisible()
    await screenshot(page, 'loan-payback-candidates-filtered')
  })
})
