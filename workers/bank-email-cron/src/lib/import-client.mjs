import { config } from '../config/index.mjs';

function enrichError(error, context) {
  const parts = [context];
  
  if (error.message) {
    parts.push(error.message);
  }
  
  if (error.cause) {
    const causeChain = [];
    let current = error.cause;
    while (current) {
      const causeInfo = [];
      if (current.code) causeInfo.push(`code: ${current.code}`);
      if (current.message) causeInfo.push(`message: ${current.message}`);
      if (causeInfo.length > 0) {
        causeChain.push(causeInfo.join(', '));
      }
      current = current.cause;
    }
    
    if (causeChain.length > 0) {
      parts.push(`cause: ${causeChain.join(' -> ')}`);
    }
  }
  
  const enriched = new Error(parts.join('; '), { cause: error.cause || error });
  
  if (error.response) {
    enriched.response = error.response;
  }
  
  return enriched;
}

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ABORT_ERR',
]);

const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);

function isTransientError(error, response) {
  if (response && TRANSIENT_HTTP_STATUSES.has(response.status)) {
    return true;
  }
  
  if (error.cause?.code && TRANSIENT_NETWORK_CODES.has(error.cause.code)) {
    return true;
  }
  
  if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
    return true;
  }
  
  if (error.message?.includes('fetch failed')) {
    return true;
  }
  
  return false;
}

async function withRetry(fn, { maxRetries = 3, baseDelayMs = 500, context = 'Operation' } = {}) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      const isTransient = isTransientError(error, error.response);
      
      if (!isTransient || attempt === maxRetries) {
        throw enrichError(error, `${context} failed after ${attempt + 1} attempt(s)`);
      }
      
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      console.warn(
        `${context} attempt ${attempt + 1}/${maxRetries + 1} failed (transient), retrying in ${delayMs}ms:`,
        error.message
      );
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw enrichError(lastError, `${context} exhausted retries`);
}

export async function importToWallit(payload) {
  return await withRetry(
    async () => {
      let response;
      try {
        response = await fetch(config.wallit.importUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.wallit.importToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        throw enrichError(error, `Wallit import POST ${config.wallit.importUrl} failed`);
      }

      const result = await response.json();

      if (!response.ok) {
        const error = new Error(`Import API error: ${response.status} ${JSON.stringify(result)}`);
        error.response = response;
        throw error;
      }

      return result;
    },
    { maxRetries: 2, baseDelayMs: 500, context: 'Wallit import API call' }
  );
}

export function buildImportPayload(parsedResult, categoryId, sourceEmailId) {
  const payload = {
    kind: 'movement',
    userId: config.wallit.userId,
    accountId: parsedResult.accountId,
    categoryId: categoryId || null,
    name: parsedResult.name,
    originalName: parsedResult.originalName,
    date: parsedResult.date,
    time: parsedResult.time || null,
    type: parsedResult.type,
    currency: parsedResult.currency,
    sourceEmailProvider: parsedResult.provider,
    sourceEmailId: sourceEmailId,
  };

  if (parsedResult.currency === 'USD') {
    payload.amountUsd = parsedResult.amountUsd;
    payload.exchangeRate = config.exchangeRate.usdClpX100;
  } else {
    payload.amount = parsedResult.amount;
  }

  return payload;
}
