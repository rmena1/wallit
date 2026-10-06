import { z } from 'zod'
import * as account from '@/lib/actions/accounts'
import * as category from '@/lib/actions/categories'
import * as space from '@/lib/actions/spaces'
import * as balance from '@/lib/actions/balances'
import * as movement from '@/lib/actions/movements'
import * as transfer from '@/lib/actions/transfers'
import * as review from '@/lib/actions/review'
import * as emergency from '@/lib/actions/emergency'
import * as loan from '@/lib/actions/loans'
import * as investment from '@/lib/actions/investments'
import { getReportData } from '@/lib/actions/reports'
import { movementLedger } from '@/lib/domain/movement-ledger'
import { importEmailTransaction } from '@/lib/domain/email-import-service'
import { domainExecution } from '@/lib/domain/execution-context'
import { getAvailableSpaces } from '@/lib/spaces'
import { db, accounts, mcpOperations, ownBankTransferImports, ownBankTransferReceipts } from '@/lib/db'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'

const id = z.string().min(1).max(120)
const text = z.string().trim().min(1).max(200)
const cents = z.number().int().positive().max(2_147_483_647)
const date = z.iso.date()
const currency = z.enum(['CLP', 'USD'])
const money = {
  name: text, date, amount: cents, type: z.enum(['income', 'expense']), currency,
  accountId: id, categoryId: id.nullable().default(null),
  amountInputMode: z.enum(['inputCurrency', 'canonicalClp']).default('inputCurrency'),
  amountUsd: cents.nullable().optional(), exchangeRate: cents.nullable().optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  emergency: z.boolean().optional(), loan: z.boolean().optional(),
}
const side = z.strictObject({ reportable: z.boolean().optional(), categoryId: id.nullable().optional(), receivable: z.boolean().optional(), receivableText: text.nullable().optional() })
const transferInput = {
  fromAccountId: id, toAccountId: id, destinationSpaceId: id.optional(), fromAmount: cents,
  toAmount: cents, fromCurrency: currency, toCurrency: currency, date,
  note: z.string().max(200).optional(), source: side.optional(), destination: side.optional(),
}
const accountInput = {
  bankName: text, accountType: text, lastFourDigits: z.string().regex(/^\d{4}$/),
  initialBalance: z.number().int().min(-2_147_483_647).max(2_147_483_647).default(0),
  creditLimit: z.number().int().nonnegative().max(2_147_483_647).nullable().default(null),
  currency, isInvestment: z.boolean().default(false),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(), emoji: z.string().max(32).nullable().optional(),
}
const paging = { offset: z.number().int().nonnegative().max(1_000_000).default(0), limit: z.number().int().min(1).max(200).default(50) }
const sourceIdentity = { sourceEmailProvider: z.enum(['bci', 'tenpo', 'mercadopago', 'mach']), sourceEmailId: z.string().min(1).max(500) }
const bankEndpoint = z.strictObject({ bank: text, number: z.string().max(32).nullable(), product: z.enum(['vista', 'wallet', 'principal']).nullable(), accountId: id.nullable() })
const context = () => {
  const value = domainExecution.getStore()
  if (!value) throw new Error('Missing domain context')
  return value
}
function form(values: Record<string, unknown>, accountMoney = false) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || key === 'spaceId' || key === 'idempotencyKey') continue
    data.set(key, String(accountMoney && (key === 'initialBalance' || key === 'creditLimit') ? Number(value) / 100 : value))
  }
  return data
}
export type ToolDefinition = {
  name: string; description: string; scope: string; write: boolean; review: boolean;
  schema: z.ZodObject; run: (input: unknown) => Promise<unknown>
}
function define<S extends z.ZodRawShape>(name: string, description: string, scope: string, shape: S, run: (input: z.output<z.ZodObject<S>>) => Promise<unknown>): ToolDefinition {
  const schema = z.strictObject(shape)
  return { name, description, scope, write: scope !== 'wallit:read', review: scope === 'wallit:review', schema, run: input => run(schema.parse(input)) }
}
const read = { spaceId: id }
const write = { ...read, idempotencyKey: z.string().min(16).max(120) }
const ledger = () => ({ spaceId: context().space.id, userId: context().user.id })

