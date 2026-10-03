export function calculateRate(body) {
  const clp = body?.rates?.CLP;
  if (typeof clp !== 'number' || !Number.isFinite(clp) || !(clp > 0)) {
    throw new Error('Invalid rates.CLP');
  }
  return Math.round(clp * 100);
}

export async function run({ databaseUrl, postgres, fetchRate = fetch, now = Date.now }) {
  if (!databaseUrl?.trim()) throw new Error('Missing DATABASE_URL');
  const response = await fetchRate('https://open.er-api.com/v6/latest/USD', {
    method: 'GET',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Exchange rate HTTP failure');
  const rate = calculateRate(await response.json());
  const id = `USD_CLP_${Math.floor(now() / 60000)}`;
  // Match bank-email-cron: the driver honors the connection URL's SSL settings.
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });
  try {
    await sql`
      INSERT INTO exchange_rates (id, from_currency, to_currency, rate, source, fetched_at)
      VALUES (${id}, 'USD', 'CLP', ${rate}, 'open.er-api.com', NOW())
      ON CONFLICT (id) DO UPDATE SET
        rate = EXCLUDED.rate,
        source = EXCLUDED.source,
        fetched_at = EXCLUDED.fetched_at
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
  return rate;
}
