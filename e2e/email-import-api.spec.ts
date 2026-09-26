import { expect, test } from '@playwright/test'
import { registerAndLogin } from './helpers'
import {
  getMovementWorkflowState,
  getPersonalSpaceId,
  createRegularAccount,
  createSpaceForUser,
  getUserId,
  removeUserFromSpace,
  seedCategory,
} from './db-helper'
import { getImportServiceToken } from '../src/lib/import-auth'

process.env.DATABASE_URL ||= 'postgresql://127.0.0.1:5432/wallit_e2e'

function headers() {
  return { authorization: `Bearer ${getImportServiceToken()}` }
}

test.describe('Authenticated email import service', () => {
  test('owns USD canonicalization, authorization, validation and movement idempotency', async ({ page }) => {
    const email = await registerAndLogin(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found')
    const accountId = await createRegularAccount(userId, { lastFourDigits: '6101' })
    const categoryId = await seedCategory(userId, { name: 'Import API', emoji: '📨' })
    const payload = {
      kind: 'movement',
      userId,
      accountId,
      categoryId,
      name: 'API USD canonical',
      date: '2026-09-02',
      type: 'expense',
      currency: 'USD',
      amount: 1, // untrusted agent arithmetic must be ignored
      amountUsd: 18_219,
      exchangeRate: 93_577,
      sourceEmailProvider: 'bci',
      sourceEmailId: '<api-usd-1@bci.cl>',
    }

    const unauthorized = await page.request.post('/api/import/email', { data: payload })
    expect(unauthorized.status()).toBe(401)

    const first = await page.request.post('/api/import/email', { headers: headers(), data: payload })
    expect(first.status()).toBe(200)
    const firstBody = await first.json()
    expect(firstBody).toMatchObject({ success: true, duplicate: false })

    const retry = await page.request.post('/api/import/email', { headers: headers(), data: payload })
    expect(await retry.json()).toMatchObject({
      success: true,
      duplicate: true,
      movementId: firstBody.movementId,
    })

    const missingFacts = await page.request.post('/api/import/email', {
      headers: headers(),
      data: { ...payload, sourceEmailId: 'api-usd-invalid@bci.cl', exchangeRate: undefined },
    })
    expect(missingFacts.status()).toBe(400)
    expect((await missingFacts.json()).error).toContain('exchangeRate')

    const inaccessibleSpaceId = await createSpaceForUser(userId, 'Inaccessible import')
    const inaccessibleAccountId = await createRegularAccount(userId, { spaceId: inaccessibleSpaceId })
    await removeUserFromSpace(userId, inaccessibleSpaceId)
    const inaccessible = await page.request.post('/api/import/email', {
      headers: headers(),
      data: { ...payload, accountId: inaccessibleAccountId, sourceEmailId: 'api-foreign@bci.cl' },
    })
    expect(inaccessible.status()).toBe(400)
    expect((await inaccessible.json()).error).toContain('not accessible')

    await page.goto('/review')
    await expect(page.getByText('API USD canonical')).toBeVisible()
    await expect(page.getByLabel('Monto CLP equivalente')).toHaveValue('170487.94')
    await expect(page.getByLabel('Monto USD')).toHaveValue('182.19')
  })

  test('creates a transfer atomically and resolves retries to the same pair', async ({ page }) => {
    const email = await registerAndLogin(page)
    const userId = await getUserId(email)
    if (!userId) throw new Error('User not found')
    const fromAccountId = await createRegularAccount(userId, { bankName: 'Origen API', lastFourDigits: '6201' })
    const toAccountId = await createRegularAccount(userId, { bankName: 'Destino API', lastFourDigits: '6202' })
    const payload = {
      kind: 'transfer',
      userId,
      fromAccountId,
      toAccountId,
      date: '2026-09-02',
      amount: 45_000_00,
      currency: 'CLP',
      sourceName: 'Transferencia importada API',
      destinationName: 'Recepción importada API',
      sourceEmailProvider: 'tenpo',
      sourceEmailId: 'api-transfer-1@tenpo.cl',
    }

    const first = await page.request.post('/api/import/email', { headers: headers(), data: payload })
    expect(first.status()).toBe(200)
    const firstBody = await first.json()
    expect(firstBody).toMatchObject({ success: true, duplicate: false })
    expect(firstBody.transferId).toBeTruthy()
    expect(firstBody.sourceMovementId).toBeTruthy()
    expect(firstBody.destinationMovementId).toBeTruthy()

    const retry = await page.request.post('/api/import/email', { headers: headers(), data: payload })
    expect(await retry.json()).toMatchObject({
      success: true,
      duplicate: true,
      transferId: firstBody.transferId,
      sourceMovementId: firstBody.sourceMovementId,
      destinationMovementId: firstBody.destinationMovementId,
    })
  })
  test('persists same/inter-Space flags and ambiguous expense review override', async ({ page }) => {
    const email = await registerAndLogin(page)
    const userId = (await getUserId(email))!
    const personal = await getPersonalSpaceId(userId)
    const casa = await createSpaceForUser(userId, 'Casa import')
    const source = await createRegularAccount(userId)
    for (const [spaceId, inter] of [[personal, false], [casa, true]] as const) {
      const destination = await createRegularAccount(userId, { spaceId })
      const sourceName = `Flags source ${inter}`
      const destinationName = `Flags destination ${inter}`
      const response = await page.request.post('/api/import/email', {
        headers: headers(), data: {
          kind: 'transfer', userId, fromAccountId: source, toAccountId: destination,
          sourceName, destinationName, date: '2026-09-26', amount: 100000,
          sourceEmailProvider: 'tenpo', sourceEmailId: `flags-${inter}`,
        },
      })
      expect(response.status()).toBe(200)
      for (const [space, name, type] of [[personal, sourceName, 'expense'], [spaceId, destinationName, 'income']]) {
        expect(await getMovementWorkflowState(space, name)).toMatchObject({
          type, reportable: inter, needsReview: inter, categoryId: null,
        })
      }
    }
    const fallback = {
      kind: 'movement', userId, accountId: source, name: 'Ambiguous internal',
      type: 'expense', needsReview: false, date: '2026-09-26', amount: 100000,
      sourceEmailProvider: 'bci', sourceEmailId: 'ambiguous-internal',
    }
    const response = await page.request.post('/api/import/email', { headers: headers(), data: fallback })
    expect(response.status()).toBe(200)
    expect(await getMovementWorkflowState(personal, fallback.name)).toMatchObject({ needsReview: false, type: 'expense', reportable: true })
    const invalid = await page.request.post('/api/import/email', { headers: headers(), data: { ...fallback, needsReview: 'false' } })
    expect(invalid.status()).toBe(400)
  })

})
