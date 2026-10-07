# Remote MCP

## Endpoint and authorization

Production endpoint: `https://wallit.libt.app/api/mcp` (Streamable HTTP, stateless POST, JSON responses). It runs in the Railway Wallit app alongside the existing UI; PostgreSQL stores authorization and retry state. No Mac, local proxy, scheduled desktop job, or local token file participates in production execution.

- Protected resource discovery: `https://wallit.libt.app/.well-known/oauth-protected-resource/api/mcp`
- Authorization server discovery: `https://wallit.libt.app/.well-known/oauth-authorization-server`
- Authorization/registration/token/revocation: `/oauth/authorize`, `/oauth/register`, `/oauth/token`, `/oauth/revoke`
- User-managed connections and immediate family revocation: `/oauth/connections`, linked from Settings.

OAuth uses public-client dynamic registration (`token_endpoint_auth_method=none`), authorization code, mandatory PKCE S256, exact registered redirect URIs, mandatory resource audience, state, issuer callback identification, and explicit Wallit browser consent. Access tokens expire after 15 minutes, refresh tokens rotate with a 30-day lifetime, and grants expire after 90 days. A consumed code or refresh replay revokes the entire family. Only token hashes are stored. Consent CSP permits the exact validated callback origin so a real browser can complete the redirect, without relaxing the application-wide policy. Each MCP request checks expiry, grant revocation and audience; each domain call rechecks the grant and current membership within its transaction.

The consent screen identifies the logged-in account, application and redirect, explains scopes and persistence, requires an explicit confirmation checkbox, and offers all current/future Spaces or a selected subset. It is bound to the current session, a signed expiring form, an HTTP-only SameSite cookie and the exact Origin. Connection revocation also requires a signed session-bound form and Origin validation. DCR creates public application metadata, without client secrets or financial permissions; it cannot grant account access.

| Scope | Allowed operations |
| --- | --- |
| `wallit:read` | Authenticated profile, permitted Spaces, financial reads and reports |
| `wallit:write` | Domain creation, edits, deletion and imports |
| `wallit:review` | Separate explicit confirmation of existing movements |
| `wallit:admin` | Space administration and membership, within existing Owner/Member rules |

Anonymous MCP GET/POST/DELETE/OPTIONS receive 401 with the resource-metadata challenge. A known tool with insufficient scope receives 403. Unsupported authenticated HTTP methods receive 405. No URL-only authentication, static bearer configuration, arbitrary SQL, raw field updates, password/session/token listings or administrator bypass is exposed.

## Domain execution and safety

The catalog calls the existing actions and explicit Movement Ledger/import operations. Trusted server-only AsyncLocalStorage supplies the OAuth user, explicit Space, consented memberships and transaction to those services. UI cookie selection does not affect MCP requests. Monetary values use Wallit's integer cents, including CLP (`10000` means CLP 100); USD value is cents, USD→CLP exchange rates are multiplied by 100. `amountInputMode` distinguishes input-currency amounts from canonical CLP amounts; the Ledger owns normalization and tolerance rules.

All movement insertion sites in the Ledger and importer pass through `insertLedgerMovements`. MCP origin forces `needsReview=true`, including bulk, both transfer legs, splits, receivable/emergency payments and settlement remainders. A commit-time postcondition also restores pending status when a downstream workflow changes it. New movements cannot be confirmed in the same tool call. Only an explicitly named review tool with the review scope can confirm previously existing movements; ordinary edits preserve pending status. UI and bank cron origin preserve their existing behavior.

Every mutation requires `idempotencyKey` (16–120 characters). Use a new random key for a new intent, and reuse the same key and complete arguments after an uncertain result. A durable user-scoped operation record contains a canonical request fingerprint, tool, Space, arguments, result and timestamp. The same key with changed input fails. A serializable transaction commits domain changes, audit and retry result together; advisory locks serialize participating MCP writers, and serialization/deadlock conflicts retry up to three times. Revocation locks conflict with active domain execution. Referenced accounts, linked transfers/settlements and fresh/cached import duplicate results must remain within current membership and consent. The existing UI also permits sending from a shared Space to a current member: the dedicated send tool resolves the recipient inbox internally, creates an unassigned pending incoming leg, and returns only the sender’s movement ID. This narrow domain permission exposes no recipient accounts, balances or other movements; later reads/edits still require membership in both Spaces. Errors return domain validation messages or generic failure codes, never SQL details or credentials.

