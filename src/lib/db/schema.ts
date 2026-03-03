import { pgTable, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core'

// ============================================================================
// USERS
// ============================================================================
export const users = pgTable('users', {
  id: text('id').primaryKey(), // nanoid
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

// ============================================================================
// SESSIONS
// ============================================================================
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // session token
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_sessions_user').on(table.userId),
  index('idx_sessions_expires').on(table.expiresAt),
])

// ============================================================================
// CATEGORIES
// ============================================================================
export const categories = pgTable('categories', {
  id: text('id').primaryKey(), // nanoid
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  emoji: text('emoji').notNull(),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_categories_user').on(table.userId),
])

// ============================================================================
// ACCOUNTS
// ============================================================================
export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(), // nanoid
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bankName: text('bank_name').notNull(),
  accountType: text('account_type').notNull(),
  lastFourDigits: text('last_four_digits').notNull(),
  initialBalance: integer('initial_balance').notNull().default(0), // cents
  currency: text('currency').$type<'CLP' | 'USD'>().notNull().default('CLP'),
  color: text('color'), // hex color like "#4F46E5"
  emoji: text('emoji'), // emoji character like "💳"
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_accounts_user').on(table.userId),
])

// ============================================================================
// MOVEMENTS
// ============================================================================
export const movements = pgTable('movements', {
  id: text('id').primaryKey(), // nanoid
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  amount: integer('amount').notNull(), // cents (integer) — always in CLP
  type: text('type').$type<'income' | 'expense'>().notNull(),
  needsReview: boolean('needs_review').notNull().default(false),
  currency: text('currency').$type<'CLP' | 'USD'>().notNull().default('CLP'),
  amountUsd: integer('amount_usd'), // cents, only for USD movements
  exchangeRate: integer('exchange_rate'), // rate * 100 (e.g. 950.50 → 95050)
  receivable: boolean('receivable').notNull().default(false),
  received: boolean('received').notNull().default(false),
  receivableId: text('receivable_id'), // links income payment to original receivable expense
  time: text('time'), // HH:MM format, nullable
  originalName: text('original_name'), // original name from bank email
  // Transfer fields: link two movements as a transfer pair
  transferId: text('transfer_id'), // shared ID between both movements of a transfer (nanoid)
  transferPairId: text('transfer_pair_id'), // ID of the paired movement
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_movements_user').on(table.userId),
  index('idx_movements_date').on(table.userId, table.date),
  index('idx_movements_category').on(table.categoryId),
  index('idx_movements_account').on(table.accountId),
  index('idx_movements_review').on(table.userId, table.needsReview),
  index('idx_movements_transfer').on(table.transferId),
])

// ============================================================================
// EXCHANGE RATES
// ============================================================================
export const exchangeRates = pgTable('exchange_rates', {
  id: text('id').primaryKey(), // nanoid
  fromCurrency: text('from_currency').notNull(),
  toCurrency: text('to_currency').notNull(),
  rate: integer('rate').notNull(), // rate * 100 (e.g. 950.50 → 95050)
  source: text('source').notNull(),
  fetchedAt: timestamp('fetched_at').notNull().$defaultFn(() => new Date()),
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
