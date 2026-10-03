import { createEmailProcessor } from './lib/process-email.mjs';
import { isTransaction, chooseCategory } from './lib/classifier.mjs';
import { importToWallit } from './lib/import-client.mjs';
import { fetchNewEmails } from './lib/imap.mjs';
import { runWorker } from './lib/worker-runner.mjs';
import { acquireAdvisoryLock, releaseAdvisoryLock, getCursor, updateCursor,
  createProcessingLog, logProcessing, closeDatabase, assertAdvisoryLock } from './lib/database.mjs';
console.log('Bank email cron worker starting');
const result = await runWorker({
  acquireAdvisoryLock, releaseAdvisoryLock, getCursor, updateCursor,
  createProcessingLog, fetchNewEmails, closeDatabase,
  processEmail: createEmailProcessor({ isTransaction, chooseCategory, importToWallit, logProcessing, assertRunActive: assertAdvisoryLock }),
});
console.log(`Worker outcome: ${result.reason}; last UID: ${result.lastSuccessfulUid ?? 'unchanged'}`);
process.exitCode = result.exitCode;
