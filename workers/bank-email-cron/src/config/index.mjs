import process from 'node:process';

function getEnv(key, defaultValue = undefined) {
  const value = process.env[key];
  return value !== undefined ? value : defaultValue;
}

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parsePositiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function parseTransferAccountMap(value) {
  const map = JSON.parse(value);
  if (!map || typeof map !== 'object' || Array.isArray(map)
    || Object.entries(map).some(([key, id]) => !/^[a-z]+:(CLP|USD):(\d{4}|credit)$/.test(key)
      || typeof id !== 'string' || !id.trim())) {
    throw new Error('TRANSFER_ACCOUNT_MAP must map bank:currency:last4 (or credit) to account IDs');
  }
  return map;
}

export const config = {
  database: {
    url: requireEnv('DATABASE_URL'),
  },
  
  gmail: {
    user: requireEnv('GMAIL_USER'),
    password: requireEnv('GMAIL_APP_PASSWORD'),
    host: getEnv('GMAIL_IMAP_HOST', 'imap.gmail.com'),
    port: parsePositiveInt(getEnv('GMAIL_IMAP_PORT', '993'), 'GMAIL_IMAP_PORT'),
    tls: getEnv('GMAIL_IMAP_TLS', 'true') !== 'false',
    tlsRejectUnauthorized: getEnv('IMAP_TLS_REJECT_UNAUTHORIZED', 'true') !== 'false',
    folder: getEnv('GMAIL_IMAP_FOLDER', 'INBOX'),
    initialUid: parseNonNegativeInt(getEnv('GMAIL_INITIAL_UID', '0'), 'GMAIL_INITIAL_UID'),
    lookbackDays: parsePositiveInt(getEnv('GMAIL_LOOKBACK_DAYS', '30'), 'GMAIL_LOOKBACK_DAYS'),
  },
  
  wallit: {
    baseUrl: requireEnv('WALLIT_BASE_URL'),
    importUrl: getEnv('WALLIT_IMPORT_URL') || `${requireEnv('WALLIT_BASE_URL')}/api/import/email`,
    importToken: requireEnv('WALLIT_IMPORT_TOKEN'),
    userId: requireEnv('WALLIT_USER_ID'),
  },
  
  typesafe: {
    baseUrl: getEnv('TYPESAFE_BASE_URL', 'https://api.typesafe.ai'),
    apiKey: requireEnv('TYPESAFE_API_KEY'),
    model: getEnv('TYPESAFE_MODEL', 'jev-latest'),
    timeoutMs: parsePositiveInt(getEnv('JEV_TIMEOUT_MS', '15000'), 'JEV_TIMEOUT_MS'),
  },
  
  openai: {
    apiKey: getEnv('OPENAI_API_KEY'),
    baseUrl: getEnv('OPENAI_BASE_URL', 'https://api.openai.com'),
    model: getEnv('OPENAI_MODEL', 'gpt-6-luna'),
    reasoningEffort: getEnv('OPENAI_REASONING_EFFORT', 'medium'),
    timeoutMs: parsePositiveInt(getEnv('LUNA_TIMEOUT_MS', '60000'), 'LUNA_TIMEOUT_MS'),
  },
  
  category: {
    minConfidence: parseFloat(getEnv('CATEGORY_MIN_CONFIDENCE', '0.70')),
  },
  
  // Explicit bank:currency:last4 (or bank:currency:credit) -> Wallit account ID.
  transferAccountMap: parseTransferAccountMap(getEnv('TRANSFER_ACCOUNT_MAP', '{}')),

  accounts: {
    bciChecking: getEnv('ACCOUNT_BCI_CHECKING_ID'),
    bciClp: requireEnv('ACCOUNT_BCI_CLP_ID'),
    bciUsd: requireEnv('ACCOUNT_BCI_USD_ID'),
    tenpoCredit: requireEnv('ACCOUNT_TENPO_CREDIT_ID'),
    tenpoVista: requireEnv('ACCOUNT_TENPO_VISTA_ID'),
    mercadopago: requireEnv('ACCOUNT_MERCADOPAGO_ID'),
  },
  
  exchangeRate: {
    usdClpX100: parsePositiveInt(getEnv('USD_CLP_EXCHANGE_RATE_X100', '94650'), 'USD_CLP_EXCHANGE_RATE_X100'),
  },
};
