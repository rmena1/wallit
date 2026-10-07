import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { getDb, movements, mcpGrants, mcpOperations, accounts, transfers, receivableSettlements, ownBankTransferImports } from '@/lib/db'
import { domainExecution } from '@/lib/domain/execution-context'
import { getPendingTransferMemberDestination } from '@/lib/domain/movement-ledger'
import { getAvailableSpaces } from '@/lib/spaces'
import { randomToken, tokenHash } from './oauth-policy'
import type { McpPrincipal } from './oauth'
import { mcpTools } from './tools'

export class McpError extends Error {
  constructor(public code: string, message: string) { super(message) }
}
export function toolFor(name: string) { return mcpTools.find(tool => tool.name === name) }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

/** One durable transaction owns permission checks, domain calls, audit and idempotency. */
export async function executeTool(principal: McpPrincipal, name: string, raw: unknown): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await executeAttempt(principal, name, raw) }
    catch (error) {
      const code = error && typeof error === 'object' && 'cause' in error && error.cause && typeof error.cause === 'object' && 'code' in error.cause ? error.cause.code : error && typeof error === 'object' && 'code' in error ? error.code : null
      if ((code !== '40001' && code !== '40P01') || attempt === 2) throw error
    }
  }
}
async function executeAttempt(principal: McpPrincipal, name: string, raw: unknown) {
  const tool = toolFor(name)
  if (!tool) throw new McpError('unknown_tool', 'Unknown tool')
  const parsed = tool.schema.safeParse(raw)
  if (!parsed.success) throw new McpError('invalid_input', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  const args = parsed.data as Record<string, unknown>
  const fingerprint = tokenHash(canonical({ name, args }))
  return getDb().transaction(async tx => {
    const [grant] = await tx.select().from(mcpGrants).where(and(eq(mcpGrants.id, principal.grant.id), eq(mcpGrants.userId, principal.user.id), isNull(mcpGrants.revokedAt), gt(mcpGrants.expiresAt, new Date()))).for('share')
    if (!grant) throw new McpError('unauthorized', 'Authorization expired or revoked')
    if (!grant.scopes.includes(tool.scope)) throw new McpError('insufficient_scope', `Required scope: ${tool.scope}`)
    // Reuse the existing Space services inside the transaction before establishing the full context.
    const initial = { user: principal.user, space: undefined as never, spaces: [], allSpaces: grant.spaceIds === null, client: tx as unknown as ReturnType<typeof getDb>, createdMovementIds: new Set<string>() }
    const available = await domainExecution.run(initial, () => getAvailableSpaces(principal.user.id))
    const allowed = available.filter(space => grant.spaceIds === null || grant.spaceIds.includes(space.id))
    const selected = args.spaceId ? allowed.find(space => space.id === args.spaceId) : allowed[0]
    if (!selected) throw new McpError('forbidden', 'Space unavailable')
    if (name === 'wallit_space_create' && grant.spaceIds !== null) throw new McpError('forbidden', 'Creating Spaces requires consent for all Spaces')
    const allowedIds = new Set(allowed.map(space => space.id))
    // The UI allows a narrowly scoped send to a current shared-Space member.
    // Resolve the unassigned destination internally; never expose recipient finances.
    const pendingMemberDestinationId = name === 'wallit_transfer_send_to_member'
      ? await domainExecution.run(initial, () => getPendingTransferMemberDestination(principal.user.id, selected.id, String(args.memberUserId)))
      : undefined
    if (name === 'wallit_transfer_send_to_member' && !pendingMemberDestinationId) throw new McpError('forbidden', 'Member destination unavailable')
    // Category deletion SET NULLs historical movement links, sometimes in other Spaces.
    if (name === 'wallit_category_delete') {
      const references = await tx.select({ spaceId: movements.spaceId }).from(movements).where(eq(movements.categoryId, String(args.id)))
      if (references.some(row => !allowedIds.has(row.spaceId))) throw new McpError('forbidden', 'Category has references outside authorized Spaces')
    }
    for (const field of ['destinationSpaceId', 'payingSpaceId']) {
      if (args[field] && !allowedIds.has(String(args[field]))) throw new McpError('forbidden', 'Space unavailable')
    }
    // Serialize MCP writers sharing any Space. Serializable isolation also detects UI/cron races.
    if (tool.write) for (const spaceId of [...new Set([...allowedIds, ...(pendingMemberDestinationId ? [pendingMemberDestinationId] : [])])].sort()) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wallit:mcp:space:${spaceId}`}, 0))`)
    // Validate all referenced accounts against membership AND the grant, including nested/bulk inputs.
    const referencedAccounts: string[] = []
    const collectAccounts = (value: unknown) => {
      if (!value || typeof value !== 'object') return
      for (const [key, item] of Object.entries(value)) {
        if (key.endsWith('AccountId') || key === 'accountId') { if (typeof item === 'string') referencedAccounts.push(item) }
        else collectAccounts(item)
      }
    }
    collectAccounts(args)
    if (referencedAccounts.length) {
      const found = await tx.select({ id: accounts.id, spaceId: accounts.spaceId }).from(accounts).where(inArray(accounts.id, referencedAccounts))
      if (referencedAccounts.some(id => !found.some(account => account.id === id && allowedIds.has(account.spaceId)))) throw new McpError('forbidden', 'Account unavailable')
    }
    // Linked workflows may touch old/destination Spaces without an explicit input field.
    const movementIds = ['id', 'movementId', 'receivableId', 'existingIncomeId', 'expenseMovementId'].map(key => args[key]).filter((id): id is string => typeof id === 'string')
    const linkedTransfers = movementIds.length || args.transferId
      ? await tx.select().from(transfers).where(or(eq(transfers.id, String(args.transferId ?? '')), inArray(transfers.sourceMovementId, movementIds.length ? movementIds : ['']), inArray(transfers.destinationMovementId, movementIds.length ? movementIds : [''])))
      : []
    if ((tool.write || name === 'wallit_transfer_get') && linkedTransfers.some(link => !allowedIds.has(link.sourceSpaceId) || !allowedIds.has(link.destinationSpaceId))) throw new McpError('forbidden', 'Linked Space unavailable')
    const settlements = movementIds.length ? await tx.select().from(receivableSettlements).where(or(inArray(receivableSettlements.receivableId, movementIds), inArray(receivableSettlements.outgoingMovementId, movementIds), inArray(receivableSettlements.incomingMovementId, movementIds))) : []
    if (tool.write && settlements.some(link => !allowedIds.has(link.fundedSpaceId) || !allowedIds.has(link.payingSpaceId))) throw new McpError('forbidden', 'Linked Space unavailable')
    if (tool.write) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wallit:mcp:key:${principal.user.id}:${args.idempotencyKey}`}, 0))`)
      const [prior] = await tx.select().from(mcpOperations).where(and(eq(mcpOperations.userId, principal.user.id), eq(mcpOperations.key, String(args.idempotencyKey))))
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new McpError('idempotency_conflict', 'Idempotency key already used with different input')
        if (name.startsWith('wallit_import_')) await authorizeImportResult(tx, principal.user.id, grant.spaceIds === null, allowedIds, (prior.result as { result: unknown }).result)
        return prior.result
      }
    }
    const pendingBefore = tool.write && !tool.review ? await tx.select({ id: movements.id }).from(movements).where(and(inArray(movements.spaceId, [...allowedIds]), eq(movements.needsReview, true))) : []
    const execution = { ...initial, space: selected, spaces: allowed, pendingMemberDestinationId: pendingMemberDestinationId ?? undefined }
    const result = await domainExecution.run(execution, () => tool.run(args))
    if (result && typeof result === 'object' && 'success' in result && result.success === false) throw new McpError('domain_error', 'error' in result ? String(result.error) : 'Operation rejected')
    if (name.startsWith('wallit_import_')) await authorizeImportResult(tx, principal.user.id, grant.spaceIds === null, allowedIds, result)
    const attemptedMovementIds = [...execution.createdMovementIds]
    // ON CONFLICT DO NOTHING is used by imports. Audit only persisted new IDs.
    const created = attemptedMovementIds.length ? await tx.select({ id: movements.id, spaceId: movements.spaceId }).from(movements).where(inArray(movements.id, attemptedMovementIds)) : []
    const createdMovementIds = created.map(row => row.id)
    const pendingIds = [...new Set([...createdMovementIds, ...pendingBefore.map(m => m.id)])]
    if (createdMovementIds.length) {
      if (created.some(row => !allowedIds.has(row.spaceId) && row.spaceId !== pendingMemberDestinationId)) throw new McpError('forbidden', 'Created movement outside authorized Spaces')
    }
    // A workflow can update a new leg after insertion. Enforce the origin postcondition at commit too.
    if (pendingIds.length) await tx.update(movements).set({ needsReview: true }).where(and(inArray(movements.id, pendingIds), eq(movements.needsReview, false)))
    const visibleCreatedIds = created.filter(row => allowedIds.has(row.spaceId)).map(row => row.id)
    const safeResult = JSON.parse(JSON.stringify(tool.write ? { result, createdMovementIds: visibleCreatedIds, operationId: randomToken() } : result))
    if (tool.write) await tx.insert(mcpOperations).values({ id: safeResult.operationId, userId: principal.user.id, grantId: grant.id, key: String(args.idempotencyKey), fingerprint, tool: name, spaceId: selected.id, arguments: args, result: safeResult })
    return safeResult
  }, { isolationLevel: 'serializable' })
}

