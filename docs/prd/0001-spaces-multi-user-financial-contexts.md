# PRD — Spaces: multi-user financial contexts for Wallit

## Status

Draft accepted for implementation planning.

## Owner intent

Wallit currently behaves as a single-user personal finance app: a signed-in user owns bank accounts, movements, categories, reports, receivables, emergency expenses, loans, and related workflows directly.

Rai is going to live with his partner and needs Wallit to support multiple financial contexts for the same user:

- a private personal context;
- a shared household context;
- potentially other shared contexts later.

The new concept is called **Space**. A Space is not a bank account. Existing bank accounts remain the current `Account` concept. A Space is the financial context that contains bank accounts and all financial data.

This is a big-bang feature: implement the full migration and UI in one feature branch/commit, but the implementation agent must work internally in phases and verify each layer carefully.

## Goals

1. Introduce **Spaces** as the ownership boundary for all financial data.
2. Allow each User to belong to one or more Spaces.
3. Automatically create a private default personal Space for every User.
4. Migrate existing production data into each User’s default personal Space.
5. Allow Users to create additional Spaces with name + emoji.
6. Allow an Owner to add existing Users to non-personal Spaces by email.
7. Allow Members to leave a Space.
8. Allow the Owner to remove Members from a Space.
9. Allow the Owner to archive a Space.
10. Add a global Space selector in the app navigation/header.
11. Scope every financial read and write by the active Space.
12. Preserve existing financial behavior inside a selected Space: accounts, movements, balances, transfers, review, reports, receivables, emergency expenses, loans, categories, investment accounts, credit cards, USD handling, and E2E-covered flows should continue working as they do today, but inside the selected Space.

## Non-goals for MVP

- No consolidated reports across multiple Spaces.
- No comparisons between Spaces.
- No realtime membership notifications.
- No invitation/pending-invite flow.
- No public invite links.
- No archived Spaces UI.
- No ownership transfer.
- No multiple Owners per Space.
- No per-movement/per-debt responsible person.
- No viewer/read-only role.
- No cross-Space transfers.
- No attempt to redesign the entire navigation beyond adding Space selection.
- No legacy parallel ownership model for financial data.

## Domain language

Use the language in `CONTEXT.md`. Important terms:

- **User**: person who signs in.
- **Space**: financial context containing bank accounts, categories, movements, reports, debts, and follow-up workflows. Has name + emoji.
- **Membership**: grants a User access to a Space. Has role: Owner or Member.
- **Owner**: the single member who administers a Space. Can add/remove Members, edit Space metadata, and archive the Space.
- **Member**: can use the Space day-to-day, including creating/editing financial data, but cannot manage members or archive the Space.
- **Account**: existing Wallit bank account concept. Do not rename this to Space.
- **Movement**: existing atomic account-level money movement.

Important ADR: `docs/adr/0001-financial-data-owned-by-space.md`.

## Core product rules

### Space creation

- Every new User gets a default personal Space automatically.
- Default personal Space:
  - name: `Personal`
  - emoji: `👤`
  - not shareable
  - owner: the User
- Existing users/data must be migrated into a default personal Space.
- A User can create additional non-personal Spaces from Settings.
- Creating a Space requires:
  - name
  - emoji
- No color field for Spaces in MVP.
- When a User creates a Space:
  - the creator becomes the sole Owner;
  - the Space becomes active/selected;
  - categories from the creator’s default personal Space are copied into the new Space;
  - copied categories are independent records in the new Space.

### Space name uniqueness

A User cannot have access to two active Spaces with the same normalized name.

Normalization:

- trim leading/trailing whitespace;
- compare case-insensitively.

Rules:

- Creating a Space with a name already available to that User is not allowed.
- Adding a User to a Space is not allowed if that User already has access to another active Space with the same normalized name.
- In that sharing conflict, show an actionable error telling the Owner to rename the Space first.
- Archived Spaces do not count for active-name uniqueness in the MVP unless implementation finds that excluding them creates data ambiguity. If the agent chooses to include archived Spaces in uniqueness, it must document why.

