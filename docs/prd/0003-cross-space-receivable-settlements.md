# PRD — Cross-Space Receivable Settlements

## Status

Draft accepted for implementation planning.

## Owner intent

Rai needs Wallit to support the real household scenario where one Space temporarily pays an expense that economically belongs to another Space, and later another Space pays it back.

Example: the `Casa` Space records a household expense and marks it as **por cobrar** because Rai paid it from his `Personal` money. Later `Personal` sends money to `Casa` or there is already an Inter-Space Transfer from `Personal` into `Casa`. Wallit must let Rai use that payment to settle the receivable without incorrectly treating the payment as reportable income for `Casa` or as a generic operational transfer for `Personal`.

The important product distinction is this: paying a receivable across Spaces is not merely an Inter-Space Transfer. The paying Space is recording a real reportable expense; the funded Space is receiving an operational payment that settles a receivable.

## Domain language

Use `CONTEXT.md` as source of truth.

Canonical terms:

- **Receivable**: an existing reportable Movement in a funded Space that is marked as money to be recovered.
- **Receivable Settlement Expense**: a reportable outgoing expense in the paying Space that pays back another Space for a Receivable that was temporarily funded outside the paying Space.
- **Receivable Settlement**: the workflow relationship linking the original Receivable, the paying Space outgoing expense, the funded Space incoming operational payment, and optionally the consumed original Transfer.
- **Settlement Remainder Transfer**: the remaining operational Transfer after part of an existing Transfer is consumed by a Receivable Settlement.

Avoid:

- treating the settlement as a normal Transfer;
- calling it an `aporte`;
- calling the paying-side expense a reimbursement transfer;
- hiding it from reports in the paying Space.

## Goals

1. Allow a Receivable in one Space to be settled using money paid from another Space.
2. Support two settlement sources:
   - a new direct cross-Space payment created during the settlement flow;
   - an existing incoming Inter-Space Transfer that has not yet been fully consumed by previous settlements.
3. Create the correct accounting effects in both Spaces:
   - paying Space gets a pending reportable expense;
   - funded Space gets an incoming operational settlement payment linked to the Receivable.
4. Keep the user in the funded Space after settlement, so the workflow does not feel like a context switch.
5. Allow one existing Transfer to settle multiple Receivables over time by consuming it partially.
6. Preserve Transfer history when only part of a Transfer is consumed.
7. Fully reverse the workflow when a settlement is deleted.
8. Keep category-based reports correct: paying Space records the real expense; funded Space does not record income.
9. Make edge cases explicit and safe: currencies, tolerance, insufficient amounts, membership, deletion, and concurrent edits.

## Non-goals for MVP

- No automatic bank-import classification for receivable settlements.
- No notifications to members of either Space.
- No consolidated cross-Space settlement report.
- No settlement of multiple Receivables in one submit action.
- No partial settlement of a single Receivable below tolerance; each Receivable is considered settled only when the selected payment amount is within tolerance.
- No responsible-user assignment inside a Space.
- No public invoice/request flow.
- No settlement between users outside Space membership.
- No changing the original Receivable amount as part of settlement.

## Product rules

### Core accounting model

A cross-Space Receivable Settlement creates or consumes balance effects in two Spaces:

1. **Funded Space**: the Space where the original Receivable exists.
   - The original Receivable remains the original reportable expense.
   - The incoming settlement Movement is operational.
   - The incoming settlement Movement settles the Receivable.
   - The incoming settlement Movement does not count as income.

2. **Paying Space**: the Space that pays back the funded Space.
   - Wallit creates a Receivable Settlement Expense.
   - This is a real reportable expense for the paying Space.
   - It starts as a Pending Review Movement, without category.
   - It should appear in the paying Space review queue like any other pending expense.

The paying Space expense copies the original Receivable expense description so the user understands what they are classifying, but it must be independently categorized in the paying Space.

### New direct settlement payment

From an unsettled Receivable in the funded Space, the user can choose another Space as the paying Space.

The flow must collect:

- paying Space;
- source account from the paying Space;
- destination account from the funded Space;
- payment amount;
- payment date.

Rules:

- The destination account always belongs to the funded Space.
- The source account always belongs to the paying Space.
- The payment amount defaults to the Receivable amount.
- The amount is editable.
- On submit, Wallit creates:
  - a pending reportable expense in the paying Space;
  - an incoming operational settlement payment in the funded Space;
  - a Receivable Settlement linking both Movements and the original Receivable.
