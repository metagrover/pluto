import { describe, expect, it } from 'vitest';

import {
  isFutureTemporalRange,
  removeTemporalPhrase,
  resolveTemporalDayMentions,
  resolveTemporalQuery,
} from '../../electron/intelligence/temporalScope';

describe('resolveTemporalQuery', () => {
  const now = new Date(2026, 7, 25, 17, 30);

  it('resolves today and removes it from semantic keywords', () => {
    const resolved = resolveTemporalQuery("Summarize today's meetings", now);
    const start = new Date(2026, 7, 25);
    const end = new Date(2026, 7, 26);
    expect(resolved?.range).toMatchObject({
      fromInclusive: start.toISOString(),
      toExclusive: end.toISOString(),
      label: 'today',
    });
    expect(
      removeTemporalPhrase("Summarize today's meetings", resolved),
    ).not.toMatch(/today/i);
  });

  it('resolves yesterday using half-open local day boundaries', () => {
    const resolved = resolveTemporalQuery('Analyze yesterday', now);
    expect(resolved?.range.fromInclusive).toBe(
      new Date(2026, 7, 24).toISOString(),
    );
    expect(resolved?.range.toExclusive).toBe(
      new Date(2026, 7, 25).toISOString(),
    );
  });

  it('resolves this week and last week from Monday', () => {
    expect(resolveTemporalQuery('this week', now)?.range.fromInclusive).toBe(
      new Date(2026, 7, 24).toISOString(),
    );
    expect(resolveTemporalQuery('last week', now)?.range.fromInclusive).toBe(
      new Date(2026, 7, 17).toISOString(),
    );
  });

  it('resolves rolling day counts and ISO dates', () => {
    expect(
      resolveTemporalQuery('Review the last 3 days', now)?.range.fromInclusive,
    ).toBe(new Date(2026, 7, 23).toISOString());
    expect(
      resolveTemporalQuery('Review 2026-08-20', now)?.range.toExclusive,
    ).toBe(new Date(2026, 7, 21).toISOString());
  });

  it('rejects invalid dates and queries without a temporal phrase', () => {
    expect(resolveTemporalQuery('Review 2026-02-31', now)).toBeNull();
    expect(resolveTemporalQuery('Who owns pricing?', now)).toBeNull();
  });
});

describe('broader date understanding', () => {
  // Monday, November 2, 2026, local time.
  const now = new Date(2026, 10, 2, 21, 0);
  const day = (query: string) => {
    const resolved = resolveTemporalQuery(query, now);
    return resolved
      ? [
          new Date(resolved.range.fromInclusive).toDateString(),
          new Date(resolved.range.toExclusive).toDateString(),
          resolved.range.label,
        ]
      : null;
  };

  it('resolves named months to their most recent occurrence', () => {
    expect(day('How many 1:1s did I have with Ayush in September?')).toEqual([
      'Tue Sep 01 2026',
      'Thu Oct 01 2026',
      'September',
    ]);
    expect(day('What happened in December?')?.[0]).toBe('Mon Dec 01 2025');
    expect(day('Decisions from March 2025')?.[2]).toBe('March 2025');
  });

  it('does not treat the verb "may" as a month', () => {
    expect(
      resolveTemporalQuery('May I see the pilot decisions?', now),
    ).toBeNull();
    expect(day('What did we decide in May?')?.[2]).toBe('May');
  });

  it('resolves numeric and written calendar days', () => {
    expect(day('What happened on 9/16?')?.slice(0, 2)).toEqual([
      'Wed Sep 16 2026',
      'Thu Sep 17 2026',
    ]);
    expect(day('Notes from September 22nd')?.[0]).toBe('Tue Sep 22 2026');
    expect(day('Notes from 22 Sep 2025')?.[0]).toBe('Mon Sep 22 2025');
  });

  it('does not treat fractions as dates', () => {
    expect(resolveTemporalQuery('We need 3/4 of the budget', now)).toBeNull();
    expect(resolveTemporalQuery('Support is 24/7 now', now)).toBeNull();
  });

  it('lists every explicit day for comparisons', () => {
    expect(
      resolveTemporalDayMentions(
        'Compare the NCT check-ins on 9/16 versus 9/22.',
        now,
      ).map((mention) => mention.from.toDateString()),
    ).toEqual(['Wed Sep 16 2026', 'Tue Sep 22 2026']);
    expect(day('Compare 9/16 versus 9/22')?.slice(0, 2)).toEqual([
      'Wed Sep 16 2026',
      'Wed Sep 23 2026',
    ]);
  });

  it('resolves months, rolling weeks, weekdays and future ranges', () => {
    expect(day('last month')?.slice(0, 2)).toEqual([
      'Thu Oct 01 2026',
      'Sun Nov 01 2026',
    ]);
    expect(day('past 2 weeks')?.[0]).toBe('Tue Oct 20 2026');
    expect(day('What did Adam say on Friday?')?.[0]).toBe('Fri Oct 30 2026');
    expect(day('last Monday')?.[0]).toBe('Mon Oct 26 2026');
    const tomorrow = resolveTemporalQuery(
      'What meetings do I have tomorrow?',
      now,
    );
    expect(tomorrow && isFutureTemporalRange(tomorrow.range, now)).toBe(true);
    const lastWeek = resolveTemporalQuery('last week', now);
    expect(lastWeek && isFutureTemporalRange(lastWeek.range, now)).toBe(false);
    expect(day('next week')?.[0]).toBe('Mon Nov 09 2026');
  });
});