### Membership and roles

- A Space has exactly one Owner.
- Ownership is not transferable.
- Owner cannot leave a Space.
- Owner can archive the Space.
- Owner can add existing Users by email.
- Owner can remove Members.
- Member can leave a Space.
- Member cannot remove other Members.
- Member cannot archive the Space.
- Member cannot manage membership.
- Members can do all financial operations in the Space:
  - create/edit/delete bank accounts subject to current rules;
  - create/edit/delete categories subject to current rules;
  - create/edit/delete/reclassify movements subject to current Movement Ledger rules;
  - use review queue;
  - create/edit/delete transfers subject to current rules;
  - mark receivables/emergencies/loans and settle them subject to current rules;
  - view reports and dashboards.

### Adding members

MVP flow: add by email, no invitation.

- Owner enters email in Settings.
- If email belongs to an existing User:
  - create Membership immediately, unless blocked by validation.
- If email does not belong to an existing User:
  - show error. No pending invite is created.
- Cannot add someone to a personal default Space.
- Cannot add someone already in the Space.
- Cannot add someone if it would cause active Space name collision for that User.
- Added User sees the Space in the dropdown after refresh/reload. No realtime required.

### Leaving/removing/archive

- Member can leave a Space.
- Owner cannot leave.
- Owner can remove Members.
- Owner cannot remove themselves.
- Owner can archive Space.
- Archiving hides the Space from normal use for all members.
- Archiving does not delete financial history.
- Archived Spaces are not shown in the MVP UI.
- If a User’s active Space becomes archived or unavailable, app falls back to personal Space.

### Active Space selection

Use cookie + fallback.

- Active Space is stored in a cookie.
- No Space ID in route path for MVP.
- If cookie is missing, invalid, archived, or points to a Space unavailable to the current User, resolve active Space to the User’s default personal Space.
- Optional: show small notification/banner when fallback happens because prior Space is no longer available.
- Switching Space in dropdown updates cookie and refreshes current route.
- When active Space changes:
  - keep same route if meaningful for new Space;
  - detail pages for unavailable data must redirect home or show safe not-found and navigate home.

### Global vs Space-scoped concepts

Global:

- User
- session/auth
- list of Spaces available to User
- current active Space cookie

Space-scoped:

- bank accounts
- categories
- movements
- pending review movements
- transfers
- reports
- receivables
- emergency expenses
- loans
- investment accounts/snapshots
- credit cards/credit limits
- balances/liquidity
- all financial settings

### Financial data ownership model

This is not a legacy-compatible half step.

- Financial data should be owned by `spaceId`, not `userId`.
- Financial records may keep `createdByUserId` for audit/debugging.
- Do not keep financial `userId` fields as parallel authorization fields.
- Authorization for financial data must be via Membership in the Space.
- Auth/session tables still use `userId` normally.

Expected tables to evaluate/migrate:

- users: keep user identity fields.
- sessions: keep user identity fields.
- spaces: new.
- space_memberships: new.
- accounts: replace financial owner `userId` with `spaceId`; add `createdByUserId`.
- categories: replace financial owner `userId` with `spaceId`; add `createdByUserId`.
- movements: replace financial owner `userId` with `spaceId`; add `createdByUserId`.
- investment_snapshots: scope by `spaceId` or derive safely from account; remove direct financial owner `userId`; add/keep created metadata only if useful.
- emergency_payments: ensure access derives through Space; add `spaceId` if needed for query safety/performance, or ensure joined ownership is unambiguous.
- exchange_rates: global; no Space.

The implementation agent must inspect actual schema/actions before deciding exact column layout, but the authorization and query boundary must be Space membership.

## UX requirements

### Navigation/header

Add a Space selector visible in the app shell/header/navbar.

Minimum behavior:

