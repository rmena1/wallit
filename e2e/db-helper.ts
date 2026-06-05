import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://127.0.0.1:5432/wallit_e2e'

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

export async function createSpaceForUser(userId: string, name: string, emoji = '🏠'): Promise<string> {
  const now = new Date()
  const id = testId('sp')
  const normalized = name.trim().toLowerCase()
  await sql`
    INSERT INTO spaces (id, name, normalized_name, emoji, is_personal, created_by_user_id, created_at, updated_at)
    VALUES (${id}, ${name.trim()}, ${normalized}, ${emoji}, false, ${userId}, ${now}, ${now})
  `
  await sql`
    INSERT INTO space_memberships (id, space_id, user_id, role, created_at)
    VALUES (${testId('sm')}, ${id}, ${userId}, 'owner', ${now})
  `
  return id
}

export async function addUserToSpace(userId: string, spaceId: string, role: 'owner' | 'member' = 'member'): Promise<void> {
  const now = new Date()
  await sql`
    INSERT INTO space_memberships (id, space_id, user_id, role, created_at)
    VALUES (${testId('sm')}, ${spaceId}, ${userId}, ${role}, ${now})
    ON CONFLICT DO NOTHING
  `
}

export async function removeUserFromSpace(userId: string, spaceId: string): Promise<void> {
  await sql`DELETE FROM space_memberships WHERE user_id = ${userId} AND space_id = ${spaceId}`
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

export async function getClpAccountBalance(accountId: string): Promise<number> {
  const rows = await sql`
    SELECT
      a.initial_balance
        + COALESCE(SUM(CASE WHEN m.type = 'income' THEN m.amount ELSE -m.amount END), 0) AS balance
    FROM accounts a
    LEFT JOIN movements m ON m.account_id = a.id AND m.needs_review = false
    WHERE a.id = ${accountId}
    GROUP BY a.id, a.initial_balance
    LIMIT 1
  `
  return Number(rows[0]?.balance ?? 0)
}

export async function countMovementsInSpace(spaceId: string, nameLike: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM movements
    WHERE space_id = ${spaceId}
      AND name ILIKE ${`%${nameLike}%`}
  `
  return Number(rows[0]?.count ?? 0)
}

export async function getReportTotalsForSpace(spaceId: string): Promise<{ totalIncome: number; totalExpense: number; count: number }> {
  const rows = await sql`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)::bigint AS total_income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)::bigint AS total_expense,
      COUNT(*)::int AS count
    FROM movements m
    WHERE m.space_id = ${spaceId}
      AND m.needs_review = false
      AND (m.receivable = false OR m.receivable IS NULL)
      AND m.receivable_id IS NULL
      AND (m.emergency = false OR m.emergency IS NULL)
      AND (m.loan = false OR m.loan IS NULL)
      AND m.loan_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM transfers t
        WHERE t.source_movement_id = m.id OR t.destination_movement_id = m.id
      )
  `
  return {
    totalIncome: Number(rows[0]?.total_income ?? 0),
    totalExpense: Number(rows[0]?.total_expense ?? 0),
    count: Number(rows[0]?.count ?? 0),
  }
}

export async function getMovementWorkflowState(spaceId: string, nameLike: string): Promise<{
  id: string
  accountId: string | null
  amount: number
  type: 'income' | 'expense'
  needsReview: boolean
  receivableId: string | null
  receivableSettlementRole: 'receivable' | 'outgoing' | 'incoming' | null
} | null> {
  const rows = await sql`
    SELECT
      m.id,
      m.account_id,
      m.amount,
      m.type,
      m.needs_review,
      m.receivable_id,
      CASE
        WHEN rs.receivable_id = m.id THEN 'receivable'
        WHEN rs.outgoing_movement_id = m.id THEN 'outgoing'
        WHEN rs.incoming_movement_id = m.id THEN 'incoming'
        ELSE NULL
      END AS receivable_settlement_role
    FROM movements m
    LEFT JOIN receivable_settlements rs
      ON rs.receivable_id = m.id
      OR rs.outgoing_movement_id = m.id
      OR rs.incoming_movement_id = m.id
    WHERE m.space_id = ${spaceId}
      AND m.name ILIKE ${`%${nameLike}%`}
    ORDER BY m.created_at DESC
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    accountId: row.account_id ?? null,
    amount: Number(row.amount),
    type: row.type,
    needsReview: Boolean(row.needs_review),
    receivableId: row.receivable_id ?? null,
    receivableSettlementRole: row.receivable_settlement_role ?? null,
  }
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
  const pairId = testId('tr-pair')
  const transferId = opts.transferId ?? testId('transfer')
  const spaceId = await resolveSpaceId(userId, opts.spaceId)
  const pairAccountId = await createRegularAccount(userId, {
    bankName: 'Transfer Pair',
    lastFourDigits: Math.floor(1000 + Math.random() * 9000).toString(),
    initialBalance: 0,
    spaceId,
  })
  const pairType = opts.type === 'expense' ? 'income' : 'expense'

  await sql`
    INSERT INTO movements (
      id, space_id, created_by_user_id, account_id, name, date, amount, type,
      needs_review, currency, receivable, received,
      created_at, updated_at
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
      ${createdAt},
      ${createdAt}
    )
  `

  await sql`
    INSERT INTO movements (
      id, space_id, created_by_user_id, account_id, name, date, amount, type,
      needs_review, currency, receivable, received,
      created_at, updated_at
    )
    VALUES (
      ${pairId},
      ${spaceId},
      ${userId},
      ${pairAccountId},
      ${opts.name ?? 'Contraparte transferencia inversión'},
      ${opts.date},
      ${opts.amount},
      ${pairType},
      false,
      'CLP',
      false,
      false,
      ${createdAt},
      ${createdAt}
    )
  `

  await sql`
    INSERT INTO transfers (id, source_space_id, destination_space_id, source_movement_id, destination_movement_id, created_by_user_id, created_at, updated_at)
    VALUES (${transferId}, ${spaceId}, ${spaceId}, ${opts.type === 'expense' ? id : pairId}, ${opts.type === 'income' ? id : pairId}, ${userId}, ${createdAt}, ${createdAt})
  `
}

