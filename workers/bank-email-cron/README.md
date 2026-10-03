# Wallit Bank Email Cron Worker

Railway cron worker that runs every 10 minutes to import bank email transactions into Wallit.

## Overview

This service monitors a Gmail mailbox via IMAP for transaction notifications from Chilean banks and fintechs (BCI, Tenpo, Mercado Pago), with exact sender and Gmail-aligned DMARC verification, parses them using deterministic parsers, classifies them with Jev (TypeSafe AI), and imports them into Wallit through the private `/api/import/email` endpoint.

## Features

- **IMAP Gmail Integration**: Reads new emails using UID cursor with UIDVALIDITY tracking
- **Concurrent Run Protection**: PostgreSQL advisory lock prevents overlapping cron executions
- **Deterministic Parsers**: BCI, Tenpo, and Mercado Pago email parsers (validated synthetic regressions and a separately stored private 100-message real-email audit)
- **AI Classification**:
  - Transaction filter (Jev with Luna fallback)
  - Category choice (Jev with Luna fallback, confidence-gated)
- **Idempotent Imports**: Safe to retry on `sourceEmailId`
- **Money Units**:
  - CLP: centavos (pesos × 100)
  - USD: cents with explicit exchange rate (CLP/USD × 100)
- **Structured Logging**: New processing logs hash Message-ID and omit sender mailbox, subject, bodies, remote error messages and credentials

## Architecture

1. Acquire PostgreSQL advisory lock
2. Fetch cursor (UIDVALIDITY + last UID)
3. Connect to Gmail IMAP, fetch messages with UID > cursor
4. For each message:
   - Check sender against allowlist
   - Call Jev transaction filter
   - Run deterministic parser (BCI/Tenpo/MercadoPago)
   - Resolve Wallit account from provider + currency + card
   - Call Jev category choice (with confidence threshold)
   - Build import payload (`kind: movement` or confidently resolved `kind: transfer`)
   - POST to Wallit `/api/import/email`
   - Advance cursor on success/duplicate/intentional skip
   - Stop on network/5xx/validation errors, transaction-shaped unknown templates or ambiguous routing (retry next scheduled cron)
5. Release lock

## Installation

```bash
cd workers/bank-email-cron
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure all required variables.

### Required Environment Variables

```bash
# Database (worker-owned schema for cursor + logs)
DATABASE_URL=postgresql://user:password@host:5432/database

# Gmail IMAP (app password required, not account password)
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-gmail-app-password

# Wallit Import API (private endpoint, internal network or VPN)
WALLIT_BASE_URL=https://wallit-app.railway.app
WALLIT_IMPORT_TOKEN=your-bearer-token
WALLIT_USER_ID=your-user-id

# TypeSafe (Jev)
TYPESAFE_API_KEY=apikey_your_key

# Wallit Account IDs (configure for your deployment)
# BCI checking (last4 8080), required for own-card sources and transfer destinations
ACCOUNT_BCI_CHECKING_ID=your-bci-checking-account-id
ACCOUNT_BCI_CLP_ID=m3p73v3hx022lsy8z5w39
ACCOUNT_BCI_USD_ID=2fy0igbyfngwuw9s7rye2
ACCOUNT_TENPO_CREDIT_ID=33hmwmu5ppq3avb5756u2
ACCOUNT_TENPO_VISTA_ID=nxk4kf3fka5r8a3ozqtks
ACCOUNT_MERCADOPAGO_ID=f3vvmp7rra6v93ts6llfb