// The catalog is also the parity inventory and the source of MCP input schemas.
// All monetary values are integer cents, including CLP (100 cents = CLP 1).
export const mcpTools: ToolDefinition[] = [
  define('wallit_profile', 'Read the stable identity of your own authenticated Wallit account.', 'wallit:read', {}, async () => ({ id: context().user.id, email: context().user.email })),
  define('wallit_spaces_list', 'List active Spaces you currently belong to and their roles.', 'wallit:read', {}, async () => (await getAvailableSpaces(context().user.id)).filter(s => context().spaces.some(allowed => allowed.id === s.id))),
  define('wallit_space_create', 'Create a shared Space, copying your Personal categories. Requires admin consent.', 'wallit:admin', { ...write, name: text, emoji: z.string().min(1).max(32) }, a => space.createSpace(a)),
  define('wallit_space_update', 'Owner: rename a shared Space.', 'wallit:admin', { ...write, name: text, emoji: z.string().min(1).max(32) }, a => space.updateSpace(a)),
  define('wallit_space_archive', 'Owner: archive a shared Space.', 'wallit:admin', write, a => space.archiveSpace(a.spaceId)),
  define('wallit_space_leave', 'Leave a shared Space as a member.', 'wallit:admin', write, a => space.leaveSpace(a.spaceId)),
  define('wallit_members_list', 'List members of the selected Space.', 'wallit:read', read, a => space.getSpaceMembers(a.spaceId)),
  define('wallit_member_add', 'Owner: add an existing Wallit user by email.', 'wallit:admin', { ...write, email: z.email().max(254) }, a => space.addSpaceMember(a)),
  define('wallit_member_remove', 'Owner: remove a member from the selected Space.', 'wallit:admin', { ...write, userId: id }, a => space.removeSpaceMember(a)),
  define('wallit_categories_list', 'Read categories in the selected Space.', 'wallit:read', read, () => category.getCategories()),
  define('wallit_category_create', 'Create a category.', 'wallit:write', { ...write, name: text, emoji: z.string().min(1).max(32) }, a => category.createCategory(form(a))),
  define('wallit_category_update', 'Edit a category in this Space.', 'wallit:write', { ...write, id, name: text, emoji: z.string().min(1).max(32) }, a => category.updateCategory(form(a))),
  define('wallit_category_delete', 'Delete a category; preserve movements under the existing domain rules.', 'wallit:write', { ...write, id }, a => category.deleteCategory(a.id)),
  define('wallit_accounts_list', 'Read all account settings, opening balances, credit limits and currencies.', 'wallit:read', read, () => account.getAccounts()),
  define('wallit_account_create', 'Create an account. Opening balance and creditLimit are cents.', 'wallit:write', { ...write, ...accountInput }, a => account.createAccount(form(a, true))),
  define('wallit_account_update', 'Replace editable account settings. Supply the complete current settings; amounts are cents.', 'wallit:write', { ...write, id, ...accountInput }, a => account.updateAccount(form(a, true))),
  define('wallit_account_delete', 'Delete an account through Wallit account rules.', 'wallit:write', { ...write, id }, a => account.deleteAccount(a.id)),
  define('wallit_accounts_reorder', 'Persist a complete account display order.', 'wallit:write', { ...write, accountIds: z.array(id).min(1).max(200) }, a => account.reorderAccounts(a.accountIds)),
  define('wallit_balances', 'Read account balances, total balance and net liquidity in this Space.', 'wallit:read', read, async () => ({ accounts: await balance.getAccountBalances(), total: await balance.getTotalBalance(), liquidity: await balance.getNetLiquidity() })),
  define('wallit_account_movements', 'Read a bounded page of account movements.', 'wallit:read', { ...read, ...paging, accountId: id, transfersOnly: z.boolean().default(false) }, a => account.getAccountMovements(a.accountId, a.offset, a.limit, a.transfersOnly)),
  define('wallit_movements_list', 'Read a bounded timeline page, optionally pending receivables.', 'wallit:read', { ...read, ...paging, filter: z.enum(['all', 'receivables']).default('all') }, a => movement.getMovementsPaginated(a.offset, a.limit, a.filter)),
  define('wallit_movement_get', 'Read one movement in the selected Space.', 'wallit:read', { ...read, id }, a => movement.getMovementById(a.id)),
  define('wallit_movement_create', 'Record income/expense through the Ledger. Always creates a movement pending review.', 'wallit:write', { ...write, ...money }, a => movementLedger.recordReportableMovement(ledger().spaceId, ledger().userId, a)),
  define('wallit_movements_create_bulk', 'Atomically create up to 100 income/expense movements, all pending review.', 'wallit:write', { ...write, items: z.array(z.strictObject(money)).min(1).max(100) }, async a => {
    for (const item of a.items) {
      const result = await movementLedger.recordReportableMovement(ledger().spaceId, ledger().userId, item)
      if (!result.success) return result
    }
    return { success: true, count: a.items.length }
  }),
  define('wallit_movement_edit', 'Edit a confirmed movement through reclassification invariants. Pending items use pending_edit.', 'wallit:write', { ...write, id, ...money }, a => movementLedger.reclassifyReportableMovement(a.spaceId, a.id, a)),
  define('wallit_pending_edit', 'Correct a pending standalone movement while keeping it pending review.', 'wallit:write', { ...write, id, ...money }, a => movementLedger.editPendingMovement(a.spaceId, a.id, a)),
  define('wallit_movement_delete', 'Delete a confirmed movement with dependency checks.', 'wallit:write', { ...write, id }, a => movement.deleteReportableMovement(a.id)),
  define('wallit_pending_delete', 'Delete a pending movement with dependency checks.', 'wallit:write', { ...write, id }, a => review.deletePendingMovement(a.id)),
  define('wallit_review_list', 'Read the review queue and pending count.', 'wallit:read', read, async () => ({ count: await review.getPendingReviewCount(), items: await review.getPendingReviewMovements() })),
  define('wallit_review_confirm', 'Explicitly confirm an existing standalone pending movement. Never create a new movement.', 'wallit:review', { ...write, id, ...money }, a => movementLedger.confirmPendingAsReportable(a.spaceId, a.id, a)),
  define('wallit_review_confirm_operational', 'Explicitly acknowledge existing pending operational payment, loan or emergency legs.', 'wallit:review', { ...write, id }, a => movementLedger.confirmPendingOperational(a.spaceId, ledger().userId, a.id)),
  define('wallit_transfer_create', 'Record a transfer between two accounts/Spaces you can access. Both new legs are pending review.', 'wallit:write', { ...write, ...transferInput }, a => movementLedger.recordTransfer(a.spaceId, ledger().userId, { ...a, allowIncompleteClassification: true })),
  define('wallit_transfer_get', 'Read both transfer legs only while you have access to both Spaces.', 'wallit:read', { ...read, movementId: id }, a => transfer.getTransferByMovementId(a.movementId)),
  define('wallit_transfer_update', 'Edit the whole transfer through its Ledger invariants, preserving pending status.', 'wallit:write', { ...write, transferId: id, ...transferInput }, a => transfer.updateTransfer(a.transferId, a)),
  define('wallit_transfer_delete', 'Delete a whole transfer and its linked legs after dependency checks.', 'wallit:write', { ...write, transferId: id }, a => transfer.deleteTransfer(a.transferId)),
  define('wallit_transfer_confirm', 'Explicitly confirm an existing pending transfer as one operation.', 'wallit:review', { ...write, transferId: id, source: side.optional(), destination: side.optional() }, a => review.confirmPendingTransfer(a.transferId, a)),
  define('wallit_transfer_pending_delete', 'Delete a whole pending transfer through its domain rules.', 'wallit:write', { ...write, transferId: id }, a => review.deletePendingTransfer(a.transferId)),
  define('wallit_movement_to_transfer', 'Transform a movement into a transfer. Any new leg remains pending until separate confirmation.', 'wallit:write', { ...write, movementId: id, source: z.strictObject(money), toAccountId: id, destinationSpaceId: id.optional(), toAmount: cents, toCurrency: currency, note: text.optional(), sourceReportable: z.boolean().optional(), sourceCategoryId: id.nullable().optional(), sourceReceivable: z.boolean().optional(), sourceReceivableText: text.nullable().optional(), destinationReportable: z.boolean().optional(), destinationCategoryId: id.nullable().optional() }, a => transfer.transformToTransfer({ ...a, source: { ...a.source, amountUsd: a.source.amountUsd ?? null, exchangeRate: a.source.exchangeRate ?? null } })),
  define('wallit_receivable_mark', 'Mark an expense as receivable and set debtor/reminder text.', 'wallit:write', { ...write, id, reminderText: text }, a => review.markAsReceivable(a.id, a.reminderText)),
  define('wallit_receivable_unmark', 'Remove receivable tracking through dependency-aware rules.', 'wallit:write', { ...write, id }, a => review.unmarkReceivable(a.id)),
  define('wallit_movement_split', 'Split a standalone movement into named amounts. All new slices enter review.', 'wallit:write', { ...write, id, splits: z.array(z.strictObject({ name: text, amount: cents })).min(2).max(100) }, a => review.splitMovement(a.id, a.splits)),
  define('wallit_receivable_settle_new', 'Settle a receivable with a new payment; any new movement enters review.', 'wallit:write', { ...write, id, paymentAccountId: id.optional() }, a => review.settleReceivableWithNewMovement(a.id, a.paymentAccountId)),
  define('wallit_receivable_settle_existing', 'Settle using an existing income/transfer with tolerance and remainder rules.', 'wallit:write', { ...write, receivableId: id, existingIncomeId: id }, a => review.settleReceivableWithExistingMovement(a.receivableId, a.existingIncomeId)),
  define('wallit_receivable_settle_cross_space', 'Settle from another Space with linked payment legs and tolerance checks.', 'wallit:write', { ...write, receivableId: id, payingSpaceId: id, sourceAccountId: id, destinationAccountId: id, amount: cents, date }, a => review.settleReceivableWithCrossSpacePayment(a.receivableId, a)),
  define('wallit_settlement_confirm_transfer', 'Explicitly classify an existing consumed-transfer settlement as operational transfer.', 'wallit:review', { ...write, id }, a => review.confirmSettlementAsTransfer(a.id)),
  define('wallit_emergencies_list', 'Read unsettled emergency expenses.', 'wallit:read', read, () => emergency.getUnsettledEmergencies()),
  define('wallit_emergency_get', 'Read an emergency expense and payment details.', 'wallit:read', { ...read, id }, a => emergency.getEmergencyDetail(a.id)),
  define('wallit_emergency_pay', 'Record a partial emergency payment between accounts. New legs enter review.', 'wallit:write', { ...write, id, fromAccountId: id, toAccountId: id, amount: cents, date }, a => emergency.settleEmergencyPartial(a.id, a.fromAccountId, a.toAccountId, a.amount, a.date)),
  define('wallit_emergency_settle_direct', 'Settle an emergency expense directly without creating a movement.', 'wallit:write', { ...write, id }, a => emergency.settleEmergencyDirect(a.id)),
  define('wallit_loans_list', 'Read unsettled loans.', 'wallit:read', read, () => loan.getUnsettledLoans()),
  define('wallit_loan_get', 'Read a loan and its payback expenses.', 'wallit:read', { ...read, id }, a => loan.getLoanDetail(a.id)),
  define('wallit_loan_settle', 'Settle a loan with cash or an existing expense.', 'wallit:write', { ...write, id, expenseMovementId: id.nullable().default(null), date }, a => loan.settleLoan(a.id, a.expenseMovementId ?? 'cash', a.date)),
  define('wallit_investment_snapshots', 'Read investment snapshots and performance summary.', 'wallit:read', { ...read, accountId: id }, async a => ({ snapshots: await investment.getInvestmentSnapshots(a.accountId), summary: await investment.getInvestmentSummary(a.accountId) })),
  define('wallit_investment_value_update', 'Set investment current value in cents and record a snapshot.', 'wallit:write', { ...write, accountId: id, value: z.number().int().nonnegative().max(2_147_483_647) }, a => investment.updateInvestmentValue(a.accountId, a.value)),
  define('wallit_investment_snapshot_delete', 'Delete a snapshot and synchronize current investment value.', 'wallit:write', { ...write, accountId: id, snapshotId: id }, a => investment.deleteInvestmentSnapshot(a.accountId, a.snapshotId)),
  define('wallit_reports', 'Read category reports, daily cashflow and balances for an inclusive date range.', 'wallit:read', { ...read, startDate: date, endDate: date, categoryIds: z.array(id).max(200).optional(), accountId: id.optional() }, a => getReportData(a.startDate, a.endDate, a.categoryIds, a.accountId)),
  define('wallit_report_category_movements', 'Read reportable expenses for a category/date range.', 'wallit:read', { ...read, startDate: date, endDate: date, categoryId: id.nullable(), accountId: id.optional() }, a => movement.getReportCategoryMovements(a.startDate, a.endDate, a.categoryId, a.accountId)),
  define('wallit_exchange_rate', 'Read the current cached/live USD→CLP rate × 100.', 'wallit:read', read, () => transfer.getCurrentExchangeRate()),
  define('wallit_import_movement', 'Import bank evidence through the existing retry-safe email importer, bound to your identity. Always pending review.', 'wallit:write', { ...write, sourceEmailProvider: z.enum(['bci', 'tenpo', 'mercadopago', 'mach']), sourceEmailId: z.string().min(1).max(500), ...money, originalName: text.optional() }, a => importEmailTransaction({ ...a, kind: 'movement', userId: ledger().userId, needsReview: true, amountUsd: a.amountUsd ?? undefined, exchangeRate: a.exchangeRate ?? undefined, time: a.time ?? undefined })),
  define('wallit_import_transfer', 'Import retry-safe CLP/USD transfer evidence into two accessible accounts; both new legs enter review.', 'wallit:write', { ...write, ...sourceIdentity, fromAccountId: id, toAccountId: id, currency, amount: cents, amountUsd: cents.optional(), exchangeRate: cents.optional(), toCurrency: currency.optional(), toAmount: cents.optional(), toAmountUsd: cents.optional(), toExchangeRate: cents.optional(), date, time: z.string().max(5).optional(), originalName: text.optional(), sourceName: text.optional(), destinationName: text.optional() }, a => importEmailTransaction({ ...a, kind: 'transfer', userId: ledger().userId })),
  define('wallit_import_own_bank_transfer', 'Import own-bank evidence through the domain importer. Missing mapped accounts produce evidence only; mapped legs enter review.', 'wallit:write', { ...write, ...sourceIdentity, amount: cents, date, from: bankEndpoint, to: bankEndpoint, operationTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/).nullable(), reference: z.string().regex(/^\d{1,64}$/).nullable(), originalName: text.optional() }, a => importEmailTransaction({ ...a, currency: 'CLP', kind: 'own-bank-transfer', userId: ledger().userId })),
  define('wallit_bank_imports_list', 'Read your bank-transfer evidence and receipt identities within the authorized Spaces.', 'wallit:read', { ...read, ...paging }, async a => {
    const accessibleAccounts = await db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.spaceId, context().spaces.map(s => s.id)))
    const accessibleIds = accessibleAccounts.map(a => a.id)
    const items = await db.select().from(ownBankTransferImports).where(and(
      eq(ownBankTransferImports.createdByUserId, context().user.id),
      or(isNull(ownBankTransferImports.fromAccountId), inArray(ownBankTransferImports.fromAccountId, accessibleIds)),
      or(isNull(ownBankTransferImports.toAccountId), inArray(ownBankTransferImports.toAccountId, accessibleIds)),
      context().allSpaces ? undefined : or(inArray(ownBankTransferImports.fromAccountId, accessibleIds), inArray(ownBankTransferImports.toAccountId, accessibleIds)),
    )).orderBy(desc(ownBankTransferImports.createdAt)).limit(a.limit).offset(a.offset)
    const receipts = items.length ? await db.select().from(ownBankTransferReceipts).where(and(eq(ownBankTransferReceipts.createdByUserId, context().user.id), inArray(ownBankTransferReceipts.importId, items.map(row => row.id)))) : []
    return { items, receipts }
  }),
  define('wallit_audit_list', 'Read your MCP operation audit IDs and timestamps for this Space. No credential/token records are exposed.', 'wallit:read', { ...read, ...paging }, a => db.select({ id: mcpOperations.id, tool: mcpOperations.tool, createdAt: mcpOperations.createdAt }).from(mcpOperations).where(and(eq(mcpOperations.userId, context().user.id), eq(mcpOperations.spaceId, a.spaceId))).orderBy(desc(mcpOperations.createdAt)).limit(a.limit).offset(a.offset)),
]