export async function seedPendingTransfer(userId: string, sourceAccountId: string, destinationAccountId: string, opts: {
  name?: string
  amount: number
  date?: string
  spaceId?: string
}): Promise<{ transferId: string; sourceMovementId: string; destinationMovementId: string }> {
  const now = new Date()
  const date = opts.date ?? now.toISOString().slice(0, 10)
  const spaceId = await resolveSpaceId(userId, opts.spaceId)
  const transferId = testId('pending-transfer')
  const sourceMovementId = testId('pending-transfer-source')
  const destinationMovementId = testId('pending-transfer-dest')
  const name = opts.name ?? 'Transferencia pendiente'

  await sql`
    INSERT INTO movements (
      id, space_id, created_by_user_id, account_id, name, date, amount, type,
      needs_review, currency, receivable, received, created_at, updated_at
    )
    VALUES
      (${sourceMovementId}, ${spaceId}, ${userId}, ${sourceAccountId}, ${`${name} salida`}, ${date}, ${opts.amount}, 'expense', true, 'CLP', false, false, ${now}, ${now}),
      (${destinationMovementId}, ${spaceId}, ${userId}, ${destinationAccountId}, ${`${name} entrada`}, ${date}, ${opts.amount}, 'income', true, 'CLP', false, false, ${now}, ${now})
  `

  await sql`
    INSERT INTO transfers (id, source_space_id, destination_space_id, source_movement_id, destination_movement_id, created_by_user_id, created_at, updated_at)
    VALUES (${transferId}, ${spaceId}, ${spaceId}, ${sourceMovementId}, ${destinationMovementId}, ${userId}, ${now}, ${now})
  `

  return { transferId, sourceMovementId, destinationMovementId }
}

export async function markMovementReviewed(movementId: string): Promise<void> {
  await sql`
    UPDATE movements
    SET needs_review = false, updated_at = ${new Date()}
    WHERE id = ${movementId}
  `
}

export async function getPendingTransferState(transferId: string): Promise<{
  transferExists: boolean
  movementCount: number
  pendingCount: number
} | null> {
  const rows = await sql`
    SELECT
      EXISTS (SELECT 1 FROM transfers WHERE id = ${transferId}) AS transfer_exists,
      COUNT(m.id)::int AS movement_count,
      COUNT(*) FILTER (WHERE m.needs_review = true)::int AS pending_count
    FROM transfers t
    RIGHT JOIN movements m ON m.id IN (t.source_movement_id, t.destination_movement_id)
    WHERE t.id = ${transferId}
  `
  const row = rows[0]
  if (!row) return null
  return {
    transferExists: Boolean(row.transfer_exists),
    movementCount: Number(row.movement_count ?? 0),
    pendingCount: Number(row.pending_count ?? 0),
  }
}

