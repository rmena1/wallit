import { parseBci } from './parsers/bci.mjs';
import { parseTenpo } from './parsers/tenpo.mjs';
import { parseMercadoPago } from './parsers/mercadopago.mjs';
import { getProviderFromEmail, resolveAccount } from './lib/account-resolver.mjs';
import { isTransaction, chooseCategory } from './lib/classifier.mjs';
import { buildImportPayload, importToWallit } from './lib/import-client.mjs';
import { fetchNewEmails } from './lib/imap.mjs';
import {
  acquireAdvisoryLock,
  releaseAdvisoryLock,
  getCursor,
  updateCursor,
  resetCursorForNewUidvalidity,
  createProcessingLog,
  logProcessing,
  sql,
} from './lib/database.mjs';
import { getAccountSpace, isCategoryInAccountSpace } from './lib/../data/space-mappings.mjs';

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

async function processEmail(email, cursor) {
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
    const categoryId = await chooseCategory(email, parsed.originalName, parsed.accountId);
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

async function selfCheck() {
  console.error('Self-check: verifying service configuration');
  
  const { config } = await import('./config/index.mjs');
  
  const typesafeHost = new URL(config.typesafe.baseUrl).host;
  const typesafeKeySet = !!config.typesafe.apiKey;
  console.error(`  TypeSafe: baseUrl=${typesafeHost}, apiKey=${typesafeKeySet ? 'set' : 'NOT SET'}`);
  
  if (config.openai.apiKey) {
    const openaiHost = new URL(config.openai.baseUrl).host;
    console.error(`  OpenAI: baseUrl=${openaiHost}, apiKey=set`);
  } else {
    console.error(`  OpenAI: apiKey=NOT SET (Luna fallback unavailable)`);
  }
  
  const wallitHost = new URL(config.wallit.importUrl).host;
  const wallitTokenSet = !!config.wallit.importToken;
  console.error(`  Wallit: importUrl=${wallitHost}, importToken=${wallitTokenSet ? 'set' : 'NOT SET'}`);
}

async function main() {
  console.log('Bank email cron worker starting...');
  
  await selfCheck();
  
  await createProcessingLog();

  const lockAcquired = await acquireAdvisoryLock();
  if (!lockAcquired) {
    console.log('Another cron instance is running, exiting');
    process.exit(0);
  }

  try {
    const cursor = await getCursor();
    console.log(`Current cursor: UID ${cursor.lastUid}, UIDVALIDITY ${cursor.uidvalidity}`);

    const { uidvalidity, messages } = await fetchNewEmails(cursor.lastUid);
    
    if (cursor.uidvalidity !== null && cursor.uidvalidity !== uidvalidity) {
      await resetCursorForNewUidvalidity(uidvalidity);
      console.warn('UIDVALIDITY changed, cursor reset. Re-run to fetch from new baseline.');
      process.exit(0);
    }

    if (messages.length === 0) {
      console.log('No new messages to process');
      process.exit(0);
    }

    console.log(`Fetched ${messages.length} new messages`);

    messages.sort((a, b) => a.uid - b.uid);

    let lastSuccessfulUid = cursor.lastUid;
    
    for (const email of messages) {
      const result = await processEmail(email, cursor);
      
      if (result.advance) {
        lastSuccessfulUid = email.uid;
        await updateCursor(uidvalidity, lastSuccessfulUid);
      } else {
        console.error(`Stopping at UID ${email.uid} due to actionable error (cursor not advanced)`);
        break;
      }
    }

    console.log(`Worker completed. Last processed UID: ${lastSuccessfulUid}`);
    process.exit(0);

  } catch (error) {
    console.error('Worker failed:', error);
    process.exit(1);
  } finally {
    await releaseAdvisoryLock();
    await sql.end();
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
