#!/usr/bin/env node

// Set test environment variables before loading any modules
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-password';
process.env.GMAIL_INITIAL_UID = '0';
process.env.GMAIL_LOOKBACK_DAYS = '30';
process.env.WALLIT_BASE_URL = 'https://test.example.com';
process.env.WALLIT_IMPORT_TOKEN = 'test-token';
process.env.WALLIT_USER_ID = 'test-user-id';
process.env.TYPESAFE_API_KEY = 'apikey_test';
process.env.JEV_TIMEOUT_MS = '15000';
process.env.OPENAI_API_KEY = 'sk-test';
process.env.LUNA_TIMEOUT_MS = '30000';
process.env.CATEGORY_MIN_CONFIDENCE = '0.70';
process.env.ACCOUNT_BCI_CLP_ID = 'test-bci-clp';
process.env.ACCOUNT_BCI_USD_ID = 'test-bci-usd';
process.env.ACCOUNT_BCI_CHECKING_ID = 'test-bci-checking';
process.env.ACCOUNT_TENPO_CREDIT_ID = 'test-tenpo-credit';
process.env.ACCOUNT_TENPO_VISTA_ID = 'test-tenpo-vista';
process.env.ACCOUNT_MERCADOPAGO_ID = 'test-mercadopago';
process.env.USD_CLP_EXCHANGE_RATE_X100 = '94650';

// Now run the actual test
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';

// Do not inherit production credentials, custom endpoints, NODE_OPTIONS or proxy
// settings. The preload blocks every transport; individual tests inject doubles.
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['PATH', 'HOME', 'TZ', 'TERM', 'LANG'].includes(key) || [
    'DATABASE_URL', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'GMAIL_INITIAL_UID',
    'GMAIL_LOOKBACK_DAYS', 'WALLIT_BASE_URL', 'WALLIT_IMPORT_TOKEN',
    'WALLIT_USER_ID', 'TYPESAFE_API_KEY', 'JEV_TIMEOUT_MS', 'OPENAI_API_KEY',
    'LUNA_TIMEOUT_MS', 'CATEGORY_MIN_CONFIDENCE', 'ACCOUNT_BCI_CLP_ID',
    'ACCOUNT_BCI_USD_ID', 'ACCOUNT_BCI_CHECKING_ID', 'ACCOUNT_TENPO_CREDIT_ID',
    'ACCOUNT_TENPO_VISTA_ID', 'ACCOUNT_MERCADOPAGO_ID', 'USD_CLP_EXCHANGE_RATE_X100',
  ].includes(key)));
const realDataset = process.argv[2] === '--real-transfers' ? process.argv[3] : null;
if (process.argv[2] === '--real-transfers' && !realDataset) throw new Error('Private dataset path is required');
if (realDataset) safeEnv.WALLIT_REAL_TRANSFER_DATASET = realDataset;
const corpus = process.argv[2] === '--corpus' ? process.argv[3] : null;
const args = realDataset ? ['--import', './test/network-guard.mjs', '--test', './test/own-bank-transfers.real.mjs'] : corpus ? ['--import', './test/network-guard.mjs', './test/corpus-audit.mjs', corpus]
  : ['--import', './test/network-guard.mjs', '--test', ...(process.argv.includes('--watch') ? ['--watch'] : []), ...readdirSync('test').filter(name => name.endsWith('.test.mjs')).map(name => `test/${name}`)];
const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: safeEnv,
});

child.on('error', () => { process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });
