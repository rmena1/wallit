import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/wallit'

const sql = postgres(DATABASE_URL, { max: 5 })

function testId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function getUserId(email: string): Promise<string | null> {
  const rows = await sql`SELECT id FROM users WHERE email = ${email}`
  return rows[0]?.id ?? null
}

export async function getPersonalSpaceId(userId: string): Promise<string> {
  const existing = await sql`
    SELECT s.id
    FROM spaces s
    INNER JOIN space_memberships sm ON sm.space_id = s.id
    WHERE sm.user_id = ${userId}
      AND s.is_personal = true
      AND s.archived_at IS NULL
    LIMIT 1
  `
  if (existing[0]?.id) return existing[0].id

  const now = new Date()
  const spaceId = testId('sp-personal')
  await sql`
    INSERT INTO spaces (id, name, normalized_name, emoji, is_personal, created_by_user_id, created_at, updated_at)
    VALUES (${spaceId}, 'Personal', 'personal', '👤', true, ${userId}, ${now}, ${now})
  `
  await sql`
    INSERT INTO space_memberships (id, space_id, user_id, role, created_at)
    VALUES (${testId('sm')}, ${spaceId}, ${userId}, 'owner', ${now})
  `
  return spaceId
}

async function resolveSpaceId(userId: string, spaceId?: string | null): Promise<string> {
  return spaceId ?? await getPersonalSpaceId(userId)
}

export async function getSpaceIdByName(userId: string, name: string): Promise<string | null> {
  const rows = await sql`
    SELECT s.id
    FROM spaces s
    INNER JOIN space_memberships sm ON sm.space_id = s.id
    WHERE sm.user_id = ${userId}
      AND lower(trim(s.name)) = lower(trim(${name}))
      AND s.archived_at IS NULL
    LIMIT 1
  `
  return rows[0]?.id ?? null
}

export async function getMovementIdByName(userId: string, name: string, spaceId?: string): Promise<string | null> {
  const resolvedSpaceId = await resolveSpaceId(userId, spaceId)
  const rows = await sql`
    SELECT id FROM movements
    WHERE space_id = ${resolvedSpaceId} AND name = ${name}
    ORDER BY created_at DESC
    LIMIT 1
  `
  return rows[0]?.id ?? null
}

export async function getMovementCreatedByByName(spaceId: string, name: string): Promise<string | null> {
  const rows = await sql`
    SELECT created_by_user_id
    FROM movements
    WHERE space_id = ${spaceId} AND name = ${name}
    ORDER BY created_at DESC
    LIMIT 1
  `
  return rows[0]?.created_by_user_id ?? null
}

export async function getFirstAccountId(userId: string): Promise<string | null> {
  const spaceId = await getPersonalSpaceId(userId)
  const rows = await sql`SELECT id FROM accounts WHERE space_id = ${spaceId} ORDER BY created_at ASC LIMIT 1`
  return rows[0]?.id ?? null
}

export async function getAccounts(userId: string): Promise<{ id: string; bank_name: string }[]> {
  const spaceId = await getPersonalSpaceId(userId)
  const rows = await sql`SELECT id, bank_name FROM accounts WHERE space_id = ${spaceId} ORDER BY created_at ASC`
  return rows as unknown as { id: string; bank_name: string }[]
}

export async function createAccount(userId: string, spaceId?: string): Promise<string> {
  const now = new Date()
  const id = testId('acc')
  const resolvedSpaceId = await resolveSpaceId(userId, spaceId)
  await sql`
    INSERT INTO accounts (id, space_id, created_by_user_id, bank_name, account_type, last_four_digits, initial_balance, currency, created_at, updated_at)
    VALUES (${id}, ${resolvedSpaceId}, ${userId}, 'BCI', 'Corriente', '9999', 100000000, 'CLP', ${now}, ${now})
  `
  return id
}

export async function createRegularAccount(userId: string, opts: {
  bankName?: string
  accountType?: string
  lastFourDigits?: string
  initialBalance?: number
  currency?: 'CLP' | 'USD'
  spaceId?: string
} = {}): Promise<string> {
  const now = new Date()
  const id = testId('acc')
  const spaceId = await resolveSpaceId(userId, opts.spaceId)
  await sql`
    INSERT INTO accounts (id, space_id, created_by_user_id, bank_name, account_type, last_four_digits, initial_balance, currency, created_at, updated_at)
    VALUES (
      ${id},
      ${spaceId},
      ${userId},
      ${opts.bankName ?? 'BCI'},
      ${opts.accountType ?? 'Corriente'},
      ${opts.lastFourDigits ?? '9999'},
      ${opts.initialBalance ?? 100000000},
      ${opts.currency ?? 'CLP'},
      ${now},
      ${now}
    )
  `
  return id
}

export async function seedCategory(userId: string, opts: { name: string; emoji?: string; spaceId?: string }): Promise<string> {
  const now = new Date()
  const id = testId('cat')
  const spaceId = await resolveSpaceId(userId, opts.spaceId)
  await sql`
    INSERT INTO categories (id, space_id, created_by_user_id, name, emoji, created_at, updated_at)
    VALUES (${id}, ${spaceId}, ${userId}, ${opts.name}, ${opts.emoji ?? '📦'}, ${now}, ${now})
  `
  return id
}

