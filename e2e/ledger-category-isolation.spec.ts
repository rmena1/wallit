import { test, expect } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { registerAndLogin } from './helpers'
import { createRegularAccount, createSpaceForUser, getPersonalSpaceId, getUserId, seedCategory, seedConfirmedWorkflowMovement } from './db-helper'
import { getDb, movements } from '../src/lib/db'
import { movementLedger } from '../src/lib/domain/movement-ledger'

process.env.DATABASE_URL ||= 'postgresql://127.0.0.1:5432/wallit_e2e'

test('concurrent splits keep category reads inside their reserved transactions', async ({ page }) => {
  const email = await registerAndLogin(page)
  const userId = (await getUserId(email))!
  const spaceId = await getPersonalSpaceId(userId)
  const accountId = await createRegularAccount(userId)
  const otherSpace = await createSpaceForUser(userId, 'Other categories')
  const categoryId = await seedCategory(userId, { name: 'Local', spaceId })
  const foreignId = await seedCategory(userId, { name: 'Foreign', spaceId: otherSpace })
  const ids = await Promise.all(Array.from({ length: 10 }, (_, i) => seedConfirmedWorkflowMovement(userId, accountId, {
    name: `Original ${i}`, type: 'expense', clpAmount: 3000, categoryId: i % 2 ? foreignId : categoryId,
  })))

  const client = getDb()
  const originalTransaction = client.transaction
  const originalSelect = client.select
  let entered = 0
  let poolReserved = false
  let release!: () => void
  let timer: ReturnType<typeof setTimeout>
  const ready = new Promise<void>((resolve, reject) => {
    release = resolve
    timer = setTimeout(() => reject(new Error('Ten split transactions did not reach the barrier')), 10_000)
  })
  // Reserve all ten pool connections before executing transaction bodies. Fail
  // a global read immediately instead of letting the regression hang the suite.
  client.transaction = ((callback, options) => originalTransaction.call(client, async tx => {
    if (++entered === 10) {
      poolReserved = true
      clearTimeout(timer)
      release()
    }
    await ready
    return callback(tx)
  }, options)) as typeof client.transaction
  client.select = ((...args: Parameters<typeof client.select>) => {
    if (poolReserved) throw new Error('Category read escaped its transaction into the exhausted global pool')
    return originalSelect.apply(client, args)
  }) as typeof client.select

  try {
    const results = await Promise.allSettled(ids.map((id, i) => movementLedger.splitMovement(spaceId, userId, id, [
      { name: `First ${i}`, amount: 1000 }, { name: `Second ${i}`, amount: 2000 },
    ])))
    expect(entered).toBe(10)
    for (const result of results) expect(result).toMatchObject({ status: 'fulfilled', value: { success: true } })
  } finally {
    clearTimeout(timer!)
    client.transaction = originalTransaction
    client.select = originalSelect
  }
  const rows = await client.select().from(movements).where(eq(movements.spaceId, spaceId))
  expect(rows).toHaveLength(20)
  expect(rows.reduce((total, row) => total + row.amount, 0)).toBe(30000)
  for (const row of rows) {
    const i = Number(row.name.split(' ').at(-1))
    expect(row.categoryId).toBe(i % 2 ? null : categoryId)
    expect(row.needsReview).toBe(true)
  }
})
