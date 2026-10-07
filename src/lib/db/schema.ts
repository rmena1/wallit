import { pgTable, text, integer, bigint, boolean, timestamp, index, uniqueIndex, check, jsonb } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

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

// MCP credentials are opaque, independently expiring, and stored only as hashes.
export const mcpClients = pgTable('mcp_clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
export const mcpGrants = pgTable('mcp_grants', {
  id: text('id').primaryKey(),
  consentHash: text('consent_hash').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => mcpClients.id),
  scopes: jsonb('scopes').$type<string[]>().notNull(),
  spaceIds: jsonb('space_ids').$type<string[] | null>(), // null: all current/future memberships
  resource: text('resource').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, table => [index('idx_mcp_grants_user').on(table.userId)])
export const mcpCodes = pgTable('mcp_codes', {
  hash: text('hash').primaryKey(),
  grantId: text('grant_id').notNull().references(() => mcpGrants.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  challenge: text('challenge').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
})
export const mcpTokens = pgTable('mcp_tokens', {
  hash: text('hash').primaryKey(),
  grantId: text('grant_id').notNull().references(() => mcpGrants.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'access' | 'refresh'>().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
}, table => [index('idx_mcp_tokens_grant').on(table.grantId)])
export const mcpOperations = pgTable('mcp_operations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  grantId: text('grant_id').notNull().references(() => mcpGrants.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  fingerprint: text('fingerprint').notNull(),
  tool: text('tool').notNull(),
  spaceId: text('space_id').notNull(),
  arguments: jsonb('arguments').$type<Record<string, unknown>>().notNull(),
  result: jsonb('result').$type<unknown>().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, table => [uniqueIndex('idx_mcp_operations_user_key').on(table.userId, table.key)])

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
  reportable: boolean('reportable').notNull().default(true),
  currency: text('currency').$type<'CLP' | 'USD'>().notNull().default('CLP'),
  amountUsd: integer('amount_usd'), // cents, only for USD movements
  exchangeRate: integer('exchange_rate'), // rate * 100 (e.g. 950.50 → 95050)
  receivable: boolean('receivable').notNull().default(false),
  received: boolean('received').notNull().default(false),
  receivableId: text('receivable_id'), // links income payment to original receivable expense
  time: text('time'), // HH:MM format, nullable
  originalName: text('original_name'), // original name from bank email
  sourceEmailProvider: text('source_email_provider'), // importing bank/provider, only for email imports
  sourceEmailId: text('source_email_id'), // normalized RFC Message-ID for retry-safe imports
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
  index('idx_movements_reportable').on(table.spaceId, table.reportable),
  index('idx_movements_category_history').on(table.createdByUserId, table.originalName)
    .where(sql`${table.categoryId} IS NOT NULL`),
  uniqueIndex('idx_movements_source_email')
    .on(table.createdByUserId, table.sourceEmailProvider, table.sourceEmailId)
    .where(sql`${table.sourceEmailId} IS NOT NULL`),
  check('movements_usd_money_consistency', sql`
    ${table.currency} <> 'USD'
    OR (
      ${table.amount} > 0
      AND ${table.amountUsd} IS NOT NULL AND ${table.amountUsd} > 0
      AND ${table.exchangeRate} IS NOT NULL AND ${table.exchangeRate} > 0
      AND ABS(${table.amount}::numeric - ROUND(${table.amountUsd}::numeric * ${table.exchangeRate}::numeric / 100)) <= 1000
    )
  `),
  check('movements_source_email_identity_complete', sql`
    (${table.sourceEmailProvider} IS NULL AND ${table.sourceEmailId} IS NULL)
    OR (
      ${table.createdByUserId} IS NOT NULL
      AND ${table.sourceEmailProvider} IS NOT NULL
      AND ${table.sourceEmailProvider} = LOWER(BTRIM(${table.sourceEmailProvider}))
      AND LENGTH(${table.sourceEmailProvider}) > 0
      AND ${table.sourceEmailId} IS NOT NULL
      AND ${table.sourceEmailId} = BTRIM(${table.sourceEmailId})
      AND LENGTH(${table.sourceEmailId}) > 0
    )
  `),
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
// RECEIVABLE SETTLEMENTS
// ============================================================================
export const receivableSettlements = pgTable('receivable_settlements', {
  id: text('id').primaryKey(),
  fundedSpaceId: text('funded_space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  payingSpaceId: text('paying_space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  receivableId: text('receivable_id').notNull().references(() => movements.id, { onDelete: 'cascade' }),
  outgoingMovementId: text('outgoing_movement_id').notNull().references(() => movements.id, { onDelete: 'cascade' }),
  incomingMovementId: text('incoming_movement_id').notNull().references(() => movements.id, { onDelete: 'cascade' }),
  consumedTransferId: text('consumed_transfer_id'),
  consumedTransferSourceSpaceId: text('consumed_transfer_source_space_id'),
  consumedTransferDestinationSpaceId: text('consumed_transfer_destination_space_id'),
  consumedTransferSourceAccountId: text('consumed_transfer_source_account_id'),
  consumedTransferDestinationAccountId: text('consumed_transfer_destination_account_id'),
  consumedTransferSourceCategoryId: text('consumed_transfer_source_category_id'),
  consumedTransferDestinationCategoryId: text('consumed_transfer_destination_category_id'),
  consumedTransferSourceReportable: boolean('consumed_transfer_source_reportable'),
  consumedTransferDestinationReportable: boolean('consumed_transfer_destination_reportable'),
  consumedTransferSourceReceivable: boolean('consumed_transfer_source_receivable'),
  consumedTransferDestinationReceivable: boolean('consumed_transfer_destination_receivable'),
  consumedTransferSourceName: text('consumed_transfer_source_name'),
  consumedTransferDestinationName: text('consumed_transfer_destination_name'),
  consumedTransferDate: text('consumed_transfer_date'),
  consumedTransferSourceTime: text('consumed_transfer_source_time'),
  consumedTransferDestinationTime: text('consumed_transfer_destination_time'),
  consumedSourceAmount: bigint('consumed_source_amount', { mode: 'number' }),
  consumedSourceCurrency: text('consumed_source_currency').$type<'CLP' | 'USD'>(),
  consumedSourceAmountUsd: integer('consumed_source_amount_usd'),
  consumedSourceExchangeRate: integer('consumed_source_exchange_rate'),
  consumedDestinationAmount: bigint('consumed_destination_amount', { mode: 'number' }),
  consumedDestinationCurrency: text('consumed_destination_currency').$type<'CLP' | 'USD'>(),
  consumedDestinationAmountUsd: integer('consumed_destination_amount_usd'),
  consumedDestinationExchangeRate: integer('consumed_destination_exchange_rate'),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_receivable_settlements_funded_space').on(table.fundedSpaceId),
  index('idx_receivable_settlements_paying_space').on(table.payingSpaceId),
  uniqueIndex('idx_receivable_settlements_receivable').on(table.receivableId),
  uniqueIndex('idx_receivable_settlements_outgoing').on(table.outgoingMovementId),
  uniqueIndex('idx_receivable_settlements_incoming').on(table.incomingMovementId),
  index('idx_receivable_settlements_consumed_transfer').on(table.consumedTransferId),
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

export type ReceivableSettlement = typeof receivableSettlements.$inferSelect
export type NewReceivableSettlement = typeof receivableSettlements.$inferInsert

export type ExchangeRate = typeof exchangeRates.$inferSelect
export type NewExchangeRate = typeof exchangeRates.$inferInsert

export type EmergencyPayment = typeof emergencyPayments.$inferSelect
export type NewEmergencyPayment = typeof emergencyPayments.$inferInsert

// Bank transfer evidence is retained even when an endpoint has no Wallit account.
// Pending imports create no income/expense and do not invent an account or Space.
export const ownBankTransferImports = pgTable('own_bank_transfer_imports', {
  id: text('id').primaryKey(),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  operationKey: text('operation_key').notNull(),
  date: text('date').notNull(),
  time: text('time'),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('CLP'),
  fromBank: text('from_bank').notNull(),
  fromNumber: text('from_number'),
  fromProduct: text('from_product'),
  fromAccountId: text('from_account_id').references(() => accounts.id, { onDelete: 'set null' }),
  toBank: text('to_bank').notNull(),
  toNumber: text('to_number'),
  toProduct: text('to_product'),
  toAccountId: text('to_account_id').references(() => accounts.id, { onDelete: 'set null' }),
  transferId: text('transfer_id').references(() => transfers.id, { onDelete: 'set null' }),
  status: text('status').notNull(),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
}, table => [uniqueIndex('idx_own_bank_transfer_operation').on(table.createdByUserId, table.operationKey),
  check('own_bank_transfer_amount_positive', sql`${table.amount} > 0`),
  check('own_bank_transfer_currency', sql`${table.currency} = 'CLP'`),
  check('own_bank_transfer_status', sql`${table.status} IN ('linked', 'pending_accounts')`)])

export const ownBankTransferReceipts = pgTable('own_bank_transfer_receipts', {
  id: text('id').primaryKey(),
  importId: text('import_id').notNull().references(() => ownBankTransferImports.id, { onDelete: 'cascade' }),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  emailId: text('email_id').notNull(),
  reference: text('reference'),
}, table => [uniqueIndex('idx_own_bank_transfer_receipt').on(table.createdByUserId, table.provider, table.emailId)])
