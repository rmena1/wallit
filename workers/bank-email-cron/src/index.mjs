import { createEmailProcessor } from './lib/process-email.mjs';
import { isTransaction, chooseCategory } from './lib/classifier.mjs';
import { importToWallit } from './lib/import-client.mjs';
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

const processEmail = createEmailProcessor({ isTransaction, chooseCategory, importToWallit, logProcessing });

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
      const result = await processEmail(email);
      
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
