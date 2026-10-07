# Remote MCP verification evidence

Base: `b869107ae9e659b07c505b0dafae7f077676624e` (`master`). Implementation is in an isolated checkout on `codex/remote-mcp`; PR: https://github.com/rmena1/wallit/pull/39.

## Local checks, 2026-10-07

- 12 unit tests pass, covering existing monetary tolerance and OAuth redirect/scopes/PKCE/consent/key separation.
- 11 real HTTP/browser integration groups pass against disposable local PostgreSQL 17. The final catalog assertion compares every exercised tool name with `tools/list`, covering all 64 entries. Dependency-rejection paths are included where appropriate.
- OAuth browser test uses a real callback HTTP server on a different loopback origin, rather than a mocked redirect. Login, explicit unchecked consent, registered callback CSP, CSRF/Origin rejection, callback navigation, replay rejection and user revocation all pass. Desktop/mobile consent is visually checked; the mobile document has no horizontal overflow.
- Cross-user/Space grants, scope and Owner checks, current membership loss, fresh/cached duplicate imports, category indirect writes, expiry/replay, atomic rollback, concurrent idempotency and pending-review origin are covered.
- TypeScript passes. ESLint has zero errors; five existing unused-session warnings remain in movement/report actions.
- Production build passes. CI repeats fixture migration, unit/type checks, browser transport and build.
- No production financial writes or test grants were created.

## Independent review findings and resolutions

Two separate reviewers examined Standards and Specification at `188981618756b6b2ce5398ab38c3bc65bee84642`. Their concrete findings resulted in these changes:

| Axis | Finding | Resolution and regression evidence |
| --- | --- | --- |
| Standards | Global form-action CSP prevented real OAuth callback navigation. | Authorization alone emits CSP for the exact registered callback origin; application CSP remains intact. Real-browser callback test passes. |
| Both | A cached import operation could expose a resolved duplicate outside the current grant. | Recheck resolved movement/transfer/evidence identities for both fresh and cached results inside the current authorized transaction. Narrow-grant import tests pass. |
| Standards | Deleting a category could SET NULL references in a Space outside consent. | Reject category deletion when any historical movement reference lies outside current granted membership. Fixture verifies denial and preserved rows. |
| Standards | PostgreSQL integer cap was incorrectly applied to bigint movement amounts. | Preserve safe-integer bigint CLP values while retaining integer caps for integer-backed fields. A 3-billion-cent transfer passes. |
| Specification | Import ON CONFLICT could return attempted movement IDs that never persisted. | Resolve attempted IDs against persisted rows before audit/response. Duplicate-import fixture verifies no phantom new IDs. |
| Specification | Existing pending transfer-to-member UI behavior was missing. | Add narrowly scoped member send using the Ledger's existing member destination rules, without reading recipient accounts or returning their movement ID. Both legs pending; membership removal rejects another send. |

Final pinned-commit review outcomes and production/plugin verification belong in the task handoff after CI and deployment.

## Existing UI regression baseline

59 existing financial UI tests were run in the local fixture database: 53 pass and 6 fail. All six failures were rerun against an isolated archive of unchanged base `b869107ae9e659b07c505b0dafae7f077676624e`, where the same six fail:

- `interspace-transfers.spec.ts:483`: USD pending destination CLP uses live rate 988.73 versus fixture expectation 950.00.
- `receivable-advanced.spec.ts:150`: imported USD receivable is not visible in the existing UI test.
- `receivable-advanced.spec.ts:783`: test setup fails the Personal Space creator foreign key before the financial operation.
- `usd-movements.spec.ts:45`: live rate differs from fixed fixture expectation.
- `usd-movements.spec.ts:95`: income summary uses live rate versus fixed fixture expectation.
- `usd-movements.spec.ts:176`: CLP-to-USD edit uses live rate versus fixed fixture expectation.

These are recorded as baseline failures; the broader UI suite is not reported as fully green. MCP fixtures explicitly control exchange-rate evidence and pass.
