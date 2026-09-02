import assert from 'node:assert/strict'
import test from 'node:test'
import {
  USD_CLP_DISCREPANCY_TOLERANCE_CENTS,
  expectedClpCents,
  validateUsdClpAmounts,
} from '../src/lib/domain/money.ts'

const amountUsd = 18_219
const exchangeRate = 93_577
const expected = expectedClpCents(amountUsd, exchangeRate)

for (const discrepancy of [0, 999, 1_000]) {
  test(`accepts a USD/CLP discrepancy of ${discrepancy} cents`, () => {
    assert.equal(validateUsdClpAmounts({ amount: expected + discrepancy, amountUsd, exchangeRate }).valid, true)
  })
}

test('rejects a USD/CLP discrepancy of 1001 cents with diagnostics', () => {
  const result = validateUsdClpAmounts({ amount: expected + 1_001, amountUsd, exchangeRate })
  assert.equal(result.valid, false)
  assert.equal(result.expectedClp, expected)
  assert.equal(result.discrepancy, 1_001)
  assert.match(result.error ?? '', /esperado/)
  assert.match(result.error ?? '', /diferencia/)
  assert.match(result.error ?? '', /tolerancia/)
})

test('exports the database tolerance in CLP cents', () => {
  assert.equal(USD_CLP_DISCREPANCY_TOLERANCE_CENTS, 1_000)
})

test('calculates large values exactly without an unsafe intermediate product', () => {
  const usd = 2_000_000_000
  const rate = 400_000_000
  assert.equal(expectedClpCents(usd, rate), 8_000_000_000_000_000)
})

test('rejects a canonical CLP result outside the safe integer range', () => {
  assert.throws(() => expectedClpCents(Number.MAX_SAFE_INTEGER, 101), /fuera de rango/)
})
