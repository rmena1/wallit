// No database, IMAP, HTTP or credential imports: every effect is injected.
export async function runWorker(deps, { logger = console, now = Date.now, budgetMs = 480_000 } = {}) {
  const started = now();
  const runtime = { deadlineMs: started + budgetMs, now };
  let locked = false;
  let fetched = [];
  const attempted = new Set();
  let outcome = { exitCode: 0, reason: 'completed', lastSuccessfulUid: null };
  try {
    locked = await deps.acquireAdvisoryLock();
    if (!locked) return outcome = { ...outcome, reason: 'lock_busy' };
    await deps.createProcessingLog();
    runtime.runId = await deps.startRun?.();
    const cursor = await deps.getCursor();
    if (!Number.isSafeInteger(cursor.lastUid) || cursor.lastUid < 0 || cursor.lastUid > 0xffffffff
      || (cursor.uidvalidity !== null && (!Number.isSafeInteger(cursor.uidvalidity) || cursor.uidvalidity <= 0 || cursor.uidvalidity > 0xffffffff))) throw new Error('invalid_cursor');
    outcome.lastSuccessfulUid = cursor.lastUid;
    const { uidvalidity, messages, searchMatchCount = null, fetchedCount = null } = await deps.fetchNewEmails(cursor.lastUid, cursor.uidvalidity, runtime);
    outcome.searchMatchCount = searchMatchCount; outcome.fetchedCount = fetchedCount;
    if (!Number.isSafeInteger(uidvalidity) || uidvalidity <= 0 || uidvalidity > 0xffffffff) throw new Error('invalid_uidvalidity');
    // Never reset/backfill automatically: imported movements may have been
    // intentionally deleted. A new mailbox epoch requires an operator decision.
    if (cursor.uidvalidity !== null && cursor.uidvalidity !== uidvalidity) {
      logger.error('Worker blocked: uidvalidity_changed; cursor preserved');
      return outcome = { ...outcome, exitCode: 1, reason: 'uidvalidity_changed' };
    }
    fetched = messages;
    if (cursor.uidvalidity === null) await deps.updateCursor(uidvalidity, cursor.lastUid);
    for (const email of [...messages].sort((a, b) => a.uid - b.uid)) {
      if (!Number.isSafeInteger(email.uid) || email.uid <= 0 || email.uid > 0xffffffff) throw new Error('invalid_uid');
      if (email.uid <= outcome.lastSuccessfulUid) continue;
      if (now() - started >= budgetMs) return outcome = { ...outcome, reason: 'budget_reached' };
      attempted.add(email.uid);
      const result = await deps.processEmail(email, runtime);
      if (result.error === 'run_budget_exhausted') return outcome = { ...outcome, reason: 'budget_reached' };
      if (!result.success || !result.advance) {
        logger.error(`Worker blocked at UID ${email.uid}; cursor preserved`);
        return outcome = { ...outcome, exitCode: 1, reason: 'message_blocked', blockedUid: email.uid };
      }
      await deps.updateCursor(uidvalidity, email.uid);
      outcome.lastSuccessfulUid = email.uid;
    }
    return outcome;
  } catch {
    logger.error('Worker failed; cursor preserved at last confirmed disposition');
    return outcome = { ...outcome, exitCode: 1, reason: 'worker_error' };
  } finally {
    for (const email of fetched.filter(email => email.uid > outcome.lastSuccessfulUid && !attempted.has(email.uid))) {
      try { await deps.processEmail(email, { ...runtime, deferred: true }); }
      catch { outcome.exitCode = 1; logger.error('Deferred email audit failed'); }
    }
    if (runtime.runId) {
      try { await deps.finishRun(runtime.runId, outcome); } catch { outcome.exitCode = 1; logger.error('Worker telemetry finalization failed'); }
    }
    if (locked) {
      try { await deps.releaseAdvisoryLock(); } catch { outcome.exitCode = 1; logger.error('Worker lock cleanup failed'); }
    }
    try { await deps.closeDatabase(); } catch { outcome.exitCode = 1; logger.error('Worker database cleanup failed'); }
  }
}