- After creation, the active Space remains the funded Space.

### Existing Inter-Space Transfer as settlement source

If there is an existing Inter-Space Transfer from another Space into the funded Space, Wallit can consume it to settle a Receivable.

Candidate Transfers:

- must be incoming into the funded Space;
- must come from a different Space;
- must have remaining unconsumed amount;
- should be shown with source Space, source account, destination account, date, description, and remaining available amount;
- should be shown even if they may be insufficient, because the user needs to understand why a payment cannot be used.

Validation happens on selection/submit and must show an actionable error when the available amount is outside tolerance.

When selected, Wallit creates a Receivable Settlement Expense in the paying Space from the consumed amount and an incoming operational payment in the funded Space linked to the Receivable.

### Tolerance

A Receivable can be settled when the available payment amount is within ±5% of the Receivable amount after currency conversion.

Rules:

- The tolerance applies to same-currency and different-currency settlements.
- Differences above 5% are rejected.
- Error messages must include enough context: required amount, available/payment amount, and allowed tolerance.
- The settlement records the real amount paid/received, not the converted expected amount.

### Currency handling

Different currencies are allowed using the same normalization rules as existing transfers.

For a new direct payment:

- the paying-side amount is recorded in the source account currency;
- the funded-side incoming amount is recorded in the destination account currency;
- conversion must use Wallit's existing money normalization/exchange-rate behavior.

For an existing different-currency Transfer:

- partial consumption consumes both sides proportionally;
- the remaining Transfer preserves the original effective exchange rate;
- Wallit must not recompute a new arbitrary rate for the remainder.

### Partial consumption of existing Transfers

One existing Transfer can settle multiple Receivables over time.

When a settlement consumes only part of a Transfer:

- Wallit creates the settlement Movements for the consumed amount;
- the original Transfer remains as a Settlement Remainder Transfer;
- the remaining Transfer keeps original description, date, source/destination Spaces, and accounts;
- only the outgoing and incoming Movement amounts change to the remaining amount.

When a settlement fully consumes a Transfer:

- the original operational Transfer is removed as an active Transfer;
- only the settlement workflow remains;
- the historical settlement relationship records which Transfer was consumed.

### Deletion / reversal

Deleting a Receivable Settlement must reverse the entire workflow safely.

Rules:

- Delete the Receivable Settlement record.
- Delete the outgoing paying Space Receivable Settlement Expense.
- Delete the incoming funded Space operational settlement Movement.
- Restore the original Receivable to unsettled state.
- If the settlement consumed an existing Transfer:
  - restore the consumed amount into that Transfer;
  - if the Transfer was fully consumed and removed, recreate it as the remaining operational Transfer.

Deletion requires access to both involved Spaces.

### Membership and authorization

- Creating a cross-Space settlement requires the acting User to be a Member of the funded Space and the paying Space.
- Owner role is not required.
- Candidate paying Spaces are limited to Spaces where the User is a Member.
- Candidate accounts are limited to accounts in Spaces where the User is a Member.
- If a User loses access to either Space, they may still see historical Movements in any Space they can access, but they cannot edit/delete the settlement unless they have access to both involved Spaces.

### Review behavior

The paying-side Receivable Settlement Expense starts as a Pending Review Movement.

Rules:

- It appears in the paying Space review queue.
- It is reportable after confirmation.
- It must remain an expense.
- It cannot be transformed into another workflow such as emergency, loan, receivable, or transfer.
- It starts without category so the paying Space can classify it correctly.

### Reporting behavior

Funded Space:

- original Receivable remains the reportable expense;
- settlement incoming Movement is operational and excluded from income reports;
- dashboards/timelines should make the settlement explainable.

Paying Space:

- settlement expense is reportable after review confirmation;
- category is chosen in paying Space review;
- reports include it as an expense in the paying Space.

Transfers:

- any remaining operational Transfer is excluded from income/expense reports.

## UX requirements

### Entry points

The user should be able to start settlement from an unsettled Receivable visible in the funded Space, including the home receivables area and any edit/detail flow that already supports marking/settling Receivables.

### Settlement dialog / flow

The settlement UI should make two options clear:

1. **Create new payment from another Space**
   - choose paying Space;
   - choose source account;
   - choose destination account in current/funded Space;
   - set amount/date;
   - submit.

2. **Use existing incoming Transfer**
   - list incoming Inter-Space Transfers into this Space;
   - show source Space and remaining available amount;
   - allow selecting a candidate;
   - validate coverage/tolerance on submit.

