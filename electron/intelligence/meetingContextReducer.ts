import type {
  MeetingContextActionItem,
  MeetingContextEvent,
  MeetingContextRollingStateV1,
  MeetingContextStateItem,
} from '../../src/types/meetingContext';

type ReducibleKind =
  | 'topic'
  | 'proposal'
  | 'decision'
  | 'action'
  | 'open_question'
  | 'fact';

type ReducedEntry = MeetingContextStateItem & {
  latestEvent: MeetingContextEvent;
  order: number;
};

const LIMITS: Record<ReducibleKind, number> = {
  topic: 5,
  proposal: 12,
  decision: 12,
  action: 12,
  open_question: 12,
  fact: 12,
};

const normalize = (value: string): string => value.trim().replace(/\s+/gu, ' ');

const keyFor = (value: string): string => normalize(value).toLocaleLowerCase();

const unique = (values: string[]): string[] => [...new Set(values)];

const reduceKind = (
  events: MeetingContextEvent[],
  kind: ReducibleKind,
): ReducedEntry[] => {
  const merged = new Map<string, ReducedEntry>();
  events.forEach((event, order) => {
    if (event.kind !== kind) return;
    const key = keyFor(event.summary);
    if (!key) return;
    const existing = merged.get(key);
    merged.set(key, {
      id: existing?.id ?? event.id,
      text: existing?.text ?? normalize(event.summary),
      sourceEventIds: unique([...(existing?.sourceEventIds ?? []), event.id]),
      sourceSegmentIds: unique([
        ...(existing?.sourceSegmentIds ?? []),
        ...event.evidence
          .map((reference) => reference.segmentId.trim())
          .filter(Boolean),
      ]),
      latestEvent: event,
      order,
    });
  });

  return [...merged.values()]
    .sort((left, right) => left.order - right.order)
    .slice(-LIMITS[kind]);
};

const toStateItems = (entries: ReducedEntry[]): MeetingContextStateItem[] =>
  entries.map(({ latestEvent: _latestEvent, order: _order, ...item }) => item);

