# Exchange rate cron

Self-contained Node.js 20+ one-shot worker. Fetches USD → CLP from
open.er-api.com with an 8-second timeout, stores `Math.round(CLP * 100)` in
`exchange_rates`, and exits. Minute-based IDs upsert rate, source and fetched time.
Logs JSON `{ok, rate}`; failures exit nonzero without logging credentials.

Run from this directory:

```sh
cd workers/exchange-rate-cron
npm ci
npm test
npm start
```

The only required environment variable is `DATABASE_URL`, supplied through the
process environment. No secret or `.env` files are read. Postgres uses the URL's
SSL settings, matching the bank-email worker.

Railway root directory: `workers/exchange-rate-cron`. The included TOML runs once
a day at `0 11 * * *` (UTC), which is 08:00 America/Santiago when UTC-3
(and 07:00 when UTC-4). Start command: `npm start`; restart policy: `on_failure`.
No service or environment provisioning is performed by this repository change.

`npm test` uses only pure calculation and fake HTTP/database transports; it needs
no environment variables, database or network.
