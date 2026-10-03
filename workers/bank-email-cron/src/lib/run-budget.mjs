export function remainingMs({ deadlineMs = Infinity, now = Date.now } = {}) {
  return Math.max(0, deadlineMs - now());
}
export function requireBudget(runtime) {
  const remaining = remainingMs(runtime);
  if (remaining <= 0) throw new Error('run_budget_exhausted');
  return remaining;
}
export function boundedTimeout(limit, runtime) { return Math.max(1, Math.min(limit, requireBudget(runtime))); }