- Shows current Space emoji + name.
- Dropdown lists non-archived Spaces available to current User.
- Selecting a Space updates cookie and refreshes current route.
- If route is no longer valid in selected Space, app safely returns home.
- Personal Space should be easy to identify as `👤 Personal`.

### Settings — Spaces section

Add a Settings section for Space management.

Required capabilities:

For all Users:

- See current Space metadata.
- Create new Space with name + emoji.
- Switch Spaces via global selector, not necessarily inside settings.

For non-personal Space Owner:

- Edit Space name + emoji.
- Add existing User by email as Member.
- See Members list.
- Remove Members.
- Archive Space.

For Member:

- See Members list.
- Leave Space.
- Cannot add/remove members.
- Cannot archive Space.

For personal default Space:

- Cannot share/add members.
- Cannot leave.
- Probably cannot archive. If implementation decides personal Space can be archived, that is a product bug unless explicitly approved.
- Can likely edit name/emoji? Recommendation: do not allow renaming personal Space in MVP to avoid uniqueness/confusion around `Personal`. If implementation wants to allow it, it must document and test it.

### Errors and empty states

Required user-facing errors:

- Space name required.
- Space emoji required or defaulted safely.
- Space name already exists for this User.
- User not found for email.
- User already belongs to this Space.
- Cannot add user because they already have a Space with this name.
- Personal Space cannot be shared.
- Only Owner can manage members.
- Owner cannot leave Space.
- Owner cannot remove themselves.
- Only Owner can archive Space.
- Archived/unavailable Space fallback to personal Space.

## Data migration requirements

Migration must be safe for existing production data.

For every existing User:

1. Create default personal Space if missing.
2. Create Owner Membership for that User.
3. Move all existing financial records owned by that User into that Space.
4. Preserve existing financial behavior and historical values.
5. Set `createdByUserId` to the original User where applicable.
6. Ensure future financial reads/writes use Space, not User ownership.

Migration must be idempotent or safely guarded if run once by deployment tooling. If Drizzle migrations are used, ensure the SQL handles existing data deterministically.

Important: production is Railway/Postgres. Do not rely on local-only assumptions.

## Server/auth requirements

Introduce helpers for Space resolution and authorization.

Recommended helpers:

- `requireAuth()` remains user auth.
- `getAvailableSpaces(userId)` returns active Spaces for User.
- `getDefaultPersonalSpace(userId)` creates/returns default personal Space as needed.
- `resolveCurrentSpace(userId)` reads cookie and validates Membership; fallback to default personal Space.
- `requireCurrentSpace()` returns `{ user, space, membership }` for server actions/read models.
- `requireSpaceOwner(spaceId, userId)` or similar for member management/archive.
- `assertAccountInSpace(accountId, spaceId)`
- `assertCategoryInSpace(categoryId, spaceId)`
- `assertMovementInSpace(movementId, spaceId)`

Rules:

- Never trust `spaceId` from client directly without checking Membership.
- Server actions that mutate financial data must resolve active Space server-side.
- If an action receives IDs, it must ensure those IDs belong to active Space.
- Transfers must ensure both accounts are in active Space.
- Reports must query active Space only.
- Review queue must query active Space only.

## Movement Ledger requirements

The Movement Ledger was recently introduced as the write seam below server actions. Preserve that architecture.

Expected changes:

- Ledger methods should take `spaceId` and `actorUserId` or a context object, not financial owner `userId`.
- Membership authorization should happen at or before server action boundary.
- Ledger invariants remain unchanged:
  - every Movement affects exactly one bank account;
  - every Movement is reportable or operational, not both;
  - Transfer has exactly two linked Movements;
  - dependent workflows resolve explicitly;
  - money values normalize consistently across currencies;
  - operational workflows remain mutually exclusive.
- Add/keep createdByUserId when recording new movements.

## Read model/reporting requirements

Every read model must be audited for `userId` filters and converted to Space scoping.

Important areas:

- dashboard/home
- account detail pages
- movements pagination
- balances and liquidity
- reports
- category reports
- review queues
- receivables
- emergency expenses/payments
- loans/paybacks
- transfer list/edit
- settings lists for accounts/categories/spaces

