// A lost session invalidates this entire run, even if postgres reconnects.
export function createLockSessionGuard() {
  let pid = null, active = false, lost = false;
  return {
    acquired(value) { if (lost) throw new Error('database_session_lost'); pid = value; active = true; },
    invalidate() { lost = true; },
    connectionClosed() { if (active) lost = true; },
    assertActive() { if (!active || lost) throw new Error('database_session_lost'); },
    verify(value, held = true) {
      if (!active || lost || pid !== value || !held) { lost = true; throw new Error('database_session_lost'); }
    },
    released() { active = false; },
    get lost() { return lost; },
  };
}