export async function createInvestmentAccount(userId: string, opts: {
  bankName?: string
  accountType?: string
  lastFourDigits?: string
  initialBalance?: number
  currentValue?: number
  currency?: 'CLP' | 'USD'
  createdAt?: Date
  updatedAt?: Date
  spaceId?: string
} = {}): Promise<string> {
  const createdAt = opts.createdAt ?? new Date()
  const updatedAt = opts.updatedAt ?? createdAt
  const initialBalance = opts.initialBalance ?? 0
  const currentValue = opts.currentValue ?? initialBalance
  const id = testId('inv')
  const spaceId = await resolveSpaceId(userId, opts.spaceId)

  await sql`
    INSERT INTO accounts (
      id, space_id, created_by_user_id, bank_name, account_type, last_four_digits,
      initial_balance, currency, is_investment, current_value,
      current_value_updated_at, created_at, updated_at
    )
    VALUES (
      ${id},
      ${spaceId},
      ${userId},
      ${opts.bankName ?? 'Fintual'},
      ${opts.accountType ?? 'Ahorro'},
      ${opts.lastFourDigits ?? '0001'},
      ${initialBalance},
      ${opts.currency ?? 'CLP'},
      true,
      ${currentValue},
      ${updatedAt},
      ${createdAt},
      ${updatedAt}
    )
  `

  return id
}

export async function seedInvestmentSnapshot(userId: string, accountId: string, opts: {
  value: number
  date: string
  createdAt?: Date
  spaceId?: string
}) {
  const createdAt = opts.createdAt ?? new Date()
  const id = testId('snap')
  const spaceId = await resolveSpaceId(userId, opts.spaceId)

  await sql`
    INSERT INTO investment_snapshots (id, account_id, space_id, created_by_user_id, value, date, created_at)
    VALUES (${id}, ${accountId}, ${spaceId}, ${userId}, ${opts.value}, ${opts.date}, ${createdAt})
  `
}

export async function seedTransferMovement(userId: string, accountId: string, opts: {
  name?: string
  amount: number
  type: 'income' | 'expense'
  date: string
  createdAt?: Date
  transferId?: string
  spaceId?: string
}) {
  const createdAt = opts.createdAt ?? new Date()
  const id = testId('tr')
  const transferId = opts.transferId ?? testId('transfer')
  const spaceId = await resolveSpaceId(userId, opts.spaceId)

  await sql`
    INSERT INTO movements (
      id, space_id, created_by_user_id, account_id, name, date, amount, type,
      needs_review, currency, receivable, received,
      transfer_id, created_at, updated_at
    )
    VALUES (
      ${id},
      ${spaceId},
      ${userId},
      ${accountId},
      ${opts.name ?? 'Transferencia inversión'},
      ${opts.date},
      ${opts.amount},
      ${opts.type},
      false,
      'CLP',
      false,
      false,
      ${transferId},
      ${createdAt},
      ${createdAt}
    )
  `
}

export async function seedReviewMovements(userId: string, accountId: string | null) {
  const today = new Date().toISOString().slice(0, 10)
  const base = Date.now()
  const spaceId = await getPersonalSpaceId(userId)

  const pending = [
    { id: `rev-${base}-3`, name: 'Compra Supermercado', amount: 4520000, type: 'expense', ts: new Date(base - 2000) },
    { id: `rev-${base}-2`, name: 'Transferencia recibida', amount: 5000000, type: 'income', ts: new Date(base - 1000) },
    { id: `rev-${base}-1`, name: 'Uber Eats - Pizza', amount: 1500000, type: 'expense', ts: new Date(base) },
  ]

  for (const m of pending) {
    await sql`
      INSERT INTO movements (id, space_id, created_by_user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
      VALUES (${m.id}, ${spaceId}, ${userId}, ${accountId}, ${m.name}, ${today}, ${m.amount}, ${m.type}, true, 'CLP', false, false, ${m.ts}, ${m.ts})
    `
  }
}

export async function seedReviewMovement(userId: string, accountId: string | null, name: string, amount: number, spaceIdOverride?: string): Promise<string> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const id = testId('rev-adv')
  const spaceId = await resolveSpaceId(userId, spaceIdOverride)
  await sql`
    INSERT INTO movements (id, space_id, created_by_user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (${id}, ${spaceId}, ${userId}, ${accountId}, ${name}, ${today}, ${amount}, 'expense', true, 'CLP', false, false, ${now}, ${now})
  `
  return id
}

export async function seedTypedReviewMovement(userId: string, accountId: string | null, opts: {
  name: string
  amount: number
  type: 'income' | 'expense'
}): Promise<string> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const id = testId('rev-typed')
  const spaceId = await getPersonalSpaceId(userId)
  await sql`
    INSERT INTO movements (id, space_id, created_by_user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (${id}, ${spaceId}, ${userId}, ${accountId}, ${opts.name}, ${today}, ${opts.amount}, ${opts.type}, true, 'CLP', false, false, ${now}, ${now})
  `
  return id
}