Reports must not include data from other Spaces available to same User unless consolidated reports are explicitly added later. MVP reports are selected-Space only.

## Automatic imports / future email bot

MVP does not need to fully solve bank email imports across Spaces.

Rule:

- Automatic imports must resolve a Space explicitly before creating movements.
- If they cannot resolve one, they should avoid guessing and use a defined fallback such as default personal Space or a personal inbox.
- If existing code imports/pending-review movements without UI active Space, the implementation must choose the safest current behavior and document it.

Recommended MVP fallback:

- Manual UI-created movements use active Space.
- Existing import-like flows without explicit Space default to User’s personal Space until a later import-routing feature exists.

## Acceptance criteria

### Core migration

- Existing User can log in after migration and sees all previous data in `👤 Personal`.
- Existing bank accounts, balances, movements, categories, reports, receivables, emergencies, loans, transfers, investments and credit card behavior remain correct inside Personal.
- No financial data remains authorized by legacy `userId` ownership.
- Financial data tables use `spaceId` and, where relevant, `createdByUserId`.

### Space selector

- User sees Space selector in app header/navbar.
- Selector lists all active Spaces available to User.
- Switching Space updates visible data across the app.
- Invalid cookie falls back to Personal.
- Removed/archived Space falls back to Personal.

### Space creation

- User can create new Space with name + emoji in Settings.
- New Space becomes selected after creation.
- New Space copies categories from User’s Personal Space.
- User cannot create duplicate active Space name for themselves, case-insensitive/trimmed.

### Sharing

- Owner can add existing User by email to non-personal Space.
- Added User sees Space after refresh.
- Owner cannot add non-existing email.
- Owner cannot add User if User would have duplicate active Space name.
- Owner cannot share Personal Space.
- Member cannot add users.

### Membership management

- Member can leave shared Space.
- Owner cannot leave Space.
- Owner can remove Member.
- Owner cannot remove themselves.
- Ownership cannot be transferred.
- Owner can archive non-personal Space.
- Archived Space disappears for all members.
- No archived Space UI is required.

### Financial scoping

- Bank accounts are Space-scoped.
- Categories are Space-scoped and shared by Space members.
- Movements are Space-scoped.
- Pending review is Space-scoped.
- Transfers only happen within same Space.
- Reports are Space-scoped.
- Receivables/emergencies/loans are Space-scoped and have no responsible User.
- Members can create/edit financial data in shared Space.
- Financial detail pages cannot leak data from other Spaces.

### Security

- User cannot access Space they are not a member of.
- User cannot mutate bank accounts/categories/movements from Spaces they are not a member of.
- Member cannot manage membership/archive.
- Owner-only actions are enforced server-side, not only hidden in UI.
- Personal Space cannot be shared server-side.
- Duplicate Space-name rule is enforced server-side.

### Verification

Required before calling implementation done:

- `npm run build` passes.
- Full E2E via `/home/jarvis/.openclaw/workspace/.e2e-tools/run-wallit-e2e.sh` passes with workers=1.
- Existing E2E flows still pass.
- New E2E coverage exists for Spaces.
- Screenshots produced for new UI flows.
- `IMPLEMENTATION_REPORT.md` updated with build/E2E results and any blockers.

## Required E2E coverage

Add Playwright tests with screenshots for at least:

1. New user registration creates `👤 Personal` Space and existing basic financial flow works.
2. Existing user/migrated data appears in Personal after migration in test setup.
3. Create Space with name + emoji; it becomes selected.
4. Categories from Personal are copied to new Space and are independent.
5. Space selector switches between Personal and shared/new Space; dashboard data changes.
6. Duplicate Space name is rejected with trim/case-insensitive behavior.
7. Owner adds existing User by email; added User sees Space after reload.
8. Cannot add non-existing User email.
9. Cannot add User when Space name collision would occur.
10. Personal Space cannot be shared.
11. Member can create bank account/category/movement in shared Space.
12. Member cannot add/remove members or archive Space.
13. Member can leave Space.
14. Owner can remove Member.
15. Owner cannot leave Space.
16. Owner can archive shared Space; it disappears for all members.
17. Invalid/unavailable Space cookie falls back to Personal.
18. Transfer cannot cross Spaces; only same-Space accounts are selectable/valid.
19. Reports only show selected Space data.
20. Review queue only shows selected Space pending movements.
21. Detail pages for data outside active Space do not leak data and redirect/show safe state.

