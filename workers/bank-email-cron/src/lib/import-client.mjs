import { isInternalTransferCandidate, resolveTransferDestination } from './account-resolver.mjs';
import { requireBudget, boundedTimeout } from './run-budget.mjs';
import { config } from '../config/index.mjs';
const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ABORT_ERR']);
const retryStatus = status => status === 429 || status >= 500;
export function createImportClient({ fetchImpl = (...args) => fetch(...args),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = config.wallit.timeoutMs,
  logger = console } = {}) {
  return async function send(payload, runtime = {}) {
    // Transport retries preserve the exact serialized identity and payload.
    const body = JSON.stringify(payload);
    for (let attempt = 0; attempt < 3; attempt++) {
      requireBudget(runtime);
      await runtime.assertRunActive?.();
      requireBudget(runtime);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs, runtime));
      let status;
      try {
        const response = await fetchImpl(config.wallit.importUrl, { method: 'POST',
          headers: { Authorization: `Bearer ${config.wallit.importToken}`, 'Content-Type': 'application/json' },
          body, signal: controller.signal });
        status = response.status;
        if (status === 400 && payload.kind === 'movement' && payload.type === 'expense' && payload.categoryId) {
          const rejection = await response.json();
          if (rejection?.success === false && rejection.error === 'Category does not belong to account Space') {
            // A category can move/disappear after lookup. Retry this same import
            // uncategorized; never apply a foreign category or skip the expense.
            clearTimeout(timer);
            return send({ ...payload, categoryId: null }, runtime)
              .then(result => ({ ...result, categoryRejected: true }));
          }
        }
        if (!response.ok) throw Object.assign(new Error('http_failure'), { retryable: retryStatus(status) });
        const result = await response.json();
        if (!result || result.success !== true || (result.duplicate !== undefined && typeof result.duplicate !== 'boolean')) {
          throw new Error('invalid_import_response');
        }
        return result;
      } catch (error) {
        requireBudget(runtime);
        const code = [error.code, error.cause?.code].find(value => NETWORK_CODES.has(value));
        const retryable = error.retryable === true || code || error.name === 'AbortError'
          || controller.signal.aborted || /fetch failed/.test(error.message);
        if (!retryable || attempt === 2) {
          throw new Error(`Wallit import failed after ${attempt + 1} attempt(s)${status ? `; HTTP ${status}` : code ? `; ${code}` : '; transport or invalid response'}`);
        }
        logger.warn(`Wallit import transient failure; retry ${attempt + 2}/3`);
      } finally { clearTimeout(timer); }
      await sleep(Math.min(500 * 2 ** attempt, requireBudget(runtime)));
    }
  };
}
export const importToWallit = createImportClient();

export function buildImportPayload(parsedResult, categoryId, sourceEmailId) {
  if (parsedResult.ownBankTransfer) return {
    kind: 'own-bank-transfer', userId: config.wallit.userId,
    sourceEmailProvider: parsedResult.provider, sourceEmailId,
    currency: parsedResult.currency, amount: parsedResult.amount, date: parsedResult.date,
    time: parsedResult.time || null, originalName: parsedResult.originalName,
    ...parsedResult.ownBankTransfer,
  };
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

  if (isInternalTransferCandidate(parsedResult)) {
    const destination = resolveTransferDestination(parsedResult);
    if (destination) {
      payload.kind = 'transfer';
      payload.fromAccountId = parsedResult.accountId;
      payload.toAccountId = destination;
      payload.sourceName = parsedResult.name;
      delete payload.accountId;
      delete payload.categoryId;
      delete payload.name;
      delete payload.type;
      // API derives reportability/review from the actual account Spaces.
    } else {
      if (parsedResult.ownCardPayment) throw new Error('parser_ambiguous_repayment_destination');
      payload.type = 'expense';
      payload.needsReview = false;
      payload.categoryId = null;
    }
  }
  return payload;
}
