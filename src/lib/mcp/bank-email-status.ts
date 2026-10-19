import { createHash } from 'node:crypto'
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { bankEmailRuns as runs, bankEmailDecisions as decisions, db } from '@/lib/db'
import { domainExecution } from '@/lib/domain/execution-context'

const senders = new Set(['contacto@bci.cl', 'transferencias@bci.cl', 'no-reply@mail.machbank.cl', 'no-reply@tenpo.cl', 'info@mercadopago.com', 'info@mercadopago.cl'])
const reasons = new Set(['account_unresolved', 'transfer_pending_accounts', 'duplicate_success', 'imported', 'error', 'from_not_in_allowlist', 'authentication_failed', 'parser_no_match', 'not_transaction'])
const outcomes = new Set(['running', 'completed', 'uidvalidity_changed', 'budget_reached', 'message_blocked', 'worker_error'])
const dispositions = new Set(['imported', 'skipped', 'unresolved', 'duplicate', 'error'])
export async function bankEmailStatus(input: { limit: number; offset: number; messageId?: string; sender?: string; dateFrom?: string; dateTo?: string }) {
  const context = domainExecution.getStore()!
  // Mailbox-wide diagnostics cannot be partitioned by Space before routing.
  // Require all-Space consent and restrict every query to the worker's user.
  if (!context.allSpaces) throw new Error('Worker diagnostics require consent for all Spaces')
  const messageIdHash = input.messageId ? createHash('sha256').update(input.messageId.trim().replace(/^<|>$/g, '')).digest('hex') : undefined
  const recentRuns = await db.select({ id: runs.id, startedAt: runs.startedAt, finishedAt: runs.finishedAt,
    outcome: runs.outcome, lastSuccessfulUid: runs.lastSuccessfulUid }).from(runs)
    .where(eq(runs.userId, context.user.id)).orderBy(desc(runs.startedAt), desc(runs.id)).limit(input.limit).offset(input.offset)
  const emails = await db.select({ runId: decisions.runId, uid: decisions.uid, messageIdHash: decisions.messageIdHash,
    emailDate: decisions.emailDate, sender: decisions.sender, decision: decisions.decision,
    reason: decisions.reason, alert: decisions.alert, recordedAt: decisions.recordedAt }).from(decisions)
    .innerJoin(runs, eq(runs.id, decisions.runId)).where(and(eq(runs.userId, context.user.id),
      messageIdHash ? eq(decisions.messageIdHash, messageIdHash) : undefined,
      input.sender ? eq(decisions.sender, input.sender) : undefined,
      input.dateFrom ? gte(decisions.emailDate, new Date(`${input.dateFrom}T00:00:00Z`)) : undefined,
      input.dateTo ? lte(decisions.emailDate, new Date(`${input.dateTo}T23:59:59.999Z`)) : undefined,
    )).orderBy(desc(decisions.id)).limit(input.limit).offset(input.offset)
  return { runs: recentRuns.map(row => ({ ...row, outcome: outcomes.has(row.outcome) ? row.outcome : 'unknown' })),
    emails: emails.map(row => ({ ...row,
      messageIdHash: /^[a-f0-9]{64}$/.test(row.messageIdHash) ? row.messageIdHash : null,
      sender: row.sender && senders.has(row.sender) ? row.sender : null,
      decision: dispositions.has(row.decision) ? row.decision : 'unknown', reason: reasons.has(row.reason) ? row.reason : 'unknown',
    })), limit: input.limit, offset: input.offset }
}
