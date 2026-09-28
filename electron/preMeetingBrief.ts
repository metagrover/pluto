import { parseAnalysisDocumentV3Json } from '../src/utils/analysisDocument';
import type {
  PersonBriefingCommitment,
  PersonBriefingSummary,
} from '../src/utils/personBriefing';
import { normalizeEvent } from './calendar/protocol';
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
import type { PrepAttendee } from './prepAttendees';
import { normalizePrepEmail, prepRoster } from './prepAttendees';

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
  attendees?: PrepAttendee[];
  personOptions?: Array<{ id: string; name: string }>;
  sourceMeetings?: Array<{
    id: string;
    title: string;
    startedAt: string;
    evidence: 'confirmed' | 'invited' | 'related';
  }>;
  overview?: PreMeetingBriefItem[];
  evidenceItems?: PreMeetingBriefItem[];
  talkingPoints?: PreMeetingBriefItem[];
  synthesisStatus?: 'ready' | 'fallback';
}

export interface BriefDependencies {
  getPersonEmails?: (personId: string) => string[];
  listRelatedMeetingContexts?: (
    event: CalendarEvent,
    emails: string[],
  ) => PriorMeetingCalendarContext[];
  listPeople?: () => Array<{ id: string; name: string }>;
  resolveAttendees?: (event: CalendarEvent) => PrepAttendee[];
  getPersonHistory?: (personId: string) =>
    | {
        meetings: Array<{ id: string; evidence: string }>;
        commitments?: { open: PersonBriefingCommitment[] };
      }
    | undefined;
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
  id: `${String(source.id)}:${suffix}`,
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

const isRejectedAction = (metadata: string | null) => {
  try {
    const m = JSON.parse(metadata || '{}');
    return (
      m.commitment_state === 'rejected' ||
      m.meeting_regeneration_retired_at ||
      m.cancelled_at
    );
  } catch {
    return false;
  }
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
    ...(!decisions.length && !questions.length
      ? cleanLines(evidence.notesText, 2).map((text, index) =>
          item(text.slice(0, 700), meeting, trust, `notes-${index}`),
        )
      : []),
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
        !isRejectedAction(entity.metadata) &&
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
      return item(
        `${text}${entity.due_date ? ` · Due ${entity.due_date}` : ''}`,
        meeting,
        trust,
        `open-${index}`,
      );
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
  const attendees = deps.resolveAttendees?.(event) ?? [];
  const roster = prepRoster(event);
  const emailGroups = new Map<string, Set<string>>();
  for (const attendee of deps.resolveAttendees ? attendees : roster) {
    const personId =
      'personId' in attendee && typeof attendee.personId === 'string'
        ? attendee.personId
        : null;
    const key = personId || attendee.key;
    const group = emailGroups.get(key) || new Set<string>();
    if (attendee.email) group.add(attendee.email);
    for (const email of personId
      ? (deps.getPersonEmails?.(personId) ?? [])
      : [])
      group.add(email);
    emailGroups.set(key, group);
  }
  const lookupEmails = [
    ...new Set([...emailGroups.values()].flatMap((group) => [...group])),
  ];
  const contexts = [
    ...new Map(
      [
        ...(deps.listRelatedMeetingContexts?.(event, lookupEmails) ?? []),
        ...deps.listPriorMeetingContexts(event.start, 200),
      ].map((context) => [context.meetingId, context]),
    ).values(),
  ];
  const legacyPrior = resolvePriorMeeting(event, contexts);
  const ranked = new Map<
    string,
    { id: string; score: number; evidence: 'confirmed' | 'invited' | 'related' }
  >();
  const add = (
    id: string,
    score: number,
    evidence: 'confirmed' | 'invited' | 'related',
  ) => {
    const meeting = deps.getMeeting(id);
    if (
      !meeting ||
      Date.parse(meeting.started_at || meeting.created_at || '') >=
        Date.parse(event.start)
    )
      return;
    const words = meaningfulWords(`${event.title} ${event.agenda || ''}`);
    const body =
      `${meeting.title} ${meeting.enhanced_notes || meeting.user_notes || ''}`.toLowerCase();
    const rankedScore =
      score + [...words].filter((word) => body.includes(word)).length * 5;
    const existing = ranked.get(id);
    const evidenceClass =
      existing?.evidence === 'confirmed' || evidence === 'confirmed'
        ? 'confirmed'
        : existing?.evidence === 'invited' || evidence === 'invited'
          ? 'invited'
          : 'related';
    ranked.set(id, {
      id,
      score: Math.max(rankedScore, existing?.score ?? 0),
      evidence: evidenceClass,
    });
  };
  for (const context of contexts) {
    if (context.event.isCancelled) continue;
    const past = new Set(
      prepRoster(context.event)
        .map((p) => normalizePrepEmail(p.email))
        .filter(Boolean),
    );
    const overlap = [...emailGroups.values()].filter((group) =>
      [...group].some((email) => past.has(email)),
    );
    const sameSeries =
      !!event.seriesKey &&
      event.seriesKey === context.event.seriesKey &&
      event.calendarIdentifier === context.event.calendarIdentifier;
    const shared = emailGroups.size > 1 && overlap.length >= emailGroups.size;
    if (sameSeries || overlap.length)
      add(
        context.meetingId,
        sameSeries ? 1000 : shared ? 500 : 100 + overlap.length * 30,
        'invited',
      );
  }
  const visitedPeople = new Set<string>();
  const personCommitments: Array<{
    name: string;
    commitment: PersonBriefingCommitment;
  }> = [];
  const confirmedCounts = new Map<string, number>();
  for (const attendee of attendees) {
    if (!attendee.personId || visitedPeople.has(attendee.personId)) continue;
    visitedPeople.add(attendee.personId);
    const history = deps.getPersonHistory?.(attendee.personId);
    for (const commitment of history?.commitments?.open ?? []) {
      personCommitments.push({
        name: attendee.personName || attendee.name || 'Attendee',
        commitment,
      });
      add(commitment.sourceMeetingId, 150, 'related');
    }
    for (const past of history?.meetings ?? []) {
      if (past.evidence === 'confirmed')
        confirmedCounts.set(past.id, (confirmedCounts.get(past.id) || 0) + 1);
    }
  }
  for (const [id, count] of confirmedCounts)
    add(
      id,
      count >= Math.max(2, emailGroups.size) ? 600 : 150 + count * 30,
      'confirmed',
    );
  // Title fallback is retained only when no people/email history was found.
  if (
    !ranked.size &&
    legacyPrior &&
    !attendees.some((p) => p.basis === 'user' || p.status === 'unlinked')
  )
    add(legacyPrior.context.meetingId, 10, 'related');
  const sources = [...ranked.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(
          deps.getMeeting(b.id)!.started_at ||
            deps.getMeeting(b.id)!.created_at ||
            '',
        ) -
          Date.parse(
            deps.getMeeting(a.id)!.started_at ||
              deps.getMeeting(a.id)!.created_at ||
              '',
          ),
    )
    .slice(0, 8);
  const primary = sources[0] ? deps.getMeeting(sources[0].id) : undefined;
  const briefs = sources.map((source) =>
    buildFromMeeting(
      event.title,
      event.start,
      event.agenda ?? null,
      'related',
      deps.getMeeting(source.id),
      [],
      deps,
    ),
  );
  const brief = buildFromMeeting(
    event.title || 'Upcoming meeting',
    event.start,
    event.agenda ?? null,
    primary
      ? legacyPrior?.context.meetingId === String(primary.id)
        ? legacyPrior.relationship
        : 'related'
      : 'none',
    primary,
    [],
    deps,
  );
  const unique = (items: PreMeetingBriefItem[], limit: number) => {
    const seen = new Set<string>();
    return items
      .filter((entry) => {
        const key = entry.text.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  };
  brief.lastTime = unique(
    briefs.flatMap((b) => b.lastTime),
    4,
  );
  const selectedIds = new Set(sources.map((source) => source.id));
  const owned = personCommitments
    .filter(
      ({ commitment }) =>
        selectedIds.has(commitment.sourceMeetingId) &&
        (commitment.status === 'active' || commitment.status === 'overdue'),
    )
    .map(({ name, commitment }) => {
      const source = deps.getMeeting(commitment.sourceMeetingId)!;
      return item(
        `${name}: ${commitment.text}${commitment.dueDate ? ` · Due ${commitment.dueDate}` : ''}`,
        source,
        'grounded',
        `owner:${commitment.id}`,
      );
    });
  const ownedTexts = new Set(
    personCommitments.map(({ commitment }) => commitment.text),
  );
  brief.stillOpen = unique(
    [
      ...owned,
      ...briefs
        .flatMap((b) => b.stillOpen)
        .filter(
          (entry) =>
            ![...ownedTexts].some(
              (text) =>
                entry.text === text ||
                entry.text.startsWith(`${text} ·`) ||
                entry.text.startsWith(`${text} —`),
            ),
        ),
    ],
    6,
  );
  brief.attendees = attendees;
  brief.personOptions = deps.listPeople?.() ?? [];
  brief.sourceMeetings = sources.map((source) => {
    const meeting = deps.getMeeting(source.id)!;
    return {
      id: source.id,
      title: meeting.title || 'Untitled meeting',
      startedAt: meeting.started_at || meeting.created_at || '',
      evidence: source.evidence,
    };
  });
  brief.evidenceItems = unique(
    [
      ...briefs.flatMap((b) => b.lastTime.slice(0, 2)),
      ...brief.stillOpen,
      ...brief.relevantContext,
    ],
    24,
  );
  brief.overview = brief.lastTime.slice(0, 2);
  brief.talkingPoints = brief.stillOpen.slice(0, 3).map((entry) => ({
    ...entry,
    id: `talk:${entry.id}`,
    text: `What is the latest update on “${entry.text}”?`,
    trustStatus: 'inferred',
  }));
  brief.synthesisStatus = 'fallback';
  if (brief.lastTime.length || brief.stillOpen.length)
    brief.emptyMessage = null;
  return brief;
};

export function validatePreMeetingBriefRequest(
  value: unknown,
): PreMeetingBriefRequest {
  if (
    !value ||
    typeof value !== 'object' ||
    JSON.stringify(value).length > 64_000
  )
    throw new Error('Invalid prep request');
  const request = value as Record<string, unknown>;
  if (
    request.kind === 'query' &&
    typeof request.query === 'string' &&
    request.query.trim() &&
    request.query.length <= 200
  )
    return { kind: 'query', query: request.query };
  if (request.kind === 'calendar') {
    const event = normalizeEvent(request.event);
    if (
      event &&
      event.attendees.length <= 100 &&
      Number.isFinite(Date.parse(event.start)) &&
      Number.isFinite(Date.parse(event.end))
    )
      return { kind: 'calendar', event };
  }
  throw new Error('Invalid prep request');
}
