# Product

## Register

product

## Users

Wallit is used by Rai to manage personal and shared finances across bank accounts and Spaces such as Personal and household contexts. Users are usually in a task-focused workflow: recording a movement, reviewing imported/pending movements, editing financial facts, checking balances, following up receivables, or understanding reports.

## Product Purpose

Wallit records atomic money Movements and derives trustworthy balances, income/expense reports, cashflow, receivables, loans, emergency tracking, and review queues. Success means the app makes financial state explainable without confusing reporting classification with balance effects.

## Brand Personality

Calm, precise, trustworthy. The interface should feel like a capable finance tool: clear enough for fast daily entry, rigorous enough for cross-Space workflows, and restrained enough that data and decisions stay primary.

## Anti-references

Do not make Wallit look like a playful budgeting toy, a crypto dashboard, or a decorative fintech landing page. Avoid ornamental gradients, glassmorphism, over-rounded cards, clever custom controls, and anything that hides accounting semantics behind cute copy.

## Design Principles

- Make money semantics explicit: users should always understand whether a Movement affects balance, reports, or both.
- Keep complex workflows progressive: show classification controls only when the selected workflow needs them.
- Preserve trust through consistency: buttons, toggles, labels, errors, and badges should mean the same thing across Add, Edit, Review, timelines, and reports.
- Favor task speed over spectacle: dense, familiar controls beat decorative UI for financial operations.
- Explain blocked actions in domain language: if receivable or settlement dependencies prevent a change, say exactly why and what must happen first.

## Accessibility & Inclusion

Target WCAG AA for text contrast and interactive states. Controls must be keyboard reachable, labels should not rely on color alone, and any motion should be short, state-driven, and compatible with reduced-motion preferences.

## Reporting category nets

Reports, dashboard and remote MCP calculate Ingresos and Gastos per Space and selected date range using canonical CLP `amount` (including converted USD). Each category nets income minus expense: positive nets add to Ingresos, absolute negative nets add to Gastos. Uncategorized income and expense stay gross on their respective sides. Neto remains Ingresos minus Gastos. Reportable Inter-Space Transfer legs participate with their own type and category; same-Space Transfers remain operational. Existing reportable filters and balance calculations are unchanged.

Category breakdowns show the resulting net type and signed amount; category detail includes both incomes and expenses. Cumulative report charts apply this rule from range start through each day, so refunds can lower a curve; the linear expense trend uses that same series. The dashboard retains its all-time range. Balance charts remain gross.