Use existing helper patterns and robust semantic locators. Avoid brittle broad text selectors when text appears multiple times.

## Suggested implementation phases for the agent

This is a big-bang feature externally, but implement internally in phases.

### Phase 0 — Baseline and plan

- Read `CONTEXT.md`, ADR, this PRD.
- Inspect schema, auth, server actions, read models, tests.
- Run or verify current build/E2E baseline if needed.
- Do not start coding before identifying all places where `userId` currently scopes financial data.

### Phase 1 — Schema and migration

- Add Spaces and Memberships.
- Replace financial ownership with Space scoping and createdByUserId.
- Add migration for existing data.
- Ensure default personal Space creation for existing and new Users.

### Phase 2 — Space resolution/auth helpers

- Add current Space cookie helpers.
- Add server-side membership validation.
- Add available Spaces list and selector data.
- Add owner/member authorization helpers.

### Phase 3 — Server actions and Movement Ledger

- Convert server actions from User-owned financial data to Space-scoped financial data.
- Convert Movement Ledger to Space context.
- Ensure all ID references are validated within active Space.
- Ensure transfer, review, receivable, emergency, loan workflows stay correct.

### Phase 4 — Read models/pages

- Convert all read queries to Space scoping.
- Add safe fallback/redirect behavior for detail pages.
- Keep existing behavior inside active Space.

### Phase 5 — UI

- Add Space selector in navbar/header.
- Add Settings Spaces section.
- Add create/edit/archive/member management UI.
- Add errors and empty states.

### Phase 6 — E2E and hardening

- Add required Space E2E tests.
- Update existing tests for Space selector/default Space.
- Run build and full E2E.
- Fix failures as product bugs unless test is clearly brittle.
- Write implementation report.

## Reviewer checklist

Reviewers should verify:

- No financial query still authorizes by legacy `userId` ownership.
- Financial records are Space-scoped consistently.
- `createdByUserId` is audit metadata, not authorization.
- Members cannot perform Owner-only actions via direct server action calls.
- Personal Space cannot be shared, archived, or left.
- Duplicate Space-name logic is enforced server-side.
- Adding a member by email does not create pending invites.
- Space selector cannot select unauthorized/archived Spaces.
- Invalid cookie fallback cannot leak previous Space data.
- Transfers cannot cross Spaces.
- Reports/review/dashboard/account pages cannot mix Spaces.
- Existing movement ledger invariants still hold.
- Migration is safe for existing production data.
- Full E2E is green and includes new Space flows.

## Open risks

- This is a large migration touching almost every financial query. The highest risk is missing one `userId` filter or leaving a mixed `userId`/`spaceId` authorization path.
- Existing production data must be migrated correctly. A dry-run-like local verification with realistic seeded data is valuable.
- E2E suite may need substantial updates because every flow now has a Space context.
- Automatic import/email workflows may need a safe fallback until they become Space-aware.

## Final implementation instruction

When this PRD is handed to an implementation agent:

- Use `openai-codex/gpt-5.5` with thinking `high`.
- Implement via subagent; do not hand-edit from the parent orchestration session.
- Work in big-bang scope but internally by phases.
- Do not commit, push, deploy, or touch production unless Rai explicitly asks.
- Exclude generated `e2e-results/**` and `e2e-report/**` from commits unless explicitly requested.
- Finish only after build + full E2E pass and `IMPLEMENTATION_REPORT.md` is updated.
