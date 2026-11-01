import assert from 'node:assert/strict'
import test from 'node:test'
import { netReportCategories } from '../src/lib/domain/report-netting.ts'

const row = (categoryId, income, expense, date = '2026-10-01') => ({ categoryId, income, expense, date, count: 1 })

test('Restaurante refund lowers expense and daily cumulative expense', () => {
  const result = netReportCategories([row('Restaurante', 0, 3000000), row('Restaurante', 2000000, 0, '2026-10-02')])
  assert.equal(result.totalIncome, 0)
  assert.equal(result.totalExpense, 1000000)
  assert.equal(result.breakdown[0].net, -1000000)
  assert.deepEqual(result.dailyData.map(d => d.expense), [3000000, -2000000])
  assert.equal(result.grossExpense, 3000000)
  assert.equal(result.grossIncome, 2000000)
})

test('Personal salary transfer and allowance net to allowance; Casa nets independently', () => {
  const personal = netReportCategories([row('Sueldo', 248425500, 0), row('Sueldo', 0, 248425500), row('Sueldo', 110000000, 0)])
  assert.equal(personal.totalIncome, 110000000)
  assert.equal(personal.totalExpense, 0)
  const casa = netReportCategories([row('Sueldo', 240000000, 0), row('Sueldo', 210000000, 0), row('Sueldo', 0, 110000000), row('Sueldo', 0, 110000000)])
  assert.equal(casa.totalIncome, 230000000)
})

test('uncategorized remains gross; categories never offset each other', () => {
  const result = netReportCategories([row(null, 500000, 300000), row('a', 100, 0), row('b', 0, 200)])
  assert.equal(result.totalIncome, 500100)
  assert.equal(result.totalExpense, 300200)
  assert.equal(result.totalIncome - result.totalExpense, result.grossIncome - result.grossExpense)
  assert.equal(result.breakdown.filter(c => c.categoryId === null).length, 2)
})

test('sign crossings, exact cancellation and unordered SQL strings reconcile every prefix', () => {
  const rows = [row('a', '40', '0', '2026-10-03'), row('a', '0', '30'), row('a', '30', '0', '2026-10-02'), row('a', '0', '50', '2026-10-04')]
  const result = netReportCategories(rows)
  let income = 0, expense = 0
  for (const day of result.dailyData) {
    income += day.income
    expense += day.expense
    const prefix = netReportCategories(rows.filter(r => r.date <= day.date))
    assert.equal(income, prefix.totalIncome)
    assert.equal(expense, prefix.totalExpense)
  }
  assert.deepEqual(result.dailyData.map(d => [d.income, d.expense]), [[0,30],[0,-30],[40,0],[-40,10]])
  assert.equal(netReportCategories(rows.slice(1, 3)).breakdown.length, 0)
  assert.equal(netReportCategories([]).totalExpense, 0)
})
