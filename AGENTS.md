# Wallit maintenance rules

- Preserve the domain vocabulary and invariants in `CONTEXT.md` and `docs/adr/`.
- All movement mutations use explicit operations in `src/lib/domain/movement-ledger.ts`; imports use the existing import service. Do not expose arbitrary SQL or persistence-field updates to MCP callers.
- Every new or changed Wallit capability must update the remote MCP catalog (`src/lib/mcp/tools.ts`), its parity inventory (`docs/mcp.md`), and meaningful fixture tests (`e2e/mcp.spec.ts`). Document any intentional exclusion.
- Every new movement created through MCP, including bulk, transfers, settlements, splits and nested workflows, enters review. Use `insertLedgerMovements` for every domain movement insertion. A client cannot override this policy. Only a separate explicit review operation can confirm existing movements.
- Preserve authenticated user identity, current membership/owner checks, granted Spaces/scopes, expiry, revocation, idempotency and auditability. Never return password hashes, session IDs, tokens, secret environment values or other users' private data.
- Test financial writes only in disposable local fixtures. Never use real financial records as test fixtures.
- Require independent security/spec review before merging MCP changes.
