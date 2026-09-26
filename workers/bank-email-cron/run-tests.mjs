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
process.env.ACCOUNT_TENPO_CREDIT_ID = 'test-tenpo-credit';
process.env.ACCOUNT_TENPO_VISTA_ID = 'test-tenpo-vista';
process.env.ACCOUNT_MERCADOPAGO_ID = 'test-mercadopago';
process.env.USD_CLP_EXCHANGE_RATE_X100 = '94650';

// Now run the actual test
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';

const child = spawn('node', ['--test', ...readdirSync('test').filter(name => name.endsWith('.test.mjs')).map(name => `test/${name}`)], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code);
});
