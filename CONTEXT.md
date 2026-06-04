# Wallit

Wallit tracks Rai's personal finances by recording money movements across accounts and deriving balances, liquidity, reports, debts, and follow-up workflows from those movements.

## Language

**Movement**:
An atomic movement of money that affects the balance of exactly one account.
_Avoid_: Transaction, record, entry

**Transfer**:
A movement of money between two accounts, represented by exactly two linked **Movements**: one outgoing movement from the source account and one incoming movement into the destination account.
_Avoid_: Single movement transfer, contribution, aporte

**Inter-Space Transfer**:
A **Transfer** whose source account and destination account belong to different **Spaces**.
_Avoid_: Space contribution, aporte a Space

**Receivable Settlement Expense**:
A reportable expense in one **Space** that pays back another **Space** for a **Receivable** that was temporarily funded outside the paying **Space**.
_Avoid_: Transfer, reimbursement transfer, aporte

**Settlement Remainder Transfer**:
The remaining operational **Transfer** after part of an existing **Transfer** is consumed to create a **Receivable Settlement Expense**.
_Avoid_: Partial debt payment, leftover debt movement

**Receivable Settlement**:
The workflow relationship that links a settled **Receivable**, the outgoing **Receivable Settlement Expense**, the incoming operational payment, and optionally the consumed original **Transfer**.
_Avoid_: Transfer, payment pair, debt transfer

**Pending Review Movement**:
A **Movement** with provisional or incomplete classification that already affects an account balance but should be excluded from category-based reporting until confirmed.
_Avoid_: Draft movement, import row

**Operational Movement**:
A **Movement** that affects account balances but should not be counted as income or expense in financial reports.
_Avoid_: Real income, real expense

**Reportable Movement**:
A confirmed **Movement** that represents real income or expense for financial reporting.
_Avoid_: Normal movement, categorized movement

**Space**:
A financial context that groups bank accounts, movements, categories, reports, debts, and follow-up workflows. A person can use a personal **Space** and shared **Spaces** such as a household. A **Space** has a name and emoji.
_Avoid_: Account, Workspace

**Membership**:
The relationship that gives a **User** access to a **Space**. A **Membership** has a role: **Owner** or **Member**.
_Avoid_: Shared account

**Owner**:
A **Space** member who can administer the **Space**, including inviting/removing members, editing the **Space** name, and deleting or archiving the **Space**.
_Avoid_: Admin, Superuser

**Member**:
A **Space** member who can use the **Space** day-to-day: create and edit bank accounts, categories, movements, reports, debts, and follow-up workflows, but cannot administer membership or delete/archive the **Space**.
_Avoid_: Viewer

## Relationships