Reads are bounded where timeline/audit/import lists offer pagination (default 50, maximum 200). Review queues and current account/category lists follow the existing UI's complete-list semantics. Historical category/other-Space labels outside consent are hidden. Audit listing returns operation IDs, tool and timestamp, without token records or cross-Space arguments/results.

## Parity inventory

The following 64 tools map the existing UI and domain capabilities. `tools/list` is the executable input-schema source; strict schemas reject extra fields such as a review-policy override.

| Capability in Wallit | MCP parity |
| --- | --- |
| User identity | Own stable profile ID/email; no password/profile edit UI exists |
| Active Space selection | Every financial call explicitly supplies `spaceId`; cookie switching is unnecessary |
| Spaces and permissions | List/create/edit/archive/leave; members list/add/remove with Owner checks |
| Categories | List/create/edit/delete, including existing dependency handling |
| Accounts/settings | Banks, types, last four, CLP/USD, initial balances, credit limits, investment flag, color/emoji and order |
| Investments | Current value and snapshot history/performance/edit/delete |
| Dashboard/account/timeline | Balances, total/net liquidity, paginated movements, details, receivables, review queue |
| Income and expenses | Create/bulk/edit/pending correction/delete, normalized CLP/USD money |
| Transfers | Create/read/whole-transfer edit/delete/review, inter-Space/currency, transform movement; narrowly authorized sends to current shared-Space members |
| Receivables | Mark/unmark, splits, new/existing/cross-Space settlements, transfer-consumption/remainders and explicit classification |
| Emergencies and loans | Lists/details, partial/direct emergency payment and cash/existing-expense loan settlement |
| Reports | Date/category/account filtering, category expenses, daily cashflow and balances |
| Import/review | Existing email/own-bank import service, evidence/receipt reads, durable dedupe and explicit separate confirmations |
| OAuth connections | Browser consent and revocation; intentionally not exposed to a tool that can grant itself rights |
| Tags, budgets, installments, recurring schedules | Not present in current schema/actions/UI; intentionally not invented |
| Bank browser automation, cron configuration, raw database/admin access | Operational infrastructure rather than an authenticated user's Wallit UI; not exposed |
| Register/login/logout/password recovery | Browser authentication lifecycle; existing registration/login remains outside already-authenticated MCP |

### Full catalog

