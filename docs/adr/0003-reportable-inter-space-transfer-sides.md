# Inter-Space Transfer sides can be reportable independently

Wallit originally treated every Transfer as operational so transfers never counted as income or expense. We decided to keep same-Space Transfers operational, but make new Inter-Space Transfers reportable by default: the outgoing side counts as an expense in the source Space and the incoming side counts as income in the destination Space, while each side can be marked operational independently when it should only affect balances. This preserves normal bank-transfer semantics inside a Space while letting cross-Space money movement represent real financial activity for each Space without forcing historical Inter-Space Transfers to rewrite past reports.

## Consequences

Reportable Inter-Space Transfer sides require explicit category classification and count in reports/cashflow like normal expenses or income while preserving transfer context in timelines and details. Automatically created Inter-Space Transfers default to reportable on both sides but enter review when required classification is missing. Existing Inter-Space Transfers remain operational until a User explicitly marks a side as reportable.
