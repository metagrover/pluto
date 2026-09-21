import { parseAnalysisDocumentV3Json } from '../src/utils/analysisDocument';
import type { PersonBriefingSummary } from '../src/utils/personBriefing';
import type {
  CalendarEvent,
  PriorMeetingCalendarContext,
} from './calendar/types';
import type {
  BlockedActionItem,
  Entity,
  PersistedMeeting,
  WorkingMemorySnapshot,
} from './db';
import { buildMeetingNotesEvidenceDocument } from './intelligence/meetingNotesEvidence';

export type PreMeetingBriefRequest =
  | { kind: 'calendar'; event: CalendarEvent }
  | { kind: 'query'; query: string };

export type BriefTrustStatus =
  | 'grounded'
  | 'inferred'
  | 'needs_review'
  | 'stale';

export interface PreMeetingBriefItem {
  id: string;
  text: string;
  trustStatus: BriefTrustStatus;
  sourceMeetingId: string | null;
  sourceLabel: string;
  sourceDate: string | null;
}

export interface PreMeetingBrief {
  title: string;
  startsAt: string | null;
  agenda: string | null;
  relationship: 'same_series' | 'related' | 'manual' | 'none';
  priorMeeting: {
    id: string;
    title: string;
    startedAt: string;
  } | null;
  lastTime: PreMeetingBriefItem[];
  stillOpen: PreMeetingBriefItem[];
  relevantContext: PreMeetingBriefItem[];
  emptyMessage: string | null;
}

interface BriefDependencies {
  listPriorMeetingContexts: (
    before: string,
    limit?: number,
  ) => PriorMeetingCalendarContext[];
  getMeeting: (id: string) => PersistedMeeting | undefined;
  getMeetingEntities: (
    meetingId: string,
  ) => Array<Entity & { mention_count: number; context: string | null }>;
  getBlockedActionItems: () => BlockedActionItem[];
  searchMeetingSummaries: (
    query: string,
    limit?: number,
  ) => Array<{
    id: string | number;
    title: string;
    started_at: string;
    created_at: string;
  }>;
  getGlobalWorkingMemory: () => WorkingMemorySnapshot | undefined;
  getPeopleBriefingSummaries: () => PersonBriefingSummary[];
}

const normalizeTitle = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/\b(?:weekly|biweekly|monthly|daily)\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const attendeeKeys = (event: CalendarEvent) =>
  new Set(
    event.attendees
      .map((person) => (person.email || person.name || '').toLocaleLowerCase())
      .filter(Boolean),
  );

const isConservativeRelatedMatch = (
  current: CalendarEvent,
  prior: PriorMeetingCalendarContext,
) => {
  if (
    current.calendarIdentifier !== prior.event.calendarIdentifier ||
    !normalizeTitle(current.title) ||
    normalizeTitle(current.title) !== normalizeTitle(prior.event.title)
  ) {
    return false;
  }
  const currentAttendees = attendeeKeys(current);
  const priorAttendees = attendeeKeys(prior.event);
  if (currentAttendees.size === 0 || priorAttendees.size === 0) {
    return normalizeTitle(current.title).split(' ').length >= 2;
  }
  return [...currentAttendees].some((key) => priorAttendees.has(key));
};

export const resolvePriorMeeting = (
  event: CalendarEvent,
  candidates: PriorMeetingCalendarContext[],
): {
  context: PriorMeetingCalendarContext;
  relationship: 'same_series' | 'related';
} | null => {
  if (event.seriesKey) {
    const exact = candidates.find(
      (candidate) =>
        candidate.event.calendarIdentifier === event.calendarIdentifier &&
        candidate.event.seriesKey === event.seriesKey,
    );
    if (exact) return { context: exact, relationship: 'same_series' };
  }
  const related = candidates.find((candidate) =>
    isConservativeRelatedMatch(event, candidate),
  );
  return related ? { context: related, relationship: 'related' } : null;
};

const cleanLines = (value: string, limit: number) =>
  value
    .split('\n')
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, limit);

const item = (
  text: string,
  source: PersistedMeeting,
  trustStatus: BriefTrustStatus,
  suffix: string,
): PreMeetingBriefItem => ({
  id: `${String(source.id)}:${suffix}:${text}`,
  text,
  trustStatus,
  sourceMeetingId: String(source.id),
  sourceLabel: source.title || 'Untitled meeting',
  sourceDate: source.started_at || source.created_at || null,
});

const meaningfulWords = (value: string) =>
  new Set(
    normalizeTitle(value)
      .split(' ')
      .filter((word) => word.length >= 4),
  );

const streamItems = (
  snapshot: WorkingMemorySnapshot | undefined,
  target: string,
): PreMeetingBriefItem[] => {
  if (!snapshot) return [];
  const words = meaningfulWords(target);
  if (words.size === 0) return [];
  return snapshot.payload.active_streams
    .flatMap((raw, index) => {
      if (!raw || typeof raw !== 'object') return [];
      const stream = raw as Record<string, unknown>;
      const title = typeof stream.title === 'string' ? stream.title.trim() : '';
      const currentRead =
        typeof stream.current_read === 'string'
          ? stream.current_read.trim()
          : '';
      const haystack = `${title} ${currentRead}`.toLocaleLowerCase();
      if (!title || ![...words].some((word) => haystack.includes(word))) {
        return [];
      }
      const evidence =
        stream.evidence_quality && typeof stream.evidence_quality === 'object'
          ? (stream.evidence_quality as Record<string, unknown>)
          : {};
      const freshness = evidence.freshness;
      const mode = evidence.mode;
      const evidenceEntry = snapshot.payload.evidence_index.find((rawEntry) => {
        if (!rawEntry || typeof rawEntry !== 'object') return false;
        const entry = rawEntry as Record<string, unknown>;
        return (
          Array.isArray(entry.stream_ids) &&
          entry.stream_ids.includes(stream.id)
        );
      }) as Record<string, unknown> | undefined;
      const sourceMeetingId =
        typeof evidenceEntry?.meeting_id === 'string'
          ? evidenceEntry.meeting_id
          : null;
      return [
        {
          id: `stream:${String(stream.id ?? index)}`,
          text: currentRead || title,
          trustStatus:
            freshness === 'stale'
              ? ('stale' as const)
              : mode === 'inferred'
                ? ('inferred' as const)
                : ('grounded' as const),
          sourceMeetingId,
          sourceLabel:
            typeof evidenceEntry?.meeting_title === 'string'
              ? `Active stream · ${title} · ${evidenceEntry.meeting_title}`
              : `Active stream · ${title}`,
          sourceDate:
            typeof evidenceEntry?.captured_at === 'string'
              ? evidenceEntry.captured_at
              : typeof stream.last_touched_at === 'string'
                ? stream.last_touched_at
                : snapshot.generated_at,
        },
      ];
    })
    .slice(0, 2);
};

