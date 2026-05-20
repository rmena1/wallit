# Wallit

Wallit tracks Rai's personal finances by recording money movements across accounts and deriving balances, liquidity, reports, debts, and follow-up workflows from those movements.

## Language

**Movement**:
An atomic movement of money that affects the balance of exactly one account.
_Avoid_: Transaction, record, entry

**Transfer**:
A movement of money between two accounts, represented by exactly two linked **Movements**: one outgoing movement from the source account and one incoming movement into the destination account.
_Avoid_: Single movement transfer

**Pending Review Movement**:
A **Movement** with provisional or incomplete classification that already affects an account balance but should be excluded from category-based reporting until confirmed.
_Avoid_: Draft movement, import row

**Operational Movement**:
A **Movement** that affects account balances but should not be counted as income or expense in financial reports.
_Avoid_: Real income, real expense

**Reportable Movement**:
A confirmed **Movement** that represents real income or expense for financial reporting.
_Avoid_: Normal movement, categorized movement

## Relationships

- A **Movement** belongs to exactly one account and always affects that account's balance.
- A **Transfer** is composed of exactly two linked **Movements**.
- A **Transfer** has one outgoing **Movement** and one incoming **Movement**.
- A **Pending Review Movement** is a **Movement** and affects account balance before confirmation.
- A **Pending Review Movement** is excluded from category-based reporting until it becomes confirmed.
- A **Pending Review Movement** becomes a **Reportable Movement** after confirmation, unless it is transformed into an operational workflow during review.
- Transforming a **Pending Review Movement** into another kind of workflow must happen through an explicit domain operation, not by freely editing independent fields.
- A confirmed **Movement** may also be transformed into an operational workflow after confirmation, but only through an explicit domain operation.
- A **Movement** with existing dependent relationships cannot be freely transformed until those relationships are resolved by the relevant domain operation.
- Callers should transform **Movements** through explicit domain operations with narrow write interfaces, not by freely updating persistence fields.
- Movement writes and movement reads are separate concerns: write modules perform domain operations, while read modules prepare balances, reports, timelines, and review queues for screens.
- Movement write operations must preserve Ledger invariants: every **Movement** affects exactly one account, every **Movement** is either reportable or operational for reporting, every **Transfer** has exactly two linked Movements, dependent relationships are resolved explicitly, and money values are normalized consistently across currencies.
- Deleting a **Movement** must be expressed through a specific domain operation, not a generic public delete: pending movements, reportable movements, transfers, receivables, emergencies, and loans have different deletion rules.
- Updating a **Movement** must be expressed through a specific domain operation, not a generic public field update. A generic update may exist temporarily as internal implementation during migration, but it must be removed before the Movement Ledger refactor is considered complete.
- The Movement Ledger seam lives below server actions: UI calls thin server actions, server actions authenticate and parse input, and the Ledger owns domain operations, invariants, and transactions.
- A **Transfer** is made of **Operational Movements** and does not count as income or expense in reports.
- Receivables, emergency expenses, loans, loan paybacks, and similar tracking workflows use **Movements** for balance effects but are excluded from income/expense reports.
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

## Flagged ambiguities

- "Movement" was previously used broadly for both atomic account-level money movements and higher-level financial workflows. Resolved: a **Movement** is atomic, account-level, and balance-affecting; composed workflows like **Transfer** are modeled through relationships between Movements.
