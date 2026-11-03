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

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MONTH_PATTERN =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
const monthIndex = (name: string): number =>
  MONTHS.findIndex((month) => month.startsWith(name.toLowerCase().slice(0, 3)));

const formatDay = (date: Date): string =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    date,
  );

// A date written without a year means its most recent occurrence, unless it
// is only slightly ahead (an upcoming day this week or next).
const inferYear = (month: number, day: number, now: Date): number => {
  const candidate = localDate(now.getFullYear(), month, day);
  if (!candidate) return now.getFullYear();
  return candidate.getTime() - startOfLocalDay(now).getTime() >
    14 * 24 * 60 * 60 * 1000
    ? now.getFullYear() - 1
    : now.getFullYear();
};

const expandYear = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const year = Number(value);
  return value.length === 2 ? 2000 + year : year;
};

export interface TemporalDayMention {
  from: Date;
  toExclusive: Date;
  label: string;
  matchedText: string;
}

// Every explicit calendar day in the question, in order of appearance.
export const resolveTemporalDayMentions = (
  query: string,
  now = new Date(),
): TemporalDayMention[] => {
  const mentions: Array<TemporalDayMention & { index: number }> = [];
  const add = (date: Date | null, matchedText: string, index: number) => {
    if (!date) return;
    mentions.push({
      from: date,
      toExclusive: addLocalDays(date, 1),
      label: formatDay(date),
      matchedText,
      index,
    });
  };
  for (const match of query.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))
    add(
      localDate(Number(match[1]), Number(match[2]), Number(match[3])),
      match[0],
      match.index ?? 0,
    );
  for (const match of query.matchAll(
    /(?<![\d/.-])(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?![\d/%])(?!\s+(?:of|an?|the|cup|split)\b)/gi,
  )) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    add(
      localDate(expandYear(match[3], inferYear(month, day, now)), month, day),
      match[0],
      match.index ?? 0,
    );
  }
  for (const match of query.matchAll(
    new RegExp(
      `\\b${MONTH_PATTERN}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
      'gi',
    ),
  )) {
    const month = monthIndex(match[1]) + 1;
    const day = Number(match[2]);
    add(
      localDate(expandYear(match[3], inferYear(month, day, now)), month, day),
      match[0],
      match.index ?? 0,
    );
  }
  for (const match of query.matchAll(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_PATTERN}\\b(?:,?\\s+(\\d{4}))?`,
      'gi',
    ),
  )) {
    const month = monthIndex(match[2]) + 1;
    const day = Number(match[1]);
    add(
      localDate(expandYear(match[3], inferYear(month, day, now)), month, day),
      match[0],
      match.index ?? 0,
    );
  }
  const seen = new Set<number>();
  return mentions
    .sort((left, right) => left.index - right.index)
    .filter((mention) => {
      const key = mention.from.getTime();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ index: _index, ...mention }) => mention);
};

