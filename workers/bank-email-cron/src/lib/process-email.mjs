import { parseBci } from '../parsers/bci.mjs';
import { parseTenpo } from '../parsers/tenpo.mjs';
import { parseMercadoPago } from '../parsers/mercadopago.mjs';
import { getProviderFromEmail, resolveAccount, isInternalTransferCandidate } from './account-resolver.mjs';
import { buildImportPayload } from './import-client.mjs';
import { getAccountSpace, isCategoryInAccountSpace } from '../data/space-mappings.mjs';

export function createEmailProcessor({ isTransaction, chooseCategory, importToWallit, logProcessing }) {
  async function parseEmail(email) {
    const provider = getProviderFromEmail(email.from);
    if (!provider) {
      return { skip: true, reason: 'from_not_in_allowlist', provider: null };
    }

    email._source_email_provider = provider;

    const parsers = {
      bci: parseBci,
      tenpo: parseTenpo,
      mercadopago: parseMercadoPago,
    };

    const parser = parsers[provider];
    if (!parser) {
      return { skip: true, reason: 'no_parser', provider };
    }

    const result = parser(email);
    if (!result) {
      return { skip: true, reason: 'parser_no_match', provider };
    }

    return { skip: false, parsed: result, provider };
  }

  async function processEmail(email) {
    const logEntry = {
      uid: email.uid,
      messageId: email.messageId || `uid-${email.uid}`,
      from: email.from,
      subject: email.subject,
      decision: 'pending',
    };

    try {
      console.error(`[UID ${email.uid}] Step: before parse`);
      const parseResult = await parseEmail(email);
      console.error(`[UID ${email.uid}] Step: after parse (skip=${parseResult.skip}, provider=${parseResult.provider})`);
    
      if (parseResult.skip) {
        logEntry.provider = parseResult.provider;
        logEntry.decision = parseResult.reason;
        await logProcessing(logEntry);
        console.log(`UID ${email.uid}: ${parseResult.reason}, advancing cursor`);
        return { success: true, skip: true, advance: true };
      }

      const parsed = parseResult.parsed;
      logEntry.provider = parsed.provider;
      logEntry.parserSucceeded = true;

      console.error(`[UID ${email.uid}] Step: before isTransaction`);
      const txDecision = await isTransaction(email);
      console.error(`[UID ${email.uid}] Step: after isTransaction (result=${txDecision})`);
    
      if (!txDecision) {
        logEntry.decision = 'not_transaction';
        await logProcessing(logEntry);
        console.log(`UID ${email.uid}: not a transaction, advancing cursor`);
        return { success: true, skip: true, advance: true };
      }

      logEntry.decision = 'transaction';

      try {
        parsed.accountId = resolveAccount(parsed);
        logEntry.accountId = parsed.accountId;
      } catch (error) {
        logEntry.decision = 'account_unresolved';
        logEntry.errorMessage = error.message;
        await logProcessing(logEntry);
        console.error(`UID ${email.uid}: ${error.message}, stopping (requires manual fix)`);
        return { success: false, error: error.message, advance: false };
      }

      const accountSpace = getAccountSpace(parsed.accountId);
      console.error(`[UID ${email.uid}] Resolved account ${parsed.accountId} in space ${accountSpace}`);

      console.error(`[UID ${email.uid}] Step: before chooseCategory`);
      const categoryId = isInternalTransferCandidate(parsed) ? null
        : await chooseCategory(email, parsed.originalName, parsed.accountId);
      console.error(`[UID ${email.uid}] Step: after chooseCategory (categoryId=${categoryId})`);
    
      logEntry.categoryId = categoryId;

      let validatedCategoryId = categoryId;
      if (categoryId && !isCategoryInAccountSpace(categoryId, parsed.accountId)) {
        console.warn(
          `[UID ${email.uid}] Defensive guard: category ${categoryId} does not belong to account ${parsed.accountId} space, setting to null`
        );
        validatedCategoryId = null;
        logEntry.categoryId = null;
      }

      const payload = buildImportPayload(parsed, validatedCategoryId, email.messageId);
    
      console.error(`[UID ${email.uid}] Step: before import`);
      const importResult = await importToWallit(payload);
      console.error(`[UID ${email.uid}] Step: after import (success=${importResult.success})`);
    
      if (!importResult.success) throw new Error('Import API did not confirm success');
      logEntry.importSuccess = importResult.success;
      logEntry.importDuplicate = importResult.duplicate || false;
      logEntry.decision = importResult.duplicate ? 'duplicate_success' : 'imported';
    
      await logProcessing(logEntry);

      if (importResult.duplicate) {
        console.log(`UID ${email.uid}: duplicate import, advancing cursor`);
        return { success: true, skip: false, advance: true };
      }

      console.log(`UID ${email.uid}: imported successfully as ${importResult.movementId}`);
      return { success: true, skip: false, advance: true };

    } catch (error) {
      console.error(`[UID ${email.uid}] Step: on catch`, {
        message: error.message,
        name: error.name,
        causeCode: error.cause?.code,
        causeMessage: error.cause?.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      });
    
      logEntry.decision = 'error';
      logEntry.errorMessage = error.message;
    
      if (logEntry.accountId) {
        const accountSpace = getAccountSpace(logEntry.accountId);
        console.error(`[UID ${email.uid}] Error context: accountId=${logEntry.accountId}, accountSpace=${accountSpace}, categoryId=${logEntry.categoryId || 'null'}`);
      }
    
      await logProcessing(logEntry);
      console.error(`UID ${email.uid}: processing failed, stopping (will retry next cron):`, error.message);
      return { success: false, error: error.message, advance: false };
    }
  }

  return processEmail;
}