# USD Exchange Rate (CLP/USD × 100, e.g. 946.50 → 94650)
USD_CLP_EXCHANGE_RATE_X100=94650
```

### Optional Environment Variables

See `.env.example` for optional configuration (Luna fallback, IMAP settings, timeouts, confidence threshold).

**Important for Railway Deployment:**

If you encounter IMAP TLS certificate errors on Railway (`DEPTH_ZERO_SELF_SIGNED_CERT`), set:

```bash
IMAP_TLS_REJECT_UNAUTHORIZED=false
```

This disables TLS certificate validation for IMAP connections. Use only when Railway's egress or TLS stack presents certificates that Node's bundled CAs reject. The default is `true` (secure, validates certificates).

**Note:** If outbound HTTPS requests to OpenAI fail with certificate errors, you may need to configure Node.js to use the system certificate store:

```bash
NODE_OPTIONS=--use-system-ca
```

This is only necessary if Railway's environment presents certificates that Node's bundled root CAs do not recognize. Do not disable certificate validation (`rejectUnauthorized: false`) for OpenAI API calls.

## Running Locally

```bash
npm start
```

The worker runs once and exits. For development, you can run it manually or use a local cron scheduler.

## Railway Deployment

### Cron Schedule

Configure Railway service with cron schedule:

```
*/10 * * * *
```

(Every 10 minutes)

### Railway Service Configuration

**Add as New Railway Service in Project:**

1. In Railway dashboard, add a new service to your Wallit project
2. Connect to the `rmena1/wallit` repository
3. Set root directory: `workers/bank-email-cron`
4. Configure service as **Cron Job**
5. Set cron schedule: `*/10 * * * *`
6. Set start command: `npm start`
7. Configure environment variables (see below)
8. Enable private networking for secure Wallit API access

**Important**: Railway multi-service projects are configured through the dashboard, not via `railway.toml`. The root `railway.toml` is for the main Wallit Next.js app.

### Database

The worker creates its own tables on first run:
- `bank_email_cursor`: IMAP UID cursor + UIDVALIDITY
- `bank_email_processing_log`: Audit log (no raw bodies, tokens, or passwords)

Use the same `DATABASE_URL` as your main Wallit app or a separate database.

## Testing

```bash
npm test
```

Tests cover:
- Synthetic parser, monetary/date validation, exact-sender/auth, runner cleanup, cursor and timeout regressions
- CLP centavos and USD cents conversion
- Jev classification with mocked responses
- Cursor advancement logic
- Duplicate handling
- Account resolution

## Security

- **Never commit** credentials, app passwords, bearer tokens, or production email bodies
- Gmail app password required (not account password)
- `WALLIT_IMPORT_TOKEN` authenticates private API access
- New raw email bodies never logged or stored in database
- New Message-ID log values are SHA-256 hashes; old log rows are not modified by this release

## Provider Allowlist

- `contacto@bci.cl` → BCI
- `no-reply@tenpo.cl` → Tenpo
- `info@mercadopago.com` → Mercado Pago

Emails from other senders are skipped.

## Account Routing

Default mappings (configurable via environment):

| Provider | Signal | Account |
|----------|--------|---------|
| BCI | Card 1164, CLP | Personal CLP |
| BCI | Card 1164, USD | Personal USD |
| Tenpo | Credit card activity | Tenpo Credit |
| Tenpo | Transfer/incoming payment | Tenpo Vista (Casa) |
| Mercado Pago | Account 6991 | Personal CLP |

## Money Units

- **CLP**: `amount` in centavos (pesos × 100). `$20.980` → `2098000`
- **USD**: `amountUsd` in cents + `exchangeRate` (CLP/USD × 100). `$20.00` + rate `946.50` → `amountUsd: 2000`, `exchangeRate: 94650`
- Never send guessed FX rates; configure `USD_CLP_EXCHANGE_RATE_X100` or fail closed

## Import Contract

Payload shape for `POST ${WALLIT_BASE_URL}/api/import/email`:

```json
{
  "kind": "movement",
  "userId": "...",
  "accountId": "...",
  "categoryId": "..." | null,
  "name": "Merchant Name",
  "originalName": "EXACT PARSER MERCHANT",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "type": "expense" | "income",
  "currency": "CLP",
  "amount": 123456,
  "sourceEmailProvider": "bci" | "tenpo" | "mercadopago",
  "sourceEmailId": "message-id@example.com"
}
```

For USD movements, replace `amount` with `amountUsd` + `exchangeRate`.

## Cursor Management

- Cursor advances only after:
  - Successful import (200 + `success: true`)
  - Duplicate response (200 + `duplicate: true`)
  - Intentional skip (not_transaction, allowlist, unparseable)
- Network errors, 5xx, 429, validation failures → stop without advancing
- UIDVALIDITY or configured-folder change → stop with nonzero status and preserve cursor. No automatic reset/replay/backfill

## Failure Modes

- **Lock contention**: Another cron running, exit 0
- **UIDVALIDITY changed**: Preserve cursor, log fixed reason, exit 1; operator decision required
- **Network/API error mid-batch**: Stop at failed UID, retry next cron
- **Unresolved account**: Log redacted reason, exit 1 without advancing; retry on a later scheduled cron
- **Jev/Luna unavailable**: Fail closed, retry next cron

## Logs

Structured logs include:
- Provider, UID, redacted Message-ID
- Decision (transaction/not_transaction/duplicate/error)
- Parser success, category ID
- Import result
- No raw bodies, tokens, or credentials

## Known Limitations

- Gold dataset: 65/66 bodies (one stub)
- Tenpo Vista vs Personal account disambiguation requires configured mapping
- SaverPro/SaveMoney Mercado Pago prose: 14/14 extras coverage
- No automatic FX rate fetching (must configure `USD_CLP_EXCHANGE_RATE_X100`)

## Troubleshooting

**No messages fetched**: Check IMAP credentials, folder name, firewall/TLS
**Import 401**: Verify `WALLIT_IMPORT_TOKEN` and private network access
**Account unresolved**: Check account IDs match Wallit, review parser card detection
**UIDVALIDITY reset**: Mailbox reorganized, cursor reset is safe
**Lock held**: Previous cron still running or crashed; check Railway logs

## Support

See `CLOUDAGENT-PROMPT.md` for full implementation specification.

## Internal transfers

Outgoing transfers to Raimundo Mena (including additional surnames), and BCI/Tenpo
own-credit-card payment notices, are internal-transfer candidates. Destination
resolution uses labeled account numbers and bank/currency, never arbitrary body
digits or classifier guesses. Known endings: BCI 1164 (CLP/USD), BCI checking 8080,
Tenpo credit 7648, Tenpo Vista 0146, Mercado Pago 6991. A Tenpo own-card payment
without a card number can use the explicit Tenpo credit marker. An unknown explicit
card number never falls back to that marker.

Required `ACCOUNT_BCI_CHECKING_ID` maps `bci:CLP:8080` to BCI checking (last4 8080)
for own-card payment sources and internal transfer destinations. If unset or empty,
config import fails before processing emails with
`Missing required environment variable: ACCOUNT_BCI_CHECKING_ID`, preventing a
silent stuck cron. Optional `TRANSFER_ACCOUNT_MAP` overrides or extends the default
mappings as a JSON object mapping `bank:currency:last4` to account IDs,
for example `{"bci:CLP:9015":"casa-card-id"}`. Bank keys are `bci`, `tenpo`,
`mercadopago`; `bank:currency:credit` may explicitly map an own-card marker.
These mappings also resolve labeled source accounts in card-payment notices.
A missing/unknown source remains an actionable error; no source account is guessed.

A known, distinct destination produces `kind: transfer`. The app derives flags from
actual account Spaces: same-Space is operational on both sides, without review;
Inter-Space is reportable on both sides and needs review, with null categories.
An unclear destination produces one expense with `needsReview: false` and null
category. Successful import or duplicate advances UID; API/classifier failures do
not. External P2P remains an ordinary one-leg expense. Candidates skip category
classification because their categories are intentionally null.

Rollout: redeploy the Wallit app first, then bank-email-cron in Railway after merge.
The app must support the movement review override before the worker uses it.

## IMAP connection recovery and Railway restarts

`IMAP_CONNECT_MAX_RETRIES` defaults to `3` retries after the initial connection
attempt (4 attempts total); `0` disables retries. `IMAP_CONNECT_BASE_DELAY_MS`
defaults to `500` and must be a positive integer. Each retry creates a fresh IMAP
client after destroying the failed connection. Delays grow exponentially with
0–100% random jitter, capped at 30 seconds. Timeouts (including authentication
timeouts), temporary DNS/socket failures and premature disconnects retry;
explicit credential rejection and other non-transient failures fail immediately.
Attempt logs use fixed diagnostic text without raw server errors or credentials.

Exhausted connection retries propagate to the existing `process.exit(1)` handler.
The worker's `railway.toml` specifies `on_failure` with 5 restarts, `npm run build`
and `npm run start`, with no HTTP healthcheck or port. Successful one-shot runs
exit 0 and are left to the existing cron schedule. Retry/restart limits are finite;
a persistent outage can still exhaust them.

Railway Operator `eef30a4d-279c-4dbd-b9e3-46b2a198df72` must verify the service:

1. Open the Railway project and production environment, select **bank-email-cron**
   (not wallit-app), then **Settings**.
2. Under **Source**, verify **Root Directory** is `/workers/bank-email-cron`.
   Under **Config as Code**, set the config file path to
   `/workers/bank-email-cron/railway.toml` if this existing service supports it.
3. Under **Deploy**, set **Restart Policy** to **On Failure** and **Max Retries**
   to **5** as the dashboard fallback. Verify build/start commands are
   `npm run build` / `npm run start`, no HTTP healthcheck is configured, and leave
   the existing cron schedule and variables unchanged.
4. Save/stage these settings without deploying as part of this change. After a
   separately authorized deployment, inspect its details to confirm the effective
   restart policy is **On Failure / 5** and its configuration source is the worker
   TOML (or dashboard when Config as Code is unavailable).

A repository file does not update an existing deployment or dashboard settings.
[Railway Config as Code](https://docs.railway.com/config-as-code) documents explicit
config paths and precedence; it currently notes legacy Config as Code support
until 2026-12-01. If unavailable for this service, use the dashboard fallback above.
[Restart policy documentation](https://docs.railway.com/deployments/restart-policy)
explains nonzero-exit restarts. No Railway deployment is performed by this change.

## Audited safety contract (2026-10-03)

- `npm test` and `npm run test:watch` always use fake configuration and a transport-denial preload. HTTP, TLS, IMAP, DNS and PostgreSQL networking are blocked; test doubles provide effects. Never run `npm start` as a test.
- A private genuine-email corpus can be checked with `npm run test:corpus -- /absolute/private/corpus`. It must remain outside every Git root. Only synthetic/sanitized fixtures belong in this repository. The harness writes per-case hashes/checks to that private directory and prints no bodies or monetary values.
- The cursor schema and existing nonempty Message-ID import identity remain compatible. Missing Message-ID uses a deterministic mailbox/folder/UIDVALIDITY/UID hash. Neither UIDVALIDITY nor folder changes can reset the cursor automatically.
- Advisory lock, cursor and log queries use one reserved PostgreSQL session. A session loss permanently invalidates the run; backend PID/lock ownership is checked before effects. SQL has both server and client transport deadlines, and tracked sockets are force-closed when necessary. All paths release/close without premature `process.exit`. Blocked work exits 1; lock contention exits 0.
- Server-side UID search fetches at most `IMAP_BATCH_SIZE` (default 50) messages; each is limited by `IMAP_MAX_MESSAGE_BYTES` (default 524288). Fetch/decode failures cannot disappear from an otherwise successful batch.
- IMAP operations are bounded by `IMAP_OPERATION_TIMEOUT_MS` (default 30000). Import request and body decoding are bounded by `WALLIT_IMPORT_TIMEOUT_MS` (default 15000). Import retries reuse identical identity/payload and retry 429/5xx/transient transport failures; invalid responses and 4xx validation are retained for review.
- Header-only transaction date proxies are normalized to `America/Santiago`; explicit body date/time remains authoritative. USD exchange rate must be explicitly configured; no default FX is guessed.
- MercadoPago funded-card receipts route explicitly named BCI credit card 1164 to BCI. A brand/last4 alone does not prove issuer/product. Unknown funding cards cannot silently debit the wallet. Contradictory direction receipts are blocked.
- Keep Railway's effective `NEVER` restart policy with the 10-minute cron. Errors are visible and retry on a natural scheduled run, avoiding immediate poison-message restart loops.
- The work deadline is propagated through IMAP/model/import retries. Final confirmed-disposition state writes and bounded cleanup may extend beyond the work deadline
- Do not replay, reset the cursor, backfill or manually invoke production imports when validating/rolling back this release.

See `AUDIT_2026-10-03.md` for evidence counts, remaining limits and rollout checks.

## Transferencias entre bancos propios

Ver [detección, cuentas pendientes, deduplicación y pruebas con correos reales](OWN_BANK_TRANSFERS.md).
