// "What's overdue or slipping?" answered from canonical task state.
//
// Deadlines and completion live in Pluto's task records, not in meeting
// prose, so this answer reads them directly instead of asking a model to
// infer status from notes.

export interface AttentionItem {
  id: string;
  title: string;
  dueDate: string | null;
  createdAt: string | null;
  owner?: string | null;
  sourceMeetingId?: string | null;
  sourceMeetingTitle?: string | null;
}

export const isAttentionQuestion = (query: string): boolean =>
  /\b(?:overdue|slipping|slipped|past\s+due|late|behind|missed\s+(?:deadlines?|dates?)|falling\s+through|at\s+risk\s+of\s+slipping|due\s+(?:today|soon|this\s+week|next\s+week)|what(?:'s|\s+is)\s+due)\b/i.test(
    query,
  );

const DAY_MS = 24 * 60 * 60 * 1000;

const dayStart = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

// Task due dates are calendar days (YYYY-MM-DD) in local time.
const parseDue = (value: string | null): number | null => {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ).getTime();
};

const formatDue = (time: number): string =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(time),
  );

const line = (item: AttentionItem, detail: string): string =>
  `- ${item.title}${item.owner ? ` — ${item.owner}` : ''} (${detail})${item.sourceMeetingTitle ? ` · from “${item.sourceMeetingTitle}”` : ''}`;

export const buildAttentionAnswer = ({
  mine,
  others,
  now = new Date(),
}: {
  mine: readonly AttentionItem[];
  others: readonly AttentionItem[];
  now?: Date;
}): { answer: string; cited: AttentionItem[] } => {
  const today = dayStart(now);
  const overdue = mine
    .map((item) => ({ item, due: parseDue(item.dueDate) }))
    .filter(
      (entry): entry is { item: AttentionItem; due: number } =>
        entry.due !== null && entry.due < today,
    )
    .sort((left, right) => left.due - right.due);
  const dueSoon = mine
    .map((item) => ({ item, due: parseDue(item.dueDate) }))
    .filter(
      (entry): entry is { item: AttentionItem; due: number } =>
        entry.due !== null &&
        entry.due >= today &&
        entry.due < today + 7 * DAY_MS,
    )
    .sort((left, right) => left.due - right.due);
  const undatedStale = mine
    .filter((item) => !parseDue(item.dueDate) && item.createdAt)
    .map((item) => ({
      item,
      age: today - new Date(item.createdAt ?? '').getTime(),
    }))
    .filter((entry) => Number.isFinite(entry.age) && entry.age >= 14 * DAY_MS)
    .sort((left, right) => right.age - left.age);
  const othersOverdue = others
    .map((item) => ({ item, due: parseDue(item.dueDate) }))
    .filter(
      (entry): entry is { item: AttentionItem; due: number } =>
        entry.due !== null && entry.due < today,
    )
    .sort((left, right) => left.due - right.due);

  const sections: string[] = [];
  const cited: AttentionItem[] = [];
  const add = (title: string, rows: string[], items: AttentionItem[]) => {
    if (!rows.length) return;
    sections.push(
      `**${title}**\n${rows.slice(0, 8).join('\n')}${rows.length > 8 ? `\n- …and ${rows.length - 8} more` : ''}`,
    );
    cited.push(...items.slice(0, 8));
  };
  add(
    'Your overdue tasks',
    overdue.map(({ item, due }) => line(item, `was due ${formatDue(due)}`)),
    overdue.map(({ item }) => item),
  );
  add(
    'Due in the next 7 days',
    dueSoon.map(({ item, due }) => line(item, `due ${formatDue(due)}`)),
    dueSoon.map(({ item }) => item),
  );
  add(
    "Others' overdue commitments",
    othersOverdue.map(({ item, due }) =>
      line(item, `was due ${formatDue(due)}`),
    ),
    othersOverdue.map(({ item }) => item),
  );
  add(
    'Open with no due date for 2+ weeks',
    undatedStale.map(({ item, age }) =>
      line(item, `open ${Math.floor(age / DAY_MS)} days`),
    ),
    undatedStale.map(({ item }) => item),
  );
  if (!sections.length)
    return {
      answer:
        'Nothing is overdue or due in the next 7 days in your tasks, and no tracked commitments from others are past due.',
      cited: [],
    };
  return {
    answer: `${sections.join('\n\n')}\n\nThis reads your Tasks and tracked commitments; anything not captured there isn't included.`,
    cited,
  };
};
