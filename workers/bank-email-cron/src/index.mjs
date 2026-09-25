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
    const txDecision = await isTransaction(email);
    if (!txDecision) {
      logEntry.decision = 'not_transaction';
      await logProcessing(logEntry);
      console.log(`UID ${email.uid}: not a transaction, skipping`);
      return { success: true, skip: true };
    }

    logEntry.decision = 'transaction';

    const parseResult = await parseEmail(email);
    if (parseResult.skip) {
      logEntry.provider = parseResult.provider;
      logEntry.decision = parseResult.reason;
      await logProcessing(logEntry);
      console.log(`UID ${email.uid}: ${parseResult.reason}`);
      return { success: true, skip: true };
    }

    const parsed = parseResult.parsed;
    logEntry.provider = parsed.provider;
    logEntry.parserSucceeded = true;

    try {
      parsed.accountId = resolveAccount(parsed);
    } catch (error) {
      logEntry.decision = 'account_unresolved';
      logEntry.errorMessage = error.message;
      await logProcessing(logEntry);
      console.error(`UID ${email.uid}: ${error.message}`);
      return { success: false, error: error.message };
    }

    const categoryId = await chooseCategory(email, parsed.originalName);
    logEntry.categoryId = categoryId;

    const payload = buildImportPayload(parsed, categoryId, email.messageId);
    
    const importResult = await importToWallit(payload);
    logEntry.importSuccess = importResult.success;
    logEntry.importDuplicate = importResult.duplicate || false;
    logEntry.decision = importResult.duplicate ? 'duplicate_success' : 'imported';
    
    await logProcessing(logEntry);

    if (importResult.duplicate) {
      console.log(`UID ${email.uid}: duplicate import, advancing cursor`);
      return { success: true, skip: false };
    }

    console.log(`UID ${email.uid}: imported successfully as ${importResult.movementId}`);
    return { success: true, skip: false };

  } catch (error) {
    logEntry.decision = 'error';
    logEntry.errorMessage = error.message;
    await logProcessing(logEntry);
    console.error(`UID ${email.uid}: processing failed:`, error);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('Bank email cron worker starting...');
  
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
      
      if (!result.success) {
        console.error(`Stopping at UID ${email.uid} due to error`);
        break;
      }

      lastSuccessfulUid = email.uid;
      await updateCursor(uidvalidity, lastSuccessfulUid);
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
