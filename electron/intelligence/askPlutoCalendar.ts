// Upcoming-schedule answers from the native calendar store.
//
// Recorded meetings cannot answer "what do I have tomorrow"; the calendar
// can. Calendar attendees are context hints, never proof of who attended, so
// this answer lists events and points to related recorded meetings without
// asserting identity.

export interface CalendarAnswerEvent {
  title: string;
  start: string;
  end: string;
  attendees: Array<{ name?: string | null; email?: string | null }>;
}

export interface CalendarAnswerMeeting {
  id: string | number;
  title?: string | null;
  started_at?: string | null;
  created_at?: string | null;
}

const SCHEDULE_QUESTION =
  /\b(?:what|which|any|do\s+i\s+have|have\s+i\s+got|show|list)\b[\s\S]{0,60}\b(?:meetings?|calls?|events?|1\s*[:\-]\s*1s?)\b[\s\S]{0,40}\b(?:do\s+i\s+have|have\s+i\s+got|on\s+my\s+calendar|scheduled|coming\s+up|upcoming|today|tomorrow|this\s+week|next\s+week|on\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b|\b(?:my|the)\s+(?:calendar|schedule|agenda)\s+(?:for|today|tomorrow|this|next)\b|\bwhat(?:'s|\s+is)\s+(?:on\s+)?my\s+(?:calendar|schedule)\b|\b(?:my\s+)?next\s+(?:meeting|call)\b/i;

export const isScheduleQuestion = (
  query: string,
  range: { fromInclusive: string; toExclusive: string } | null,
  now = new Date(),
): boolean => {
  if (!SCHEDULE_QUESTION.test(query)) return false;
  // Past ranges are about recorded meetings, not the calendar.
  return !range || range.toExclusive > now.toISOString();
};

const normalizeTitle = (title: string | null | undefined): string =>
  (title ?? '')
    .toLocaleLowerCase()
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// The latest recorded meeting that shares the event's title (recurring
// series usually keep it), ignoring dates embedded in titles.
export const findPreviousOccurrence = (
  event: CalendarAnswerEvent,
  meetings: readonly CalendarAnswerMeeting[],
): CalendarAnswerMeeting | undefined => {
  const title = normalizeTitle(event.title);
  if (title.length < 4) return undefined;
  return meetings
    .filter((meeting) => {
      const candidate = normalizeTitle(meeting.title);
      return (
        candidate.length >= 4 &&
        (candidate === title ||
          candidate.startsWith(title) ||
          title.startsWith(candidate))
      );
    })
    .filter(
      (meeting) =>
        (meeting.started_at || meeting.created_at || '') < event.start,
    )
    .sort((left, right) =>
      (right.started_at || right.created_at || '').localeCompare(
        left.started_at || left.created_at || '',
      ),
    )[0];
};

const time = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));

const day = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));

export const buildScheduleAnswer = ({
  events,
  meetings,
  rangeLabel,
  calendarConnected,
}: {
  events: readonly CalendarAnswerEvent[];
  meetings: readonly CalendarAnswerMeeting[];
  rangeLabel: string;
  calendarConnected: boolean;
}): { answer: string; relatedMeetings: CalendarAnswerMeeting[] } => {
  if (!calendarConnected)
    return {
      answer:
        "Your calendar isn't connected to Pluto, so I can't see upcoming meetings. Connect it in Settings to ask about your schedule.\n\n[Open calendar settings](/settings/meetings)",
      relatedMeetings: [],
    };
  if (!events.length)
    return {
      answer: `Your calendar has no meetings ${rangeLabel}.`,
      relatedMeetings: [],
    };
  const multiDay = new Set(events.map((event) => day(event.start))).size > 1;
  const related: CalendarAnswerMeeting[] = [];
  const lines = [...events]
    .sort((left, right) => left.start.localeCompare(right.start))
    .slice(0, 20)
    .map((event) => {
      const attendees = event.attendees
        .map((person) => person.name?.trim() || person.email?.trim())
        .filter((value): value is string => Boolean(value))
        .slice(0, 4);
      const previous = findPreviousOccurrence(event, meetings);
      if (previous) related.push(previous);
      const when = `${multiDay ? `${day(event.start)}, ` : ''}${time(event.start)}–${time(event.end)}`;
      const invited = attendees.length
        ? ` · invited: ${attendees.join(', ')}${event.attendees.length > attendees.length ? ` +${event.attendees.length - attendees.length}` : ''}`
        : '';
      const prep = previous
        ? `\n  Last recorded: “${previous.title || 'Untitled meeting'}” on ${day(previous.started_at || previous.created_at || event.start)}`
        : '';
      return `- **${when}** ${event.title || 'Untitled event'}${invited}${prep}`;
    });
  return {
    answer: `Your calendar ${rangeLabel}:\n${lines.join('\n')}\n\nAsk me to prepare for any of these and I'll pull the related notes and open commitments.`,
    relatedMeetings: related,
  };
};
