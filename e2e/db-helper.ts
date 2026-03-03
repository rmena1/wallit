import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/wallit'

function getClient() {
  return postgres(DATABASE_URL, { max: 1 })
}

export async function getUserId(email: string): Promise<string | null> {
  const sql = getClient()
  try {
    const rows = await sql`SELECT id FROM users WHERE email = ${email}`
    return rows[0]?.id ?? null
  } finally {
    await sql.end()
  }
}

export async function getFirstAccountId(userId: string): Promise<string | null> {
  const sql = getClient()
  try {
    const rows = await sql`SELECT id FROM accounts WHERE user_id = ${userId}`
    return rows[0]?.id ?? null
  } finally {
    await sql.end()
  }
}

export async function getAccounts(userId: string): Promise<{ id: string; bank_name: string }[]> {
  const sql = getClient()
  try {
    const rows = await sql`SELECT id, bank_name FROM accounts WHERE user_id = ${userId}`
    return rows as { id: string; bank_name: string }[]
  } finally {
    await sql.end()
  }
}

export async function createAccount(userId: string): Promise<string> {
  const sql = getClient()
  try {
    const now = new Date()
    const id = `acc-${Date.now()}`
    await sql`
      INSERT INTO accounts (id, user_id, bank_name, account_type, last_four_digits, initial_balance, currency, created_at, updated_at)
      VALUES (${id}, ${userId}, 'BCI', 'Corriente', '9999', 100000000, 'CLP', ${now}, ${now})
    `
    return id
  } finally {
    await sql.end()
  }
}

export async function seedReviewMovements(userId: string, accountId: string | null) {
  const sql = getClient()
  try {
    const today = new Date().toISOString().slice(0, 10)
    const base = Date.now()

    const movements = [
      { id: `rev-${base}-3`, name: 'Compra Supermercado', amount: 4520000, type: 'expense', ts: new Date(base - 2000) },
      { id: `rev-${base}-2`, name: 'Transferencia recibida', amount: 5000000, type: 'income', ts: new Date(base - 1000) },
      { id: `rev-${base}-1`, name: 'Uber Eats - Pizza', amount: 1500000, type: 'expense', ts: new Date(base) },
    ]

    for (const m of movements) {
      await sql`
        INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
        VALUES (${m.id}, ${userId}, ${accountId}, ${m.name}, ${today}, ${m.amount}, ${m.type}, true, 'CLP', false, false, ${m.ts}, ${m.ts})
      `
    }
  } finally {
    await sql.end()
  }
}

export async function seedReviewMovement(userId: string, accountId: string | null, name: string, amount: number): Promise<string> {
  const sql = getClient()
  try {
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const id = `rev-adv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    await sql`
      INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
      VALUES (${id}, ${userId}, ${accountId}, ${name}, ${today}, ${amount}, 'expense', true, 'CLP', false, false, ${now}, ${now})
    `
    return id
  } finally {
    await sql.end()
  }
}

export async function seedConfirmedMovement(userId: string, accountId: string | null, name: string, amount: number): Promise<string> {
  const sql = getClient()
  try {
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const id = `mov-convert-${Date.now()}`
    await sql`
      INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
      VALUES (${id}, ${userId}, ${accountId}, ${name}, ${today}, ${amount}, 'expense', false, 'CLP', false, false, ${now}, ${now})
    `
    return id
  } finally {
    await sql.end()
  }
}

export async function seedReceivable(userId: string, accountId: string | null, name: string, amount: number): Promise<string> {
  const sql = getClient()
  try {
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const id = `recv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    await sql`
      INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
      VALUES (${id}, ${userId}, ${accountId}, ${name}, ${today}, ${amount}, 'expense', false, 'CLP', true, false, ${now}, ${now})
    `
    return id
  } finally {
    await sql.end()
  }
}

export async function seedManyMovements(userId: string, accountId: string, count: number) {
  const sql = getClient()
  try {
    const today = new Date()

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
        INSERT INTO movements (id, user_id, account_id, name, date, amount, type, needs_review, currency, receivable, received, created_at, updated_at)
        VALUES (${id}, ${userId}, ${accountId}, ${name}, ${dateStr}, ${amount}, ${type}, false, 'CLP', false, false, ${ts}, ${ts})
      `
    }
  } finally {
    await sql.end()
  }
}
