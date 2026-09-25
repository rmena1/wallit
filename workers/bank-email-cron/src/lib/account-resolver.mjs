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
