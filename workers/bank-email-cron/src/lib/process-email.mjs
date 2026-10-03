import { createHash } from 'node:crypto';
import { parseBci } from '../parsers/bci.mjs';
import { parseTenpo } from '../parsers/tenpo.mjs';
import { parseMercadoPago } from '../parsers/mercadopago.mjs';
import { getProviderFromEmail, resolveAccount, isInternalTransferCandidate } from './account-resolver.mjs';
import { buildImportPayload } from './import-client.mjs';
import { isCategoryInAccountSpace } from '../data/space-mappings.mjs';
import { validateParsed, looksLikeTransactionNotice } from './parser-validation.mjs';
import { requireBudget } from './run-budget.mjs';
import { config } from '../config/index.mjs';

export function sourceIdentity(email) {
  if (typeof email.messageId === 'string' && email.messageId.trim()
    && email.messageId.length <= 998 && !/[\r\n]/.test(email.messageId)) return email.messageId.trim().replace(/^<|>$/g, '');
  if (!Number.isSafeInteger(email.uid) || !Number.isSafeInteger(email.uidvalidity)
    || email.uid <= 0 || email.uidvalidity <= 0) throw new Error('source_identity_missing');
  return `imap:${createHash('sha256').update([config.gmail.user.toLowerCase(), config.gmail.folder, email.uidvalidity, email.uid].join('\0')).digest('hex')}`;
}
const hash = value => createHash('sha256').update(String(value)).digest('hex');
function safeError(error) {
  const message = String(error?.message || '');
  return /^(?:parser_[a-z_]+|source_identity_missing|mime_parse_failed|message_too_large|authentication_missing|parser_no_match_transaction|classifier_invalid_decision|import_not_confirmed|database_session_lost|run_budget_exhausted)$/.test(message)
    || /^Credit card payment: unresolved source account \(bank=[a-z]+ currency=(?:CLP|USD) last4=(?:\d{4}|unknown)\)$/.test(message)
    ? message : 'processing_failed';
}

export function createEmailProcessor({ isTransaction, chooseCategory, importToWallit, logProcessing, logger = console, assertRunActive = async () => {} }) {
  return async function processEmail(email, runtime = {}) {
    const provider = getProviderFromEmail(email.from);
    const entry = { uid: email.uid, messageId: hash(email.messageId || `uid:${email.uidvalidity}:${email.uid}`),
      from: provider || 'untrusted', subject: '', provider, decision: 'pending' };
    const skip = async reason => {
      entry.decision = reason; await logProcessing(entry);
      logger.log(`UID ${email.uid}: ${reason}, advancing cursor`);
      return { success: true, skip: true, advance: true, reason };
    };
    try {
      requireBudget(runtime);
      if (email.decodeError) throw new Error(email.decodeError);
      if (!provider) return await skip('from_not_in_allowlist');
      if (!email.authentication?.verified) {
        if (email.authentication?.reason === 'authentication_failed') return await skip('authentication_failed');
        throw new Error('authentication_missing');
      }
      const parsed = validateParsed({ bci: parseBci, tenpo: parseTenpo, mercadopago: parseMercadoPago }[provider](email));
      if (!parsed) {
        if (looksLikeTransactionNotice(email)) throw new Error('parser_no_match_transaction');
        return await skip('parser_no_match');
      }
      const identity = sourceIdentity(email);
      entry.messageId = hash(identity);
      entry.parserSucceeded = true;
      const txDecision = await isTransaction(email, runtime);
      if (typeof txDecision !== 'boolean') throw new Error('classifier_invalid_decision');
      if (!txDecision) return await skip('not_transaction');
      try { parsed.accountId = resolveAccount(parsed); }
      catch (error) {
        entry.decision = 'account_unresolved'; entry.errorMessage = safeError(error); await logProcessing(entry);
        logger.error(`UID ${email.uid}: account_unresolved, stopping`);
        return { success: false, advance: false, error: entry.errorMessage };
      }
      entry.accountId = parsed.accountId;
      const category = isInternalTransferCandidate(parsed) ? null : await chooseCategory(email, parsed.originalName, parsed.accountId, runtime);
      const categoryId = category && isCategoryInAccountSpace(category, parsed.accountId) ? category : null;
      entry.categoryId = categoryId;
      requireBudget(runtime);
      await assertRunActive();
      requireBudget(runtime);
      const result = await importToWallit(buildImportPayload(parsed, categoryId, identity), { ...runtime, assertRunActive });
      if (result?.success !== true) throw new Error('import_not_confirmed');
      entry.importSuccess = true; entry.importDuplicate = result.duplicate === true;
      entry.decision = entry.importDuplicate ? 'duplicate_success' : 'imported';
      await logProcessing(entry);
      logger.log(`UID ${email.uid}: ${entry.decision}, advancing cursor`);
      return { success: true, skip: false, advance: true, reason: entry.decision };
    } catch (error) {
      entry.decision = 'error'; entry.errorMessage = safeError(error);
      await logProcessing(entry);
      logger.error(`UID ${email.uid}: ${entry.errorMessage}, stopping`);
      return { success: false, error: entry.errorMessage, advance: false };
    }
  };
}