export async function seedConfirmedWorkflowMovement(userId: string, accountId: string | null, opts: {
  name: string
  clpAmount: number
  type: 'income' | 'expense'
  categoryId?: string | null
  currency?: 'CLP' | 'USD'
  usdAmount?: number | null
  exchangeRate?: number | null
  emergency?: boolean
  loan?: boolean
  loanId?: string | null
  spaceId?: string
}): Promise<string> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const id = testId('wf')
  const spaceId = await resolveSpaceId(userId, opts.spaceId)
  await sql`
    INSERT INTO movements (
      id, space_id, created_by_user_id, category_id, account_id, name, date, amount, type,
      needs_review, currency, amount_usd, exchange_rate,
      receivable, received, emergency, emergency_settled,
      loan, loan_settled, loan_id, created_at, updated_at
    )
    VALUES (
      ${id},
      ${spaceId},
      ${userId},
      ${opts.categoryId ?? null},
      ${accountId},
      ${opts.name},
      ${today},
      ${opts.clpAmount},
      ${opts.type},
      false,
      ${opts.currency ?? 'CLP'},
      ${opts.usdAmount ?? null},
      ${opts.exchangeRate ?? null},
      false,
      false,
      ${opts.emergency ?? false},
      false,
      ${opts.loan ?? false},
      false,
      ${opts.loanId ?? null},
      ${now},
      ${now}
    )
  `
  return id
}

export async function seedUsdReviewMovement(userId: string, accountId: string | null, name: string, opts: {
  clpAmount: number
  usdAmount: number
  exchangeRate: number
  type?: 'income' | 'expense'
  spaceId?: string
}): Promise<string> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const id = testId('rev-usd')
  const spaceId = await resolveSpaceId(userId, opts.spaceId)
  await sql`
    INSERT INTO movements (
      id, space_id, created_by_user_id, account_id, name, date, amount, type,
      needs_review, currency, amount_usd, exchange_rate,
      receivable, received, created_at, updated_at
    )
    VALUES (
      ${id},
      ${spaceId},
      ${userId},
      ${accountId},
      ${name},
      ${today},
      ${opts.clpAmount},
      ${opts.type ?? 'expense'},
      true,
      'USD',
      ${opts.usdAmount},
      ${opts.exchangeRate},
      false,
      false,
      ${now},
      ${now}
    )
  `
  return id
}

export async function seedConfirmedMovement(userId: string, accountId: string | null, name: string, amount: number): Promise<string> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const id = testId('mov-convert')
  const spaceId = await getPersonalSpaceId(userId)
  await sql`
    INSERT INTO movements (id, space_id, created_by_user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (${id}, ${spaceId}, ${userId}, ${accountId}, ${name}, ${today}, ${amount}, 'expense', false, 'CLP', false, false, ${now}, ${now})
  `
  return id
}

export async function seedReceivable(userId: string, accountId: string | null, name: string, amount: number): Promise<string> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const id = testId('recv')
  const spaceId = await getPersonalSpaceId(userId)
  await sql`
    INSERT INTO movements (id, space_id, created_by_user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (${id}, ${spaceId}, ${userId}, ${accountId}, ${name}, ${today}, ${amount}, 'expense', false, 'CLP', true, false, ${now}, ${now})
  `
  return id
}

export async function seedManyMovements(userId: string, accountId: string, count: number) {
  const today = new Date()
  const spaceId = await getPersonalSpaceId(userId)

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
    date.setDate(date.getDate() - Math.floor(i / 5))
    const dateStr = date.toISOString().slice(0, 10)
    const amount = (Math.floor(Math.random() * 50) + 5) * 100 * 100
    const type = Math.random() > 0.3 ? 'expense' : 'income'
    const ts = new Date(Date.now() - i * 1000)

    await sql`
      INSERT INTO movements (id, space_id, created_by_user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
      VALUES (${id}, ${spaceId}, ${userId}, ${accountId}, ${name}, ${dateStr}, ${amount}, ${type}, false, 'CLP', false, false, ${ts}, ${ts})
    `
  }
}

export async function seedUnlinkedIncome(userId: string, accountId: string | null, name: string, amount: number): Promise<string> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const id = testId('income')
  const spaceId = await getPersonalSpaceId(userId)
  await sql`
    INSERT INTO movements (id, space_id, created_by_user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (${id}, ${spaceId}, ${userId}, ${accountId}, ${name}, ${today}, ${amount}, 'income', false, 'CLP', false, false, ${now}, ${now})
  `
  return id
}

export async function seedUsdToClpRate(rate: number = 95050): Promise<void> {
  const now = new Date()
  const id = testId('e2e-usd-clp')
  await sql`
    INSERT INTO exchange_rates (id, from_currency, to_currency, rate, source, fetched_at)
    VALUES (${id}, 'USD', 'CLP', ${rate}, 'e2e', ${now})
  `
}

/** Gracefully close the shared connection pool. Call in afterAll/globalTeardown. */
export async function closePool() {
  await sql.end()
}