| Tool | Required scope | Existing operation / behavior |
| --- | --- | --- |
| `wallit_profile` | `wallit:read` | Read the stable identity of your own authenticated Wallit account. |
| `wallit_spaces_list` | `wallit:read` | List active Spaces you currently belong to and their roles. |
| `wallit_space_create` | `wallit:admin` | Create a shared Space, copying your Personal categories. Requires admin consent. |
| `wallit_space_update` | `wallit:admin` | Owner: rename a shared Space. |
| `wallit_space_archive` | `wallit:admin` | Owner: archive a shared Space. |
| `wallit_space_leave` | `wallit:admin` | Leave a shared Space as a member. |
| `wallit_members_list` | `wallit:read` | List members of the selected Space. |
| `wallit_member_add` | `wallit:admin` | Owner: add an existing Wallit user by email. |
| `wallit_member_remove` | `wallit:admin` | Owner: remove a member from the selected Space. |
| `wallit_categories_list` | `wallit:read` | Read categories in the selected Space. |
| `wallit_category_create` | `wallit:write` | Create a category. |
| `wallit_category_update` | `wallit:write` | Edit a category in this Space. |
| `wallit_category_delete` | `wallit:write` | Delete a category; preserve movements under the existing domain rules. |
| `wallit_accounts_list` | `wallit:read` | Read all account settings, opening balances, credit limits and currencies. |
| `wallit_account_create` | `wallit:write` | Create an account. Opening balance and creditLimit are cents. |
| `wallit_account_update` | `wallit:write` | Replace editable account settings. Supply the complete current settings; amounts are cents. |
| `wallit_account_delete` | `wallit:write` | Delete an account through Wallit account rules. |
| `wallit_accounts_reorder` | `wallit:write` | Persist a complete account display order. |
| `wallit_balances` | `wallit:read` | Read account balances, total balance and net liquidity in this Space. |
| `wallit_account_movements` | `wallit:read` | Read a bounded page of account movements. |
| `wallit_movements_list` | `wallit:read` | Read a bounded timeline page, optionally pending receivables. |
| `wallit_movement_get` | `wallit:read` | Read one movement in the selected Space. |
| `wallit_movement_create` | `wallit:write` | Record income/expense through the Ledger. Always creates a movement pending review. |
| `wallit_movements_create_bulk` | `wallit:write` | Atomically create up to 100 income/expense movements, all pending review. |
| `wallit_movement_edit` | `wallit:write` | Edit a confirmed movement through reclassification invariants. Pending items use pending_edit. |
| `wallit_pending_edit` | `wallit:write` | Correct a pending standalone movement while keeping it pending review. |
| `wallit_movement_delete` | `wallit:write` | Delete a confirmed movement with dependency checks. |
| `wallit_pending_delete` | `wallit:write` | Delete a pending movement with dependency checks. |
| `wallit_review_list` | `wallit:read` | Read the review queue and pending count. |
| `wallit_review_confirm` | `wallit:review` | Explicitly confirm an existing standalone pending movement. Never create a new movement. |
| `wallit_review_confirm_operational` | `wallit:review` | Explicitly acknowledge existing pending operational payment, loan or emergency legs. |
| `wallit_transfer_create` | `wallit:write` | Record a transfer between two accounts/Spaces you can access. Both new legs are pending review. |
| `wallit_transfer_send_to_member` | `wallit:write` | Send from a shared Space to a current member: the recipient chooses their account during review. This grants no access to their private finances. Both new legs enter review. |
| `wallit_transfer_get` | `wallit:read` | Read both transfer legs only while you have access to both Spaces. |
| `wallit_transfer_update` | `wallit:write` | Edit the whole transfer through its Ledger invariants, preserving pending status. |
| `wallit_transfer_delete` | `wallit:write` | Delete a whole transfer and its linked legs after dependency checks. |
| `wallit_transfer_confirm` | `wallit:review` | Explicitly confirm an existing pending transfer as one operation. |
| `wallit_transfer_pending_delete` | `wallit:write` | Delete a whole pending transfer through its domain rules. |
| `wallit_movement_to_transfer` | `wallit:write` | Transform a movement into a transfer. Any new leg remains pending until separate confirmation. |
| `wallit_receivable_mark` | `wallit:write` | Mark an expense as receivable and set debtor/reminder text. |
| `wallit_receivable_unmark` | `wallit:write` | Remove receivable tracking through dependency-aware rules. |
| `wallit_movement_split` | `wallit:write` | Split a standalone movement into named amounts. All new slices enter review. |
| `wallit_receivable_settle_new` | `wallit:write` | Settle a receivable with a new payment; any new movement enters review. |
| `wallit_receivable_settle_existing` | `wallit:write` | Settle using an existing income/transfer with tolerance and remainder rules. |
| `wallit_receivable_settle_cross_space` | `wallit:write` | Settle from another Space with linked payment legs and tolerance checks. |
| `wallit_settlement_confirm_transfer` | `wallit:review` | Explicitly classify an existing consumed-transfer settlement as operational transfer. |
| `wallit_emergencies_list` | `wallit:read` | Read unsettled emergency expenses. |
| `wallit_emergency_get` | `wallit:read` | Read an emergency expense and payment details. |
| `wallit_emergency_pay` | `wallit:write` | Record a partial emergency payment between accounts. New legs enter review. |
| `wallit_emergency_settle_direct` | `wallit:write` | Settle an emergency expense directly without creating a movement. |
| `wallit_loans_list` | `wallit:read` | Read unsettled loans. |
| `wallit_loan_get` | `wallit:read` | Read a loan and its payback expenses. |
| `wallit_loan_settle` | `wallit:write` | Settle a loan with cash or an existing expense. |
| `wallit_investment_snapshots` | `wallit:read` | Read investment snapshots and performance summary. |
| `wallit_investment_value_update` | `wallit:write` | Set investment current value in cents and record a snapshot. |
| `wallit_investment_snapshot_delete` | `wallit:write` | Delete a snapshot and synchronize current investment value. |
| `wallit_reports` | `wallit:read` | Read category reports, daily cashflow and balances for an inclusive date range. |
| `wallit_report_category_movements` | `wallit:read` | Read reportable expenses for a category/date range. |
| `wallit_exchange_rate` | `wallit:read` | Read the current cached/live USD→CLP rate × 100. |
| `wallit_import_movement` | `wallit:write` | Import bank evidence through the existing retry-safe email importer, bound to your identity. Always pending review. |
| `wallit_import_transfer` | `wallit:write` | Import retry-safe CLP/USD transfer evidence into two accessible accounts; both new legs enter review. |
| `wallit_import_own_bank_transfer` | `wallit:write` | Import own-bank evidence through the domain importer. Missing mapped accounts produce evidence only; mapped legs enter review. |
| `wallit_bank_imports_list` | `wallit:read` | Read your bank-transfer evidence and receipt identities within the authorized Spaces. |
| `wallit_audit_list` | `wallit:read` | Read your MCP operation audit IDs and timestamps for this Space. No credential/token records are exposed. |

