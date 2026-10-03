import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import postgres from 'postgres';
import { config } from '../src/config/index.mjs';
test('test harness has fake credentials and blocks production transports before tests', async () => {
  assert.equal(process.env.WALLIT_TEST_NETWORK_DISABLED, '1');
  assert.equal(config.wallit.importToken, 'test-token');
  assert.equal(config.database.url, 'postgresql://test:test@localhost:5432/test');
  for (const attempt of [
    () => net.connect(5432, 'localhost'), () => tls.connect(993, 'imap.gmail.com'),
    () => http.request('http://localhost:3000/api/import/email'),
    () => https.request('https://production.invalid/api/import/email'),
  ]) assert.throws(attempt, /ISOLATED_TEST_NETWORK_DISABLED/);
  await assert.rejects(fetch('https://production.invalid/api/import/email'), /ISOLATED_TEST_NETWORK_DISABLED/);
  const db = postgres(config.database.url, { connect_timeout: 1 });
  await assert.rejects(db`SELECT 1`, /ISOLATED_TEST_NETWORK_DISABLED/);
  await db.end({ timeout: 1 });
});