const personDossierItems = (
  summaries: PersonBriefingSummary[],
  queries: string[],
): PreMeetingBriefItem[] => {
  const normalizedQueries = new Set(
    queries.map(normalizeTitle).filter((query) => query.length > 0),
  );
  return summaries
    .filter(
      (person) =>
        person.possibleDuplicateCount === 0 &&
        person.briefHeadline?.trim() &&
        normalizedQueries.has(normalizeTitle(person.name)),
    )
    .slice(0, 2)
    .map((person) => ({
      id: `person:${person.id}`,
      text: person.briefHeadline!.trim(),
      trustStatus: 'inferred' as const,
      sourceMeetingId: person.latestMeetingId,
      sourceLabel: `Possible person context · ${person.name}`,
      sourceDate: person.briefUpdatedAt || person.latestMeetingAt,
    }));
};

const buildFromMeeting = (
  title: string,
  startsAt: string | null,
  agenda: string | null,
  relationship: PreMeetingBrief['relationship'],
  meeting: PersistedMeeting | undefined,
  peopleQueries: string[],
  deps: BriefDependencies,
): PreMeetingBrief => {
  const relevantContext = [
    ...personDossierItems(deps.getPeopleBriefingSummaries(), peopleQueries),
    ...streamItems(deps.getGlobalWorkingMemory(), title),
  ].slice(0, 3);
  if (!meeting) {
    return {
      title,
      startsAt,
      agenda,
      relationship: 'none',
      priorMeeting: null,
      lastTime: [],
      stillOpen: [],
      relevantContext,
      emptyMessage: 'No trustworthy previous meeting was found yet.',
    };
  }

  const evidence = buildMeetingNotesEvidenceDocument(meeting);
  const analysis = parseAnalysisDocumentV3Json(meeting.analysis_json);
  const trust = evidence.trustStatus;
  const decisions = cleanLines(evidence.decisionsText, 2);
  const questions = (analysis?.topics ?? [])
    .flatMap((topic) => topic.open_questions)
    .map((question) => question.trim())
    .filter(Boolean)
    .slice(0, 2);
  const lastTime = [
    ...decisions.map((text, index) =>
      item(text, meeting, trust, `decision-${index}`),
    ),
    ...questions.map((text, index) =>
      item(text, meeting, trust, `question-${index}`),
    ),
  ].slice(0, 4);

  const entities = deps.getMeetingEntities(String(meeting.id));
  const blockerById = new Map(
    deps.getBlockedActionItems().map((blocked) => [blocked.id, blocked]),
  );
  const stillOpen = entities
    .filter(
      (entity) =>
        entity.type === 'action_item' &&
        (entity.status === 'active' ||
          entity.status === 'overdue' ||
          entity.status === 'stale'),
    )
    .slice(0, 4)
    .map((entity, index) => {
      const blocker = blockerById.get(entity.id);
      const text = blocker
        ? `${entity.name} — blocked by ${blocker.blocker_name}`
        : entity.name;
      return item(text, meeting, 'grounded', `open-${index}`);
    });
  const emptyMessage =
    lastTime.length || stillOpen.length || relevantContext.length || agenda
      ? null
      : 'The previous meeting has no settled notes or open follow-ups yet.';
  return {
    title,
    startsAt,
    agenda,
    relationship,
    priorMeeting: {
      id: String(meeting.id),
      title: meeting.title || 'Untitled meeting',
      startedAt: meeting.started_at || meeting.created_at || '',
    },
    lastTime,
    stillOpen,
    relevantContext,
    emptyMessage,
  };
};

export const buildPreMeetingBrief = (
  request: PreMeetingBriefRequest,
  deps: BriefDependencies,
): PreMeetingBrief => {
  if (request.kind === 'query') {
    const query = request.query.trim().slice(0, 200);
    const match = query ? deps.searchMeetingSummaries(query, 1)[0] : undefined;
    const meeting = match ? deps.getMeeting(String(match.id)) : undefined;
    return buildFromMeeting(
      query || 'Conversation brief',
      null,
      null,
      match ? 'manual' : 'none',
      meeting,
      [query],
      deps,
    );
  }

  const event = request.event;
  const prior = resolvePriorMeeting(
    event,
    deps.listPriorMeetingContexts(event.start, 80),
  );
  return buildFromMeeting(
    event.title || 'Upcoming meeting',
    event.start,
    event.agenda ?? null,
    prior?.relationship ?? 'none',
    prior ? deps.getMeeting(prior.context.meetingId) : undefined,
    event.attendees.flatMap((attendee) => attendee.name || []),
    deps,
  );
};