## Plugin package and cloud installation

`plugins/wallit/plugin.json`, `mcp.json` and `skills/wallit/SKILL.md` provide a portable plugin using only the HTTPS remote endpoint. No credentials are checked in. It can be loaded as a directory plugin where supported. That package alone does not register a cloud plugin.

The parent must add a custom remote MCP server at the production endpoint in Plugins, choose Create as plugin, then connect using the Wallit browser OAuth flow. Request all four scopes for the user's requested complete Wallit access. The user confirms creation/persistence of their connection in that flow; no production grant is pre-provisioned by tests. Installation must return a real plugin identifier, after which initialize, tools/list and the profile/read tools must be verified through the installed cloud plugin. This interactive consent and cloud installation cannot be represented by a local Codex config file.

## Configuration and verification

Production already supplies `DATABASE_URL` and `AUTH_SECRET`. Consent signing uses `MCP_OAUTH_SECRET`, or falls back to `AUTH_SECRET` only when no dedicated key is configured. The signing key must have at least 32 characters and is never returned. A dedicated key keeps the existing login configuration independent. Generating and persisting a new production key requires explicit user authorization; do not store it in the repository. `MCP_ORIGIN` defaults to `https://wallit.libt.app` and may only be an HTTPS origin in production. A development override accepts HTTP loopback. Migration `0021_remote_mcp.sql` adds only the five authorization/audit tables, without changing financial rows or the bank cron configuration. Apply through the existing deployment migration command.

Local fixture validation:

```sh
npm ci
npm run test:unit
npx tsc --noEmit
DATABASE_URL=postgresql://127.0.0.1:55432/wallit_mcp_test npm run db:migrate
MCP_TEST_DATABASE_URL=postgresql://127.0.0.1:55432/wallit_mcp_test npx playwright test --config mcp.playwright.config.ts
npm run build
```

The test configuration refuses remote databases and non-fixture database names. Real HTTP OAuth/MCP tests exercise every catalog entry (some dependency-rejection paths as well), review origin policy, money/workflows, isolation, scopes/roles, origin, PKCE/redirect/resource validation, expiry/replay/revocation, browser login/consent/callback/CSRF/revocation, member inbox sends, large CLP amounts, atomic rollback and concurrent durable retry. CI repeats unit/type/migration/fixture transport/build checks with PostgreSQL 17. Independent review is required before merge. Production checks must verify the exact merged commit and Railway SUCCESS, anonymous 401/discovery/health, then authenticated read after the user's connection consent. Do not test writes on real financial accounts.

Deployment and installed-plugin verification evidence is recorded in the final task handoff. Until cloud installation and authenticated production read are verified, the integration is prepared rather than fully validated end to end.