const attributeText = (
  event: MeetingContextEvent,
  key: string,
): string | null => {
  const value = event.attributes[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const toActionItems = (entries: ReducedEntry[]): MeetingContextActionItem[] =>
  entries.map(({ latestEvent, order: _order, ...item }) => ({
    ...item,
    owner: attributeText(latestEvent, 'owner'),
    deadline: attributeText(latestEvent, 'deadline'),
  }));

const summarySection = (
  label: string,
  items: MeetingContextStateItem[],
): string | null =>
  items.length > 0
    ? `${label}: ${items.map((item) => item.text).join('; ')}`
    : null;

const latestEvidence = (events: MeetingContextEvent[]) => {
  const references = events.flatMap((event) => event.evidence);
  return references.reduce<(typeof references)[number] | null>(
    (latest, reference) =>
      !latest || reference.timestampMs >= latest.timestampMs
        ? reference
        : latest,
    null,
  );
};

export const reduceMeetingContextEvents = (
  meetingId: string,
  inputEvents: MeetingContextEvent[],
): MeetingContextRollingStateV1 => {
  const normalizedMeetingId = meetingId.trim();
  const events = inputEvents
    .filter((event) => event.meetingId === normalizedMeetingId)
    .sort(
      (left, right) =>
        left.observedAtMs - right.observedAtMs ||
        left.createdAt.localeCompare(right.createdAt),
    );

  const currentTopics = toStateItems(reduceKind(events, 'topic'));
  const proposals = toStateItems(reduceKind(events, 'proposal'));
  const decisions = toStateItems(reduceKind(events, 'decision'));
  const actions = toActionItems(reduceKind(events, 'action'));
  const openQuestions = toStateItems(reduceKind(events, 'open_question'));
  const importantFacts = toStateItems(reduceKind(events, 'fact'));
  const cursor = latestEvidence(events);
  const summary = [
    summarySection('Decisions', decisions),
    summarySection('Actions', actions),
    summarySection('Topics', currentTopics),
    summarySection('Proposals', proposals),
    summarySection('Questions', openQuestions),
    summarySection('Facts', importantFacts),
  ]
    .filter((section): section is string => section !== null)
    .join('\n');

  return {
    schemaVersion: 1,
    meetingId: normalizedMeetingId,
    updatedThrough: {
      segmentId: cursor?.segmentId ?? null,
      timestampMs: cursor?.timestampMs ?? null,
    },
    summary,
    currentTopics,
    proposals,
    decisions,
    actions,
    openQuestions,
    importantFacts,
  };
};

const mergeStateItem = (
  items: MeetingContextStateItem[],
  event: MeetingContextEvent,
  limit: number,
): MeetingContextStateItem[] => {
  const key = keyFor(event.summary);
  const existingIndex = items.findIndex((item) => keyFor(item.text) === key);
  const evidenceSegmentIds = event.evidence
    .map((reference) => reference.segmentId.trim())
    .filter(Boolean);
  const next: MeetingContextStateItem =
    existingIndex >= 0
      ? {
          ...items[existingIndex],
          sourceEventIds: unique([
            ...items[existingIndex].sourceEventIds,
            event.id,
          ]),
          sourceSegmentIds: unique([
            ...items[existingIndex].sourceSegmentIds,
            ...evidenceSegmentIds,
          ]),
        }
      : {
          id: event.id,
          text: normalize(event.summary),
          sourceEventIds: [event.id],
          sourceSegmentIds: unique(evidenceSegmentIds),
        };
  const withoutExisting = items.filter((_, index) => index !== existingIndex);
  return [...withoutExisting, next].slice(-limit);
};

export const applyMeetingContextEvents = (
  previous: MeetingContextRollingStateV1,
  inputEvents: MeetingContextEvent[],
): MeetingContextRollingStateV1 => {
  let currentTopics = [...previous.currentTopics];
  let proposals = [...previous.proposals];
  let decisions = [...previous.decisions];
  let actions = [...previous.actions];
  let openQuestions = [...previous.openQuestions];
  let importantFacts = [...previous.importantFacts];
  let cursor = { ...previous.updatedThrough };

  const events = inputEvents
    .filter((event) => event.meetingId === previous.meetingId)
    .sort(
      (left, right) =>
        left.observedAtMs - right.observedAtMs ||
        left.createdAt.localeCompare(right.createdAt),
    );
  for (const event of events) {
    if (event.kind === 'topic') {
      currentTopics = mergeStateItem(currentTopics, event, LIMITS.topic);
    } else if (event.kind === 'proposal') {
      proposals = mergeStateItem(proposals, event, LIMITS.proposal);
    } else if (event.kind === 'decision') {
      decisions = mergeStateItem(decisions, event, LIMITS.decision);
    } else if (event.kind === 'action') {
      const merged = mergeStateItem(actions, event, LIMITS.action);
      actions = merged.map((item) =>
        item.sourceEventIds.includes(event.id)
          ? {
              ...item,
              owner: attributeText(event, 'owner'),
              deadline: attributeText(event, 'deadline'),
            }
          : (item as MeetingContextActionItem),
      );
    } else if (event.kind === 'open_question') {
      openQuestions = mergeStateItem(
        openQuestions,
        event,
        LIMITS.open_question,
      );
    } else if (event.kind === 'fact') {
      importantFacts = mergeStateItem(importantFacts, event, LIMITS.fact);
    }
    for (const evidence of event.evidence) {
      if (
        cursor.timestampMs === null ||
        evidence.timestampMs >= cursor.timestampMs
      ) {
        cursor = {
          segmentId: evidence.segmentId,
          timestampMs: evidence.timestampMs,
        };
      }
    }
  }

  return {
    ...previous,
    updatedThrough: cursor,
    summary: [
      summarySection('Decisions', decisions),
      summarySection('Actions', actions),
      summarySection('Topics', currentTopics),
      summarySection('Proposals', proposals),
      summarySection('Questions', openQuestions),
      summarySection('Facts', importantFacts),
    ]
      .filter((section): section is string => section !== null)
      .join('\n'),
    currentTopics,
    proposals,
    decisions,
    actions,
    openQuestions,
    importantFacts,
  };
};
