import { config } from '../config/index.mjs';

export async function importToWallit(payload) {
  const response = await fetch(config.wallit.importUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.wallit.importToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(`Import API error: ${response.status} ${JSON.stringify(result)}`);
  }

  return result;
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
