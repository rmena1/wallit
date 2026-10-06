---
name: wallit
description: Read and manage the authenticated user's Wallit financial data using the remote Wallit MCP.
---

Read the current profile and available Spaces first. Use only returned IDs and the selected Space. All monetary inputs are integer cents (including CLP); exchange rates are CLP/USD × 100. Use the tool schemas as the exact operation contracts.

Every mutation requires a fresh idempotency key. Reuse the same key and exact arguments when retrying an uncertain result. New movements always enter review, including transfer/payment/split/import legs. Review/confirmation is a separate operation: never immediately confirm a movement unless the user explicitly requested that review action. Read back relevant balances and pending items after a successful operation.

Respect the user's granted permissions and current memberships. Owner-only Space operations remain owner-only. Do not seek SQL, secrets, other users' private data, or unsupported features. Wallit currently has no tags, budgets, installments or recurring scheduler. A reported error is not a completed financial operation.

Authentication and refresh run through the host's OAuth connection to the production remote MCP. Do not use a local Mac server, copied browser sessions or static tokens as a substitute.
