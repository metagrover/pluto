import assert from 'node:assert/strict';

/** Discrete recorded boundaries, not a simulation of OS timers or scheduling. */
export function createNotesReplayClock(startedAt: unknown) {
  assert.ok(
    typeof startedAt === 'number' && Number.isFinite(startedAt),
    'recorded_clock_start_missing',
  );
  let current = startedAt;
  return {
    now: () => current,
    advance(at: unknown) {
      assert.ok(
        typeof at === 'number' && Number.isFinite(at) && at >= current,
        'recorded_clock_not_monotonic',
      );
      current = at;
    },
  };
}
