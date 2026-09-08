import { describe, expect, it } from 'vitest';
import { createNotesReplayClock } from '../../scripts/lib/notesReplayClock';
import { createMeetingNotesOptionalReviewBudget } from '../../electron/meetingAnalysisRuns';

describe('recorded replay clock', () => {
  it('preserves elapsed optional-review admission instead of granting a fresh budget', () => {
    const clock = createNotesReplayClock(1000);
    const budget = createMeetingNotesOptionalReviewBudget(clock.now());
    clock.advance(521000);
    expect(budget.optionalReviewDeadlineAtMs - clock.now()).toBeLessThan(
      budget.optionalReviewMinStartMs,
    );
  });
  it('rejects missing and backwards boundaries', () => {
    expect(() => createNotesReplayClock(undefined)).toThrow(
      'recorded_clock_start_missing',
    );
    const clock = createNotesReplayClock(10);
    expect(() => clock.advance(undefined)).toThrow(
      'recorded_clock_not_monotonic',
    );
    expect(() => clock.advance(9)).toThrow('recorded_clock_not_monotonic');
    clock.advance(10);
    clock.advance(11);
    expect(clock.now()).toBe(11);
  });
});
