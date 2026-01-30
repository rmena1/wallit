import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// ============================================================================
// USERS
// ============================================================================
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // nanoid
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// ============================================================================
// SESSIONS
// ============================================================================
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // session token
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_sessions_user').on(table.userId),
  index('idx_sessions_expires').on(table.expiresAt),
])

// ============================================================================
// CATEGORIES
// ============================================================================
export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(), // nanoid
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  emoji: text('emoji').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_categories_user').on(table.userId),
])

// ============================================================================
// ACCOUNTS
// ============================================================================
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(), // nanoid
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bankName: text('bank_name').notNull(),
  accountType: text('account_type').notNull(),
  lastFourDigits: text('last_four_digits').notNull(),
  initialBalance: integer('initial_balance').notNull().default(0), // cents
  currency: text('currency', { enum: ['CLP', 'USD'] }).notNull().default('CLP'),
  color: text('color'), // hex color like "#4F46E5"
  emoji: text('emoji'), // emoji character like "💳"
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_accounts_user').on(table.userId),
])

// ============================================================================
// MOVEMENTS
// ============================================================================
export const movements = sqliteTable('movements', {
  id: text('id').primaryKey(), // nanoid
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  amount: integer('amount').notNull(), // cents (integer) — always in CLP
  type: text('type', { enum: ['income', 'expense'] }).notNull(),
  needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(false),
  currency: text('currency', { enum: ['CLP', 'USD'] }).notNull().default('CLP'),
  amountUsd: integer('amount_usd'), // cents, only for USD movements
  exchangeRate: integer('exchange_rate'), // rate * 100 (e.g. 950.50 → 95050)
  receivable: integer('receivable', { mode: 'boolean' }).notNull().default(false),
  received: integer('received', { mode: 'boolean' }).notNull().default(false),
  receivableId: text('receivable_id'), // links income payment to original receivable expense
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_movements_user').on(table.userId),
  index('idx_movements_date').on(table.userId, table.date),
  index('idx_movements_category').on(table.categoryId),
  index('idx_movements_account').on(table.accountId),
])

// ============================================================================
// EXCHANGE RATES
// ============================================================================
export const exchangeRates = sqliteTable('exchange_rates', {
  id: text('id').primaryKey(), // nanoid
  fromCurrency: text('from_currency').notNull(),
  toCurrency: text('to_currency').notNull(),
  rate: integer('rate').notNull(), // rate * 100 (e.g. 950.50 → 95050)
  source: text('source').notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// ============================================================================
// TYPES
// ============================================================================
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert

export type Category = typeof categories.$inferSelect
export type NewCategory = typeof categories.$inferInsert

export type Account = typeof accounts.$inferSelect
export type NewAccount = typeof accounts.$inferInsert

export type Movement = typeof movements.$inferSelect
export type NewMovement = typeof movements.$inferInsert

export type ExchangeRate = typeof exchangeRates.$inferSelect
export type NewExchangeRate = typeof exchangeRates.$inferInsert
