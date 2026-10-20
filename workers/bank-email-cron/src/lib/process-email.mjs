import { parseIncomingMercadoPago } from '../parsers/incoming-mercadopago.mjs';
import { parseOwnBankTransfer } from '../parsers/own-bank-transfer.mjs';
import { createHash } from 'node:crypto';
import { parseBci } from '../parsers/bci.mjs';
import { parseTenpo } from '../parsers/tenpo.mjs';
import { parseMercadoPago } from '../parsers/mercadopago.mjs';
import { getProviderFromEmail, resolveAccount, resolveTransferDestination, isInternalTransferCandidate } from './account-resolver.mjs';
import { buildImportPayload } from './import-client.mjs';
import { isCategoryInAccountSpace } from '../data/space-mappings.mjs';
import { validateParsed, looksLikeTransactionNotice } from './parser-validation.mjs';
import { requireBudget } from './run-budget.mjs';
import { senderAddress } from './sender-auth.mjs';
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

export function createEmailProcessor({ isTransaction, chooseCategory, importToWallit, logProcessing, logger = console, assertRunActive = async () => {}, findHistoricalCategory = async () => null }) {
  return async function processEmail(email, runtime = {}) {
    const provider = getProviderFromEmail(email.from);
    const entry = { runId: runtime.runId, sender: provider ? senderAddress(email.from) : null,
      emailDate: email.date && Number.isFinite(new Date(email.date).getTime()) ? new Date(email.date).toISOString() : null,
      uid: email.uid, messageId: hash(typeof email.messageId === 'string' && email.messageId.trim() ? email.messageId.trim().replace(/^<|>$/g, '') : `uid:${email.uidvalidity}:${email.uid}`),
      from: provider || 'untrusted', subject: '', provider, decision: 'pending' };
    const skip = async (reason, advance = true) => {
      entry.decision = reason; await logProcessing(entry);
      logger.log(`UID ${email.uid}: ${reason}, ${advance ? 'advancing cursor' : 'cursor retained'}`);
      return { success: true, skip: true, advance, reason };
    };
    try {
      if (runtime.deferred) return await skip('processing_deferred', false);
      requireBudget(runtime);
      if (email.decodeError) throw new Error(email.decodeError);
      if (!provider) return await skip('from_not_in_allowlist');
      if (!email.authentication?.verified) {
        if (email.authentication?.reason === 'authentication_failed') return await skip('authentication_failed');
        throw new Error('authentication_missing');
      }
      const incoming = parseIncomingMercadoPago(email);
      if (incoming?.skipReason) return await skip(incoming.skipReason);
      const parsed = validateParsed(incoming ?? parseOwnBankTransfer(email) ?? { bci: parseBci, tenpo: parseTenpo, mercadopago: parseMercadoPago }[provider]?.(email));
      if (!parsed) {
        if (looksLikeTransactionNotice(email)) throw new Error('parser_no_match_transaction');
        return await skip('parser_no_match');
      }
      entry.parserSucceeded = true;
      // Persist an actionable disposition before advancing. No AI or import is
      // needed for an unmapped BCI notice; other failures retain retry semantics.
      if (provider === 'bci' && !parsed.ownBankTransfer) {
        try {
          const accountId = resolveAccount(parsed);
          if (parsed.ownCardPayment && !resolveTransferDestination({ ...parsed, accountId })) {
            throw new Error('bci_account_unresolved');
          }
        } catch {
          entry.decision = 'account_unresolved'; entry.errorMessage = 'bci_account_unresolved';
          await logProcessing(entry);
          logger.error(`UID ${email.uid}: ALERT bci_account_unresolved, advancing cursor`);
          return { success: true, advance: true, reason: 'account_unresolved' };
        }
      }
      const identity = sourceIdentity(email);
      entry.messageId = hash(identity);
      let historyAccountId = null;
      if (parsed.type === 'expense' && !parsed.ownBankTransfer && !isInternalTransferCandidate(parsed)) {
        // Preserve the existing classifier/error flow if account resolution fails.
        try { historyAccountId = resolveAccount(parsed); } catch { /* reported below */ }
      }
      const historicalCategory = historyAccountId
        ? await findHistoricalCategory({ originalName: parsed.originalName, provider: parsed.provider,
          sourceEmailId: identity, accountId: historyAccountId })
        : null;
      const txDecision = parsed.incomingBankTransfer || parsed.ownBankTransfer || historicalCategory ? true : await isTransaction(email, runtime);
      if (typeof txDecision !== 'boolean') throw new Error('classifier_invalid_decision');
      if (!txDecision) return await skip('not_transaction');
      try { parsed.accountId = parsed.ownBankTransfer ? null : resolveAccount(parsed); }
      catch (error) {
        entry.decision = 'account_unresolved'; entry.errorMessage = safeError(error); await logProcessing(entry);
        logger.error(`UID ${email.uid}: account_unresolved, stopping`);
        return { success: false, advance: false, error: entry.errorMessage };
      }
      entry.accountId = parsed.accountId;
      const category = parsed.incomingBankTransfer || parsed.ownBankTransfer || isInternalTransferCandidate(parsed) ? null
        : historicalCategory ?? await chooseCategory(email, parsed.originalName, parsed.accountId, runtime);
      // History can contain categories created after the static classifier mappings.
      // Historical votes apply across Spaces; the API verifies their provenance.
      const categoryId = historicalCategory ?? (category && isCategoryInAccountSpace(category, parsed.accountId) ? category : null);
      entry.categoryId = categoryId;
      requireBudget(runtime);
      await assertRunActive();
      requireBudget(runtime);
      const result = await importToWallit(buildImportPayload(parsed, categoryId, identity), { ...runtime, assertRunActive });
      if (result?.success === true && result.unresolved === true) {
        if (result.reason !== 'incoming_manual_ambiguous') throw new Error('import_not_confirmed');
        entry.decision = 'incoming_manual_ambiguous';
        await logProcessing(entry);
        logger.error(`UID ${email.uid}: unresolved incoming evidence retained, advancing cursor`);
        return { success: true, advance: true, reason: entry.decision };
      }
      if (result?.success !== true) throw new Error('import_not_confirmed');
      entry.importSuccess = true; entry.importDuplicate = result.duplicate === true;
      entry.decision = entry.importDuplicate ? 'duplicate_success' : result.pendingAccounts ? 'transfer_pending_accounts' : 'imported';
      await logProcessing(entry);
      logger.log(`UID ${email.uid}: ${entry.decision}, advancing cursor`);
      return { success: true, skip: false, advance: true, reason: entry.decision };
    } catch (error) {
      entry.decision = 'error'; entry.errorMessage = safeError(error);
      if (error?.message === 'incoming_manual_ambiguous') entry.errorMessage = 'incoming_manual_ambiguous';
      await logProcessing(entry);
      logger.error(`UID ${email.uid}: ${entry.errorMessage}, stopping`);
      return { success: false, error: entry.errorMessage, advance: false };
    }
  };
}
