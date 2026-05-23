import { pgTable, text, integer, bigint, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'

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
// SPACES
// ============================================================================
export const spaces = pgTable('spaces', {
  id: text('id').primaryKey(), // nanoid
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  emoji: text('emoji').notNull(),
  isPersonal: boolean('is_personal').notNull().default(false),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  archivedAt: timestamp('archived_at'),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_spaces_created_by').on(table.createdByUserId),
  index('idx_spaces_normalized_name').on(table.normalizedName),
  index('idx_spaces_archived').on(table.archivedAt),
])

export const spaceMemberships = pgTable('space_memberships', {
  id: text('id').primaryKey(), // nanoid
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<'owner' | 'member'>().notNull(),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_space_memberships_space').on(table.spaceId),
  index('idx_space_memberships_user').on(table.userId),
  uniqueIndex('idx_space_memberships_space_user').on(table.spaceId, table.userId),
])

// ============================================================================
// CATEGORIES
// ============================================================================
export const categories = pgTable('categories', {
  id: text('id').primaryKey(), // nanoid
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  emoji: text('emoji').notNull(),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_categories_space').on(table.spaceId),
])

// ============================================================================
// ACCOUNTS
// ============================================================================
export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(), // nanoid
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  bankName: text('bank_name').notNull(),
  accountType: text('account_type').notNull(),
  lastFourDigits: text('last_four_digits').notNull(),
  initialBalance: integer('initial_balance').notNull().default(0), // cents
  currency: text('currency').$type<'CLP' | 'USD'>().notNull().default('CLP'),
  color: text('color'), // hex color like "#4F46E5"
  emoji: text('emoji'), // emoji character like "💳"
  isInvestment: boolean('is_investment').notNull().default(false),
  currentValue: integer('current_value'),
  currentValueUpdatedAt: timestamp('current_value_updated_at'),
  creditLimit: integer('credit_limit'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_accounts_space').on(table.spaceId),
  index('idx_accounts_space_sort').on(table.spaceId, table.sortOrder),
])

// ============================================================================
// INVESTMENT SNAPSHOTS
// ============================================================================
export const investmentSnapshots = pgTable('investment_snapshots', {
  id: text('id').primaryKey(), // nanoid
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  value: integer('value').notNull(), // cents
  date: text('date').notNull(), // YYYY-MM-DD
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_snapshots_account').on(table.accountId),
  index('idx_snapshots_space').on(table.spaceId),
])

// ============================================================================
// MOVEMENTS
// ============================================================================
export const movements = pgTable('movements', {
  id: text('id').primaryKey(), // nanoid
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  amount: bigint('amount', { mode: 'number' }).notNull(), // cents — always in CLP
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
  // Emergency expense fields
  emergency: boolean('emergency').notNull().default(false),
  emergencySettled: boolean('emergency_settled').notNull().default(false),
  // Loan income fields
  loan: boolean('loan').notNull().default(false),
  loanSettled: boolean('loan_settled').notNull().default(false),
  loanId: text('loan_id'), // links payback expense to original loan income
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_movements_space').on(table.spaceId),
  index('idx_movements_date').on(table.spaceId, table.date),
  index('idx_movements_category').on(table.categoryId),
  index('idx_movements_account').on(table.accountId),
  index('idx_movements_review').on(table.spaceId, table.needsReview),
])

// ============================================================================
// TRANSFERS
// ============================================================================
export const transfers = pgTable('transfers', {
  id: text('id').primaryKey(), // nanoid
  sourceSpaceId: text('source_space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  destinationSpaceId: text('destination_space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  sourceMovementId: text('source_movement_id').notNull().references(() => movements.id, { onDelete: 'cascade' }),
  destinationMovementId: text('destination_movement_id').notNull().references(() => movements.id, { onDelete: 'cascade' }),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_transfers_source_space').on(table.sourceSpaceId),
  index('idx_transfers_destination_space').on(table.destinationSpaceId),
  uniqueIndex('idx_transfers_source_movement').on(table.sourceMovementId),
  uniqueIndex('idx_transfers_destination_movement').on(table.destinationMovementId),
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
// EMERGENCY PAYMENTS
// ============================================================================
export const emergencyPayments = pgTable('emergency_payments', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  emergencyId: text('emergency_id').notNull().references(() => movements.id, { onDelete: 'cascade' }),
  fromAccountId: text('from_account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  toAccountId: text('to_account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(), // cents
  date: text('date').notNull(), // YYYY-MM-DD
  transferId: text('transfer_id'), // links to transfer movements created (nullable)
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_emergency_payments_emergency').on(table.emergencyId),
  index('idx_emergency_payments_space').on(table.spaceId),
  index('idx_emergency_payments_space_emergency').on(table.spaceId, table.emergencyId),
  index('idx_emergency_payments_transfer').on(table.transferId),
])

// ============================================================================
// TYPES
// ============================================================================
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert

export type Space = typeof spaces.$inferSelect
export type NewSpace = typeof spaces.$inferInsert

export type SpaceMembership = typeof spaceMemberships.$inferSelect
export type NewSpaceMembership = typeof spaceMemberships.$inferInsert

export type Category = typeof categories.$inferSelect
export type NewCategory = typeof categories.$inferInsert

export type Account = typeof accounts.$inferSelect
export type NewAccount = typeof accounts.$inferInsert

export type InvestmentSnapshot = typeof investmentSnapshots.$inferSelect
export type NewInvestmentSnapshot = typeof investmentSnapshots.$inferInsert

export type Movement = typeof movements.$inferSelect
export type NewMovement = typeof movements.$inferInsert

export type Transfer = typeof transfers.$inferSelect
export type NewTransfer = typeof transfers.$inferInsert

export type ExchangeRate = typeof exchangeRates.$inferSelect
export type NewExchangeRate = typeof exchangeRates.$inferInsert

export type EmergencyPayment = typeof emergencyPayments.$inferSelect
export type NewEmergencyPayment = typeof emergencyPayments.$inferInsert