- A **User** can belong to one or more **Spaces** through **Memberships**.
- Each **User** has one default personal **Space** created automatically.
- The default personal **Space** is named `Personal` and uses the `👤` emoji.
- A **User** cannot have access to two active **Spaces** with the same name.
- **Space** names are compared after trimming whitespace and ignoring case.
- Creating a **Space** with a name already available to that **User** is not allowed.
- Adding a **User** to a **Space** is not allowed if that **User** already has access to another active **Space** with the same name; the **Owner** must rename the **Space** first.
- A default personal **Space** cannot be shared with other **Users**.
- Existing financial data is migrated into each **User**'s default personal **Space**.
- A **Space** can have one or more **Users** as members.
- A **Space** has exactly one **Owner**.
- An **Owner** can add an existing **User** to a **Space** by email; membership is created immediately, without an invitation flow.
- A newly available **Space** appears for the added **User** after the app is refreshed or reloaded; Wallit does not need realtime membership notifications in the MVP.
- A **Member** can leave a **Space**.
- An **Owner** cannot leave a **Space**; the **Owner** can only archive the **Space**.
- Archiving a **Space** hides it from normal use for all members without deleting its financial history.
- Archived **Spaces** are not exposed in the MVP UI.
- Ownership is not transferable.
- An **Owner** can remove another **Member** from a **Space**.
- Bank accounts, categories, movements, reports, debts, and follow-up workflows belong to a **Space**.
- Debts and follow-up workflows belong to the **Space** as a whole and do not have an assigned responsible **User** in the MVP.
- Bank accounts, categories, movements, and Spaces record which **User** created them with `createdByUserId`, without changing edit permissions inside the **Space**.
- Financial data is scoped by `spaceId`, not by `userId`; the Space migration should replace financial-data ownership fields with `spaceId` and `createdByUserId` rather than keeping legacy user-owned fields.
- Migrations that replace financial relationship models must migrate valid existing data and fail fast when existing data cannot be mapped unambiguously.
- Authentication data still belongs to the **User**: users, sessions, and memberships keep user identity fields. The `userId` removal applies to financial data ownership, not authentication.
- The selected **Space** scopes the app: dashboard, bank accounts, categories, movements, pending review, review, transfers, reports, receivables, emergency expenses, loans, and settings for financial data all operate inside the selected **Space**.
- The MVP does not include consolidated reporting or comparisons across multiple **Spaces**.
- Automatic imports must resolve a **Space** explicitly before creating movements; if they cannot, they should avoid guessing and use a defined fallback such as the default personal **Space** or a personal inbox.
- The active **Space** is selected with a cookie. If the cookie is missing, invalid, archived, or points to a **Space** the **User** cannot access, Wallit falls back to the **User**'s default personal **Space**.
- When Wallit falls back because the previously selected **Space** is no longer available, the app may show a small notification explaining that the **User** was moved back to the personal **Space**.
- When the active **Space** changes, Wallit keeps the current route when that route is meaningful for the new **Space**; detail routes for data unavailable in the new **Space** redirect back to home.
- The only global concepts are the **User** and the list of **Spaces** available to that **User**.
- Categories are shared within a **Space**, not owned privately by individual users inside that **Space**.
- When a **User** creates a new **Space**, Wallit copies the categories from that **User**'s default personal **Space** into the new **Space**. The copied categories become independent categories in the new **Space**.
- A **Movement** belongs to exactly one account and always affects that account's balance.
- A **Transfer** is composed of exactly two linked **Movements** through an explicit **Transfer** root.
- A **Transfer** root stores only operation identity and linkage metadata; movement-owned facts such as date, name, amount, currency, account, and category live only on the linked **Movements**.
- A **Transfer** has one outgoing **Movement** and one incoming **Movement**.
- A **Transfer** can move money between bank accounts inside the same **Space** or across two different **Spaces**.
- An **Inter-Space Transfer** is still one **Transfer** with exactly two linked **Movements**: the outgoing **Movement** belongs to the source **Space**, and the incoming **Movement** belongs to the destination **Space**.
- Creating, updating, or deleting an **Inter-Space Transfer** requires the acting **User** to be a **Member** of both involved **Spaces**; **Owner** role is not required.
- Same-Space **Transfers** and **Inter-Space Transfers** are created through one unified **Transfer** flow; the destination **Space** determines whether the **Transfer** is same-Space or inter-Space.
- An **Inter-Space Transfer** starts from a source account in the currently selected active **Space** and selects a destination **Space** plus destination account without requiring the **User** to switch active **Space** first.
- The source account of an **Inter-Space Transfer** must belong to the active **Space** the **User** is currently viewing.
- A **Pending Review Movement** is a **Movement** and affects account balance before confirmation.
- A **Pending Review Movement** is excluded from category-based reporting until it becomes confirmed.
- A **Pending Review Movement** becomes a **Reportable Movement** after confirmation, unless it is transformed into an operational workflow during review.
- Transforming a **Pending Review Movement** into another kind of workflow must happen through an explicit domain operation, not by freely editing independent fields.
- A confirmed **Movement** may also be transformed into an operational workflow after confirmation, but only through an explicit domain operation.
- A **Movement** with existing dependent relationships cannot be freely transformed until those relationships are resolved by the relevant domain operation.
- Callers should transform **Movements** through explicit domain operations with narrow write interfaces, not by freely updating persistence fields.
- Movement writes and movement reads are separate concerns: write modules perform domain operations, while read modules prepare balances, reports, timelines, and review queues for screens.
- Movement write operations must preserve Ledger invariants: every **Movement** affects exactly one account, every **Movement** is either reportable or operational for reporting, every **Transfer** has exactly two linked Movements through a single canonical **Transfer** root, dependent relationships are resolved explicitly, and money values are normalized consistently across currencies.
- Deleting a **Movement** must be expressed through a specific domain operation, not a generic public delete: pending movements, reportable movements, transfers, receivables, emergencies, and loans have different deletion rules.
- Updating a **Movement** must be expressed through a specific domain operation, not a generic public field update. A generic update may exist temporarily as internal implementation during migration, but it must be removed before the Movement Ledger refactor is considered complete.
- The Movement Ledger seam lives below server actions: UI calls thin server actions, server actions authenticate and parse input, and the Ledger owns domain operations, invariants, and transactions.
- A **Transfer** is made of **Operational Movements** and does not count as income or expense in reports.
- An **Inter-Space Transfer** affects balances in both involved **Spaces** but is excluded from income/expense reports in both **Spaces**.
- An **Inter-Space Transfer** appears in the movement timeline of both involved **Spaces** so each balance change is explainable.
- Timeline labels for an **Inter-Space Transfer** include the other **Space**: source side reads as transfer to the destination **Space**, and destination side reads as transfer from the source **Space**.
- Inter-Space funding summaries, contribution reports, or operational transfer analytics are outside the initial **Inter-Space Transfer** scope.
- A **Pending Review Movement** can be transformed into an **Inter-Space Transfer** when the imported bank movement represents money moving to another **Space**.
- An **Inter-Space Transfer** must have a real destination account in the destination **Space**; Wallit does not create transfers to a Space-level floating balance.
- Destination **Spaces** without available destination accounts are shown as unavailable choices rather than hidden, so the **User** understands why they cannot transfer there yet.
- An **Inter-Space Transfer** is edited or deleted as one operation; changing or deleting it from either involved **Space** updates or removes both linked **Movements**.
- Editing a **Transfer** can change its destination **Space** and destination account when the acting **User** remains a **Member** of the required **Spaces**.
- Editing a **Transfer** can change the source account only within the **Space** that owns the outgoing **Movement**; changing the source **Space** means creating a different **Transfer**.
- If a **User** loses access to one side of an **Inter-Space Transfer**, the historical **Movement** remains visible in any still-accessible **Space**, but the **User** cannot edit or delete the **Inter-Space Transfer** unless they have access to both involved **Spaces**.
- An **Inter-Space Transfer** supports different source and destination currencies using the same money-normalization rules as a same-Space **Transfer**.
- An **Inter-Space Transfer** does not have a category, because it is an operational **Transfer**, not reportable income or expense.
- Receivables, emergency expenses, loans, loan paybacks, and similar tracking workflows use **Movements** for balance effects but are excluded from income/expense reports.
- A **Receivable Settlement Expense** is not a **Transfer**: it is a reportable outgoing **Movement** in the paying **Space** and a receivable-settling payment for the funded **Space**.
- A **Receivable Settlement Expense** can be created directly from an account in another **Space** or by transforming an existing **Transfer** into the settlement workflow.
- A **Receivable Settlement Expense** copies the original receivable expense description into the paying **Space**, but starts without category so the paying **Space** can classify it during review.
- A **Receivable Settlement Expense** starts as a **Pending Review Movement** in the paying **Space**, whether it is created from a new payment or transformed from an existing **Transfer**.
- A **Receivable Settlement Expense** appears in the paying **Space**'s normal review queue like any other **Pending Review Movement**.
- A **Receivable Settlement Expense** uses the real payment date: for an existing **Transfer**, it uses the original **Transfer** date; for a new payment, it uses the newly entered payment date.
- The incoming **Movement** in the funded **Space** remains an operational receivable-settling payment, is linked to the original **Receivable**, is not pending review, and does not count as income.
- A **Receivable** can be settled by a payment whose available amount is within a 5% tolerance of the **Receivable** amount after currency conversion; differences above that tolerance are not allowed.
- The 5% settlement tolerance applies to same-currency and different-currency payments.
- A **Receivable Settlement Expense** records the real amount paid by the paying **Space**, not the converted expected value of the original **Receivable**.
- The incoming operational **Movement** linked to the settled **Receivable** records the real amount received by the funded **Space**, not the converted expected value of the original **Receivable**.
- Creating a new cross-Space receivable settlement creates both balance effects: a pending outgoing expense in the paying **Space** and an incoming operational receivable-settling **Movement** in the funded **Space**.
- A **Receivable Settlement** explicitly links the original **Receivable**, the paying **Space** outgoing **Receivable Settlement Expense**, the funded **Space** incoming operational payment, and the consumed original **Transfer** when one was used.
- Deleting a **Receivable Settlement** deletes the settlement and the two settlement **Movements** it created: the outgoing paying **Space** movement and the incoming funded **Space** movement.
- If a deleted **Receivable Settlement** consumed an existing **Transfer**, the consumed amount is restored into that **Transfer**; if the **Transfer** had been fully consumed and removed, it is recreated as the remaining operational **Transfer**.
- A new cross-Space receivable settlement chooses a paying **Space**, a source account from that paying **Space**, and a destination account from the funded **Space**.
- The destination account of a receivable settlement always belongs to the **Space** where the **Receivable** is being settled.
- A new cross-Space receivable settlement amount is editable, defaults to the receivable amount, and must stay within the 5% settlement tolerance when submitted.
- Existing **Transfers** from another **Space** into the funded **Space** can be selected as existing payments for settling a **Receivable**.
- Existing **Transfers** shown as settlement candidates display the source **Space** and the remaining available amount.
- Existing **Transfers** are shown as settlement candidates even when their available amount may not cover the selected **Receivable**; Wallit validates coverage when the **User** selects one and explains insufficiency as an error with the available amount, required amount, and tolerance.
- After a **Receivable Settlement Expense** is created from another **Space**, Wallit keeps the **User** in the funded **Space** instead of automatically switching to the paying **Space**.
- Multiple **Receivables** can be settled from one existing **Transfer** by consuming the **Transfer** amount one **Receivable** at a time, using the 5% settlement tolerance for each settlement.
- When an existing **Transfer** is partially consumed to settle a **Receivable**, Wallit creates a **Receivable Settlement Expense** for the consumed amount and keeps a **Settlement Remainder Transfer** for the unconsumed amount.
- Partial consumption creates a new incoming operational **Movement** linked to the settled **Receivable** and reduces the original incoming **Movement** so it remains part of the **Settlement Remainder Transfer**.
- When a different-currency **Transfer** is partially consumed, Wallit consumes both sides proportionally using the original **Transfer** amounts, preserving the original effective exchange rate in the **Settlement Remainder Transfer**.
- A **Settlement Remainder Transfer** keeps the original **Transfer** description, date, accounts, and Spaces; only the outgoing and incoming movement amounts change.
- When an existing **Transfer** is fully consumed to settle a **Receivable**, Wallit removes the remaining **Transfer** and keeps only the settlement workflow.
- A **Reportable Movement** counts as income or expense in financial reports.
- A **Movement** is either reportable or operational for reporting purposes; it should not be both.