export async function countTransferAndMovementRows(transferId: string, movementIds: string[]): Promise<{ transfers: number; movements: number }> {
  const rows = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM transfers WHERE id = ${transferId}) AS transfers,
      (SELECT COUNT(*)::int FROM movements WHERE id IN ${sql(movementIds)}) AS movements
  `
  return {
    transfers: Number(rows[0]?.transfers ?? 0),
    movements: Number(rows[0]?.movements ?? 0),
  }
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

export async function getEmergencyPaymentTransferInfo(emergencyId: string): Promise<{
  transferId: string
  sourceMovementId: string
  destinationMovementId: string
} | null> {
  const rows = await sql`
    SELECT ep.transfer_id, t.source_movement_id, t.destination_movement_id
    FROM emergency_payments ep
    INNER JOIN transfers t ON t.id = ep.transfer_id
    WHERE ep.emergency_id = ${emergencyId}
    ORDER BY ep.created_at DESC
    LIMIT 1
  `
  const row = rows[0]
  if (!row?.transfer_id) return null
  return {
    transferId: row.transfer_id,
    sourceMovementId: row.source_movement_id,
    destinationMovementId: row.destination_movement_id,
  }
}

export async function transferAndEmergencyPaymentStillLinked(transferId: string): Promise<boolean> {
  const rows = await sql`
    SELECT
      EXISTS (SELECT 1 FROM transfers WHERE id = ${transferId}) AS transfer_exists,
      EXISTS (SELECT 1 FROM emergency_payments WHERE transfer_id = ${transferId}) AS payment_exists
  `
  return Boolean(rows[0]?.transfer_exists && rows[0]?.payment_exists)
}

export async function getTransferMovementAmounts(transferId: string): Promise<{ sourceAmount: number; destinationAmount: number; sourceAmountUsd: number | null; destinationAmountUsd: number | null } | null> {
  const rows = await sql`
    SELECT
      source.amount AS source_amount,
      destination.amount AS destination_amount,
      source.amount_usd AS source_amount_usd,
      destination.amount_usd AS destination_amount_usd
    FROM transfers t
    INNER JOIN movements source ON source.id = t.source_movement_id
    INNER JOIN movements destination ON destination.id = t.destination_movement_id
    WHERE t.id = ${transferId}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return null
  return {
    sourceAmount: Number(row.source_amount),
    destinationAmount: Number(row.destination_amount),
    sourceAmountUsd: row.source_amount_usd == null ? null : Number(row.source_amount_usd),
    destinationAmountUsd: row.destination_amount_usd == null ? null : Number(row.destination_amount_usd),
  }
}

export async function getTransferIdForMovement(movementId: string): Promise<string | null> {
  const rows = await sql`
    SELECT id
    FROM transfers
    WHERE source_movement_id = ${movementId}
       OR destination_movement_id = ${movementId}
    LIMIT 1
  `
  return rows[0]?.id ?? null
}

export async function getMovementReviewState(movementId: string): Promise<{
  type: 'income' | 'expense'
  category_id: string | null
  needs_review: boolean
} | null> {
  const rows = await sql`
    SELECT type, category_id, needs_review
    FROM movements
    WHERE id = ${movementId}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return null
  return {
    type: row.type as 'income' | 'expense',
    category_id: row.category_id ?? null,
    needs_review: Boolean(row.needs_review),
  }
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

export async function seedReceivable(userId: string, accountId: string | null, name: string, amount: number, spaceIdOverride?: string): Promise<string> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const id = testId('recv')
  const spaceId = await resolveSpaceId(userId, spaceIdOverride)
  await sql`
    INSERT INTO movements (id, space_id, created_by_user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
    VALUES (${id}, ${spaceId}, ${userId}, ${accountId}, ${name}, ${today}, ${amount}, 'expense', false, 'CLP', true, false, ${now}, ${now})
  `
  return id
}

export async function seedInterspaceTransfer(userId: string, opts: {
  sourceSpaceId: string
  destinationSpaceId: string
  sourceAccountId: string
  destinationAccountId: string
  amount: number
  note?: string
  date?: string
}): Promise<{ transferId: string; sourceMovementId: string; destinationMovementId: string }> {
  const now = new Date()
  const date = opts.date ?? now.toISOString().slice(0, 10)
  const transferId = testId('transfer')
  const sourceMovementId = testId('transfer-source')
  const destinationMovementId = testId('transfer-dest')
  const note = opts.note ? ` · ${opts.note}` : ''

  const sourceSpaceRows = await sql`SELECT name FROM spaces WHERE id = ${opts.sourceSpaceId} LIMIT 1`
  const destinationSpaceRows = await sql`SELECT name FROM spaces WHERE id = ${opts.destinationSpaceId} LIMIT 1`
  const sourceSpaceName = sourceSpaceRows[0]?.name ?? 'Origen'
  const destinationSpaceName = destinationSpaceRows[0]?.name ?? 'Destino'

  await sql`
    INSERT INTO movements (
      id, space_id, created_by_user_id, account_id, name, date, amount, type,
      needs_review, currency, receivable, received, created_at, updated_at
    )
    VALUES
      (${sourceMovementId}, ${opts.sourceSpaceId}, ${userId}, ${opts.sourceAccountId}, ${`Transferencia a ${destinationSpaceName}${note}`}, ${date}, ${opts.amount}, 'expense', false, 'CLP', false, false, ${now}, ${now}),
      (${destinationMovementId}, ${opts.destinationSpaceId}, ${userId}, ${opts.destinationAccountId}, ${`Transferencia desde ${sourceSpaceName}${note}`}, ${date}, ${opts.amount}, 'income', false, 'CLP', false, false, ${now}, ${now})
  `

  await sql`
    INSERT INTO transfers (
      id, source_space_id, destination_space_id, source_movement_id, destination_movement_id,
      created_by_user_id, created_at, updated_at
    )
    VALUES (
      ${transferId}, ${opts.sourceSpaceId}, ${opts.destinationSpaceId}, ${sourceMovementId}, ${destinationMovementId},
      ${userId}, ${now}, ${now}
    )
  `

  return { transferId, sourceMovementId, destinationMovementId }
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