export const resolveTemporalQuery = (
  query: string,
  now = new Date(),
): ResolvedTemporalQuery | null => {
  const relative = query.match(
    /\b(today(?:['’]s)?|yesterday|tomorrow(?:['’]s)?|this week|last week|next week|this month|last month|next month|(?:last|past|previous)\s+(\d{1,3})\s+(days?|weeks?|months?))\b/i,
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
    if (phrase.startsWith('tomorrow')) {
      const from = addLocalDays(startOfLocalDay(now), 1);
      return buildRange(from, addLocalDays(from, 1), 'tomorrow', relative[0]);
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
    if (phrase === 'next week') {
      const from = addLocalDays(startOfLocalWeek(now), 7);
      return buildRange(from, addLocalDays(from, 7), 'next week', relative[0]);
    }
    if (phrase.endsWith('month')) {
      const offset = phrase.startsWith('last')
        ? -1
        : phrase.startsWith('next')
          ? 1
          : 0;
      const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      return buildRange(
        from,
        new Date(from.getFullYear(), from.getMonth() + 1, 1),
        phrase,
        relative[0],
      );
    }
    const count = Number(relative[2]);
    const unit = relative[3]?.toLowerCase() ?? '';
    if (Number.isInteger(count) && count > 0) {
      const toExclusive = addLocalDays(startOfLocalDay(now), 1);
      const from = unit.startsWith('month')
        ? new Date(
            toExclusive.getFullYear(),
            toExclusive.getMonth() - count,
            toExclusive.getDate(),
          )
        : addLocalDays(toExclusive, -count * (unit.startsWith('week') ? 7 : 1));
      const unitLabel = unit.startsWith('month')
        ? 'months'
        : unit.startsWith('week')
          ? 'weeks'
          : 'days';
      return buildRange(
        from,
        toExclusive,
        `last ${count} ${count === 1 ? unitLabel.slice(0, -1) : unitLabel}`,
        relative[0],
      );
    }
  }

  // Several explicit days span from the first to the last; callers that need
  // the exact days use resolveTemporalDayMentions.
  const days = resolveTemporalDayMentions(query, now);
  if (days.length) {
    const first = days.reduce((a, b) => (a.from <= b.from ? a : b));
    const last = days.reduce((a, b) => (a.from >= b.from ? a : b));
    return buildRange(
      first.from,
      last.toExclusive,
      days.length === 1
        ? days[0].label
        : days.map((day) => day.label).join(' and '),
      days[0].matchedText,
    );
  }

  const month = query.match(
    new RegExp(
      `\\b(?:in|during|for|throughout|of|since)?\\s*${MONTH_PATTERN}\\b(?:\\s+(\\d{4}))?`,
      'i',
    ),
  );
  // "may" is also a verb; only accept it with a preposition or a year.
  if (
    month &&
    !(
      /^may$/i.test(month[1]) &&
      !/^\s*(?:in|during|for|throughout|of|since)\b/i.test(month[0]) &&
      !month[2]
    )
  ) {
    const index = monthIndex(month[1]);
    const year = month[2]
      ? Number(month[2])
      : index > now.getMonth()
        ? now.getFullYear() - 1
        : now.getFullYear();
    const from = new Date(year, index, 1);
    const since = /^\s*since\b/i.test(month[0]);
    return buildRange(
      from,
      since
        ? addLocalDays(startOfLocalDay(now), 1)
        : new Date(year, index + 1, 1),
      since
        ? `since ${MONTHS[index][0].toUpperCase()}${MONTHS[index].slice(1)}`
        : `${MONTHS[index][0].toUpperCase()}${MONTHS[index].slice(1)}${month[2] ? ` ${year}` : ''}`,
      month[0].trim(),
    );
  }

  const weekday = query.match(
    /\b(?:(last|this|next|on)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
  );
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2].toLowerCase());
    const today = startOfLocalDay(now);
    const qualifier = weekday[1]?.toLowerCase();
    let delta = target - today.getDay();
    if (qualifier === 'next') {
      if (delta <= 0) delta += 7;
    } else if (qualifier === 'last') {
      if (delta >= 0) delta -= 7;
    } else if (delta > 0) {
      // "on Monday" and a bare weekday refer to the most recent one.
      delta -= 7;
    }
    const from = addLocalDays(today, delta);
    return buildRange(
      from,
      addLocalDays(from, 1),
      `${qualifier && qualifier !== 'on' ? `${qualifier} ` : ''}${WEEKDAYS[target][0].toUpperCase()}${WEEKDAYS[target].slice(1)}`,
      weekday[0],
    );
  }
  return null;
};

// Ranges that start in the future are calendar questions, not meeting history.
export const isFutureTemporalRange = (
  range: { fromInclusive: string },
  now = new Date(),
): boolean =>
  range.fromInclusive >= addLocalDays(startOfLocalDay(now), 1).toISOString();

export const removeTemporalPhrase = (
  query: string,
  resolved: ResolvedTemporalQuery | null,
): string =>
  resolved
    ? query.replace(resolved.matchedText, ' ').replace(/\s+/g, ' ')
    : query;
