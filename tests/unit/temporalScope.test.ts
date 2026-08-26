import { describe, expect, it } from 'vitest';

import {
  removeTemporalPhrase,
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
