import postgres from 'postgres';
import { run } from './worker.mjs';

try {
  const rate = await run({ databaseUrl: process.env.DATABASE_URL, postgres });
  console.log(JSON.stringify({ ok: true, rate }));
} catch {
  // Never expose connection strings or remote error messages in logs.
  console.error(JSON.stringify({ ok: false, rate: null }));
  process.exitCode = 1;
}
