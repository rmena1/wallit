// No database, IMAP, HTTP or credential imports: every effect is injected.
export async function runWorker(deps, { logger = console, now = Date.now, budgetMs = 480_000 } = {}) {
  const started = now();
  const runtime = { deadlineMs: started + budgetMs, now };
  let locked = false;
  let outcome = { exitCode: 0, reason: 'completed', lastSuccessfulUid: null };
  try {
    locked = await deps.acquireAdvisoryLock();
    if (!locked) return outcome = { ...outcome, reason: 'lock_busy' };
    await deps.createProcessingLog();
    const cursor = await deps.getCursor();
    if (!Number.isSafeInteger(cursor.lastUid) || cursor.lastUid < 0 || cursor.lastUid > 0xffffffff
      || (cursor.uidvalidity !== null && (!Number.isSafeInteger(cursor.uidvalidity) || cursor.uidvalidity <= 0 || cursor.uidvalidity > 0xffffffff))) throw new Error('invalid_cursor');
    outcome.lastSuccessfulUid = cursor.lastUid;
    const { uidvalidity, messages } = await deps.fetchNewEmails(cursor.lastUid, cursor.uidvalidity, runtime);
    if (!Number.isSafeInteger(uidvalidity) || uidvalidity <= 0 || uidvalidity > 0xffffffff) throw new Error('invalid_uidvalidity');
    // Never reset/backfill automatically: imported movements may have been
    // intentionally deleted. A new mailbox epoch requires an operator decision.
    if (cursor.uidvalidity !== null && cursor.uidvalidity !== uidvalidity) {
      logger.error('Worker blocked: uidvalidity_changed; cursor preserved');
      return outcome = { ...outcome, exitCode: 1, reason: 'uidvalidity_changed' };
    }
    if (cursor.uidvalidity === null) await deps.updateCursor(uidvalidity, cursor.lastUid);
    for (const email of [...messages].sort((a, b) => a.uid - b.uid)) {
      if (!Number.isSafeInteger(email.uid) || email.uid <= 0 || email.uid > 0xffffffff) throw new Error('invalid_uid');
      if (email.uid <= outcome.lastSuccessfulUid) continue;
      if (now() - started >= budgetMs) return outcome = { ...outcome, reason: 'budget_reached' };
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
    if (locked) {
      try { await deps.releaseAdvisoryLock(); } catch { outcome.exitCode = 1; logger.error('Worker lock cleanup failed'); }
    }
    try { await deps.closeDatabase(); } catch { outcome.exitCode = 1; logger.error('Worker database cleanup failed'); }
  }
}