## Example dialogue

> **Dev:** "When Rai transfers money from BCI to Mercado Pago, do we create one Movement or two?"
> **Domain expert:** "Two. One Movement is the money leaving BCI, and the other is the money entering Mercado Pago. Together they represent the Transfer."
>
> **Dev:** "Does a bank-imported Movement pending review affect the account balance?"
> **Domain expert:** "Yes, because the money already moved. But don't use it for category-based reporting until it's confirmed. Once confirmed, it becomes reportable unless classified as operational."
>
> **Dev:** "Should a Transfer appear as income and expense in reports?"
> **Domain expert:** "No. It affects account balances, but it is not income or expense for reporting. The same applies to receivables, emergency expenses, loans, and similar tracking workflows. Those are Operational Movements, not Reportable Movements."
>
> **Dev:** "When Rai moves money from Personal to Casa, is that a household expense?"
> **Domain expert:** "No. It is an Inter-Space Transfer. Personal balance goes down and Casa balance goes up, but the household expense is only recorded later when Casa spends that money."

## Flagged ambiguities

- "Movement" was previously used broadly for both atomic account-level money movements and higher-level financial workflows. Resolved: a **Movement** is atomic, account-level, and balance-affecting; composed workflows like **Transfer** are modeled through relationships between Movements.
- "Aporte a Space" was considered for moving money from Personal to Casa. Resolved: the canonical term is **Inter-Space Transfer**, because the operation is symmetric and general, not specific to household contributions.
- "Transferencia que salda un por cobrar" was considered for household reimbursements. Resolved: this should not be a **Transfer**; the canonical term is **Receivable Settlement Expense**, because the paying **Space** is recording a real expense while the funded **Space** is only settling a receivable.
- A single existing **Transfer** can cover multiple **Receivables**. Resolved: each settlement consumes one receivable at a time from the **Transfer** using a 5% tolerance after currency conversion; the remaining operational amount stays as a **Settlement Remainder Transfer** until fully consumed.
- Earlier discussion suggested exact full coverage for settlement. Overridden: settlement allows a ±5% tolerance for same-currency and different-currency payments, and rejects differences above that tolerance.
