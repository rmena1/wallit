import assert from 'node:assert/strict'
import test from 'node:test'
import { accountBalanceBase } from '../src/lib/domain/account-balance.ts'

const account = { accountType: 'Crédito', creditLimit: 50000000, initialBalance: 12000000, isInvestment: false }

for (const accountType of ['Crédito', 'credit']) {
  test(`${accountType} uses creditLimit despite a divergent initialBalance`, () => {
    const base = accountBalanceBase({ ...account, accountType })
    assert.equal(base, 50000000)
    const available = base + 2000000 - 7000000
    assert.equal(available, 45000000)
    assert.equal(account.creditLimit - available, 5000000)
  })
}

for (const creditLimit of [null, 0, -1]) {
  test(`credit limit ${creditLimit} preserves the initial balance fallback`, () => {
    assert.equal(accountBalanceBase({ ...account, creditLimit }), account.initialBalance)
  })
}

for (const accountType of ['Corriente', 'Vista', 'Ahorro', 'Prepago', 'debit']) {
  test(`${accountType} preserves its initial balance`, () => {
    assert.equal(accountBalanceBase({ ...account, accountType }), account.initialBalance)
  })
}

test('investment opening base is unchanged even with a credit type and limit', () => {
  assert.equal(accountBalanceBase({ ...account, isInvestment: true }), account.initialBalance)
})
