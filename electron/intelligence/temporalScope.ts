import type { AskPlutoTemporalRange } from '../../src/types/askPlutoQuery';

export interface ResolvedTemporalQuery {
  range: AskPlutoTemporalRange;
  matchedText: string;
}

const startOfLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const startOfLocalWeek = (date: Date): Date => {
  const start = startOfLocalDay(date);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
};

const addLocalDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const localDate = (year: number, month: number, day: number): Date | null => {
  const value = new Date(year, month - 1, day);
  return value.getFullYear() === year &&
    value.getMonth() === month - 1 &&
    value.getDate() === day
    ? value
    : null;
};

const buildRange = (
  from: Date,
  toExclusive: Date,
  label: string,
  matchedText: string,
): ResolvedTemporalQuery => ({
  range: {
    fromInclusive: from.toISOString(),
    toExclusive: toExclusive.toISOString(),
    label,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
  },
  matchedText,
});

export const resolveTemporalQuery = (
  query: string,
  now = new Date(),
): ResolvedTemporalQuery | null => {
  const relative = query.match(
    /\b(today(?:['’]s)?|yesterday|this week|last week|last\s+(\d{1,3})\s+days?)\b/i,
  );
  if (relative) {
    const phrase = relative[1].toLowerCase().replace('’', "'");
    if (phrase.startsWith('today')) {
      const from = startOfLocalDay(now);
      return buildRange(from, addLocalDays(from, 1), 'today', relative[0]);
    }
    if (phrase === 'yesterday') {
      const toExclusive = startOfLocalDay(now);
      return buildRange(
        addLocalDays(toExclusive, -1),
        toExclusive,
        'yesterday',
        relative[0],
      );
    }
    if (phrase === 'this week') {
      const from = startOfLocalWeek(now);
      return buildRange(from, addLocalDays(from, 7), 'this week', relative[0]);
    }
    if (phrase === 'last week') {
      const toExclusive = startOfLocalWeek(now);
      return buildRange(
        addLocalDays(toExclusive, -7),
        toExclusive,
        'last week',
        relative[0],
      );
    }
    const dayCount = Number(relative[2]);
    if (Number.isInteger(dayCount) && dayCount > 0) {
      const toExclusive = addLocalDays(startOfLocalDay(now), 1);
      return buildRange(
        addLocalDays(toExclusive, -dayCount),
        toExclusive,
        `last ${dayCount} days`,
        relative[0],
      );
    }
  }

  const iso = query.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (!iso) return null;
  const from = localDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  if (!from) return null;
  return buildRange(from, addLocalDays(from, 1), iso[0], iso[0]);
};

export const removeTemporalPhrase = (
  query: string,
  resolved: ResolvedTemporalQuery | null,
): string =>
  resolved
    ? query.replace(resolved.matchedText, ' ').replace(/\s+/g, ' ')
    : query;