async function authorizeImportResult(client: Pick<ReturnType<typeof getDb>, 'select'>, userId: string, allSpaces: boolean, allowedIds: Set<string>, result: unknown) {
  if (!result || typeof result !== 'object') throw new McpError('forbidden', 'Import unavailable')
  const imported = result as Record<string, unknown>
  const ids = ['movementId', 'sourceMovementId', 'destinationMovementId'].map(key => imported[key]).filter((id): id is string => typeof id === 'string')
  if (ids.length) {
    const rows = await client.select({ id: movements.id, spaceId: movements.spaceId }).from(movements).where(inArray(movements.id, ids))
    if (ids.some(id => !rows.some(row => row.id === id && allowedIds.has(row.spaceId)))) throw new McpError('forbidden', 'Import unavailable')
  }
  if (typeof imported.transferId === 'string') {
    const [root] = await client.select().from(transfers).where(eq(transfers.id, imported.transferId))
    if (!root || !allowedIds.has(root.sourceSpaceId) || !allowedIds.has(root.destinationSpaceId)) throw new McpError('forbidden', 'Import unavailable')
  }
  if (typeof imported.bankTransferImportId === 'string') {
    const [record] = await client.select().from(ownBankTransferImports).where(and(eq(ownBankTransferImports.id, imported.bankTransferImportId), eq(ownBankTransferImports.createdByUserId, userId)))
    const accountIds = [record?.fromAccountId, record?.toAccountId].filter((id): id is string => typeof id === 'string')
    const rows = accountIds.length ? await client.select({ id: accounts.id, spaceId: accounts.spaceId }).from(accounts).where(inArray(accounts.id, accountIds)) : []
    if (!record || (!allSpaces && !accountIds.length) || accountIds.some(id => !rows.some(row => row.id === id && allowedIds.has(row.spaceId)))) throw new McpError('forbidden', 'Import unavailable')
  }
}