The UI should not force the user to switch active Space before or after settlement.

### Labels and copy

Suggested Spanish labels:

- `Saldar por cobrar`
- `Pagar desde otro Space`
- `Usar transferencia existente`
- `Space que paga`
- `Cuenta origen`
- `Cuenta destino en este Space`
- `Monto pagado`
- `Disponible para saldar`
- `Quedará como gasto pendiente de revisión en <Space>`

The copy must clarify that the paying Space will review/category-classify the expense later.

### Empty/error states

- If there are no other Spaces, show that another Space is required.
- If the paying Space has no accounts, disable submission and explain that it needs an account.
- If the funded Space has no destination account, disable submission and explain that the current Space needs an account to receive the settlement.
- If an existing Transfer is insufficient, show available amount, required amount, and tolerance.
- If the Receivable is already settled, prevent duplicate settlement.

## Data/model requirements

Add an explicit Receivable Settlement relationship that can represent both direct new payments and settlements that consume an existing Transfer.

Minimum fields to evaluate:

- `id`
- `receivableId`
- `fundedSpaceId`
- `payingSpaceId`
- `outgoingMovementId`
- `incomingMovementId`
- `consumedTransferId` nullable
- consumed source/destination amounts and currencies when needed for restoration
- `createdByUserId`
- `createdAt`
- `updatedAt`

Indexes/constraints:

- unique settlement per Receivable;
- unique outgoing settlement Movement;
- unique incoming settlement Movement;
- index by funded Space;
- index by paying Space;
- index by consumed Transfer.

The model should support safe deletion/restoration without guessing from current Movement state alone.

## Ledger/invariant requirements

Implementation must go through the Movement Ledger seam, not generic field edits.

Required invariants:

- every Movement affects exactly one account;
- every Movement is either reportable or operational for reports;
- Receivable Settlement Expense is always reportable expense in the paying Space;
- incoming settlement Movement is always operational in the funded Space;
- one Receivable can have at most one active Receivable Settlement;
- one settlement links exactly one original Receivable, one outgoing paying Movement, and one incoming funded Movement;
- consumed Transfer amounts cannot go negative;
- partial consumption preserves the original Transfer's effective exchange rate;
- deleting the settlement restores all balance effects exactly once;
- concurrent attempts to settle the same Receivable or consume the same Transfer must be serialized or rejected safely.

## Acceptance criteria

- User can settle a Receivable from a different Space by creating a new payment.
- User can settle a Receivable using an existing incoming Inter-Space Transfer.
- Paying Space gets a pending expense that appears in its review queue.
- Paying Space expense becomes reportable after confirmation.
- Funded Space receives an operational incoming payment that does not count as income.
- The original Receivable is no longer shown as unsettled after settlement.
- The user stays in the funded Space after settlement.
- A Transfer can be partially consumed, leaving a correct Settlement Remainder Transfer.
- A Transfer can be fully consumed, removing the remaining operational Transfer.
- Multiple Receivables can be settled from one Transfer one at a time.
- Same-currency and different-currency settlements respect the 5% tolerance.
- Deleting a settlement reverses both Movements and restores any consumed Transfer amount.
- User without membership in both Spaces cannot create/delete/edit the settlement.
- Reports exclude operational settlement receipts and include paying-side settlement expenses.

## Required E2E coverage

Create/maintain Playwright coverage with screenshots for:

1. Direct cross-Space Receivable Settlement from another Space.
2. Paying-side expense appears as pending review in the paying Space.
3. Confirming the paying-side expense makes it reportable.
4. Funded-side incoming settlement does not count as income.
5. Existing incoming Transfer fully consumed to settle a Receivable.
6. Existing incoming Transfer partially consumed, leaving a Settlement Remainder Transfer.
7. One existing Transfer settling multiple Receivables one at a time.
8. Different-currency settlement within tolerance.
9. Different-currency or same-currency settlement rejected outside tolerance.
10. Deleting a settlement restores the Receivable and consumed Transfer amount.
11. User remains in funded Space after creating a cross-Space settlement.
12. Authorization failure when the User lacks membership in one involved Space.

Screenshots should capture the settlement dialog, validation errors, post-settlement funded Space timeline, paying Space review queue, and reports where relevant.

## Open questions

None blocking from the product discussion captured so far.

Implementation may still need to inspect current schema/actions to decide exact column names and migration shape, but the domain rules above are the source of truth.
