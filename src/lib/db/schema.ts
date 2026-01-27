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
  amount: integer('amount').notNull(), // cents (integer)
  type: text('type', { enum: ['income', 'expense'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_movements_user').on(table.userId),
  index('idx_movements_date').on(table.userId, table.date),
  index('idx_movements_category').on(table.categoryId),
  index('idx_movements_account').on(table.accountId),
])

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
