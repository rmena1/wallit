# PRD — Inter-Space Transfers

## Status

Grilled and ready for implementation planning.

## Owner intent

Rai needs to move money from one Space to another without treating that movement as a reportable expense or income. Example: move money from `Personal` into `Casa`; the Personal balance goes down and the Casa balance goes up, but Casa only records a real expense later when that money is spent from a Casa account.

## Domain language

Use `CONTEXT.md` as source of truth.

Canonical term: **Inter-Space Transfer**.
Avoid: `aporte`, `Space contribution`, reportable household expense.

## Accepted product rules

- An Inter-Space Transfer is a Transfer whose source account and destination account belong to different Spaces.
- It is represented by exactly two linked Movements:
  - outgoing Movement in the source Space;
  - incoming Movement in the destination Space.
- Both Movements are Operational Movements and are excluded from normal income/expense reports.
- The transfer appears in both Spaces' movement timelines so balance changes are explainable.
- Creating, updating, or deleting requires the acting User to be a Member of both involved Spaces. Owner role is not required.
- If the User later loses access to one side, the historical Movement remains visible in any still-accessible Space, but the User cannot edit/delete the full transfer unless they have access to both Spaces.
- The source account must belong to the currently active Space the User is viewing.
- The destination Space is selected inside the transfer UI without switching active Space first.
- The destination account must be a real account in the selected destination Space; no floating Space balance is allowed.
- Destination Spaces with no available accounts should be shown as unavailable/disabled choices rather than hidden.
- Different source/destination currencies are allowed using the same normalization rules as existing same-Space transfers.
- A Pending Review Movement can be transformed into an Inter-Space Transfer when the imported bank movement represents money moving to another Space.
- Inter-Space funding summaries, contribution reports, or operational transfer analytics are out of scope for the initial implementation.
- Editing an existing Transfer can change the destination Space and destination account, as long as the acting User is a Member of the previous destination Space and the new destination Space.
- Changing the destination Space of an existing Transfer moves the incoming Movement to the newly selected destination Space and account; the Transfer remains one linked operation.
- Editing a Transfer can change the source account only within the Space that owns the outgoing Movement. Changing transfer direction by moving the source to another Space is not supported; create a new Transfer instead.
- Inter-Space Transfers do not have categories. They are Transfers, not reportable categorized expenses or income.
- Add an explicit Transfer root record that links the source Space, destination Space, outgoing Movement, and incoming Movement. Balances still derive from Movements.
- The explicit Transfer root applies to the unified Transfer model, so same-Space Transfers and Inter-Space Transfers are represented consistently.
- Replace movement-level transfer linkage fields such as `transferId` and `transferPairId` with the explicit Transfer root; do not keep them as legacy parallel ownership/linkage columns.
- Migration must convert all existing valid same-Space transfer pairs into explicit Transfer root rows before dropping legacy movement-level transfer linkage columns.
- Migration must fail fast if existing transfer data is corrupt, incomplete, duplicated, cross-linked incorrectly, missing an outgoing/incoming pair, or otherwise cannot be mapped unambiguously. Do not invent or silently repair transfer history inside the migration.
- The explicit Transfer root should store only data that belongs to the transfer operation itself and is not already owned by one of the linked Movements.
- Do not duplicate movement-owned facts such as date, name/note, amount, currency, account, or category on the Transfer root. There must be one source of truth for each fact.
- Minimal Transfer root metadata should include identity/linkage/permissions fields such as `id`, `sourceSpaceId`, `destinationSpaceId`, `sourceMovementId`, `destinationMovementId`, `createdByUserId`, `createdAt`, and `updatedAt`.
- Transfer display names are movement-owned and can be side-specific. If the user provides a note, derive each side's `movements.name` from that note plus direction context, such as `Transferencia a Casa · Arriendo mayo` and `Transferencia desde Personal · Arriendo mayo`.
- A Transfer uses one date for both linked Movements in the initial implementation. Separate source/destination settlement dates are out of scope.
- When a Pending Review Movement is transformed into a Transfer, the pending Movement becomes the outgoing Movement. Wallit preserves imported-bank context such as source account, date, amount, currency, and original name where applicable, marks it confirmed/operational, removes category, and creates the incoming Movement in the destination Space/account.
- Changes to the Wallit Gmail/import cron are out of scope for this implementation. Future automation can classify imported movements as Inter-Space Transfers later, but this feature should only support explicit user transformation in the app UI.
- Implementation must audit and update every transfer-aware read/write path across the app: dashboard timeline, account detail, reports/reportable filters, review transformation, edit movement, emergency/loan/receivable exclusions, investment performance, E2E helpers, and any query that currently checks movement transfer fields.
- Timeline rows for Inter-Space Transfers must include the other Space name so the balance change is explainable from either side.
- In the source Space timeline, show language like `Transferencia a <Destination Space>`.
- In the destination Space timeline, show language like `Transferencia desde <Source Space>`.

## UI requirements

There is one unified Transfer form. Same-Space Transfers and Inter-Space Transfers are created and edited through the same UI; the only difference is whether the selected destination Space is the current active Space or a different Space.

- Integrate this into all existing transfer creation and transfer editing UIs, not as a separate isolated flow.
- Add a destination Space dropdown to the unified Transfer form.
- The destination Space dropdown defaults to the current active Space.
- The destination account selector must appear below the destination Space selector.
- When the destination Space changes, the destination account selector is repopulated with accounts from the selected Space.
- If the selected destination Space has no accounts, the destination account selector should show an unavailable/empty state and prevent submission.
- Same-Space Transfers are created by leaving the destination Space as the current active Space.
- Inter-Space Transfers are created by choosing a destination Space different from the active Space.
- In edit mode, the same destination Space selector is editable. Changing it repopulates destination accounts from the newly selected Space.
