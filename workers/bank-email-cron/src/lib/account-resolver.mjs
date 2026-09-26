import { config } from '../config/index.mjs';

export const PROVIDER_FROM_ALLOWLIST = {
  'contacto@bci.cl': 'bci',
  'no-reply@tenpo.cl': 'tenpo',
  'info@mercadopago.com': 'mercadopago',
};

export function getProviderFromEmail(from) {
  const normalized = from.toLowerCase().trim();
  for (const [allowedFrom, provider] of Object.entries(PROVIDER_FROM_ALLOWLIST)) {
    if (normalized.includes(allowedFrom)) {
      return provider;
    }
  }
  return null;
}

export function resolveAccount(parsedResult) {
  const { provider, currency, last4, cardHint, type } = parsedResult;
  if (parsedResult.ownCardPayment) {
    const source = resolveTransferAccount(parsedResult.sourceBank || provider, currency, parsedResult.sourceAccount);
    if (!source) throw new Error('Credit card payment: unresolved source account');
    return source;
  }

  if (provider === 'bci') {
    if (last4 === '1164') {
      if (currency === 'USD') {
        return config.accounts.bciUsd;
      }
      return config.accounts.bciClp;
    }
    throw new Error(`BCI: unresolved account for card ${last4}, currency ${currency}`);
  }

  if (provider === 'tenpo') {
    const isCreditCardActivity = cardHint === 'crédito' 
      || parsedResult.originalName?.toLowerCase().includes('tarjeta de crédito');
    
    if (isCreditCardActivity) {
      return config.accounts.tenpoCredit;
    }
    
    const isTransfer = parsedResult.beneficiary || parsedResult.entity;
    const isIncomingPayment = type === 'income' && parsedResult.beneficiary;
    
    if (isTransfer || isIncomingPayment) {
      return config.accounts.tenpoVista;
    }
    
    throw new Error('Tenpo: cannot distinguish between Vista accounts without more context');
  }

  if (provider === 'mercadopago') {
    return config.accounts.mercadopago;
  }

  throw new Error(`Unknown provider: ${provider}`);
}

function bankKey(value) {
  const text = String(value || '').toLowerCase().trim();
  if (/^(?:banco\s+)?bci$/.test(text)) return 'bci';
  if (/^tenpo(?: banco)?$/.test(text)) return 'tenpo';
  if (/^mercado\s*pago$/.test(text)) return 'mercadopago';
  return text;
}

function accountLast4(account) {
  if (typeof account !== 'string') return null;
  const token = account.trim();
  if (!/^[*xX•\d]+(?:(?:[ \t]+|[.-])[*xX•\d]+)*$/.test(token)) return null;
  const number = token.replace(/[ \t.-]/g, '');
  return /^(?:[*xX•]*\d{4}|\d{5,})$/.test(number) ? number.slice(-4) : null;
}

export function resolveTransferAccount(bank, currency, account, marker) {
  if (Array.isArray(account)) {
    const resolved = account.map(value => resolveTransferAccount(bank, currency, value));
    return resolved.length && resolved[0] && resolved.every((value, index) => value === resolved[0]
      && accountLast4(account[index]) === accountLast4(account[0]))
      ? resolved[0] : null;
  }
  const key = bankKey(bank);
  // Only a labeled account number is considered; never scan all digits in a body.
  const last4 = accountLast4(account);
  const signal = last4 || (account === undefined && marker);
  if (!signal) return null;
  const map = {
    'bci:CLP:1164': config.accounts.bciClp,
    'bci:USD:1164': config.accounts.bciUsd,
    'bci:CLP:8080': config.accounts.bciChecking,
    'tenpo:CLP:7648': config.accounts.tenpoCredit,
    'tenpo:CLP:credit': config.accounts.tenpoCredit,
    'tenpo:CLP:0146': config.accounts.tenpoVista,
    'mercadopago:CLP:6969': config.accounts.mercadopago,
    ...config.transferAccountMap,
  };
  return map[`${key}:${currency}:${signal}`] || null;
}

export function isInternalTransferCandidate(parsed) {
  return parsed.type === 'expense' && (parsed.ownCardPayment === true
    || /^raimundo\s+mena(?:\s+[a-záéíóúñ]+)*$/i.test(String(parsed.beneficiary || '').trim()));
}

export function resolveTransferDestination(parsed) {
  if (!isInternalTransferCandidate(parsed)) return null;
  const destination = resolveTransferAccount(parsed.entity, parsed.currency,
    parsed.beneficiaryAccount, parsed.ownCardPayment ? 'credit' : null);
  return destination && destination !== parsed.accountId ? destination : null;
}
