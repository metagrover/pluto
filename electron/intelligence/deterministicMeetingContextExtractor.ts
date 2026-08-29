import { createHash } from 'node:crypto';

import type {
  MeetingContextEventInput,
  MeetingContextEventKind,
  MeetingContextIngestionSegment,
} from '../../src/types/meetingContext';

type ExtractedEventKind = Exclude<
  MeetingContextEventKind,
  'proposal' | 'correction' | 'open_question'
>;

type CueRule = {
  kind: ExtractedEventKind;
  patterns: RegExp[];
};

const CUE_RULES: CueRule[] = [
  {
    kind: 'topic',
    patterns: [
      /^(?:let(?:'s| us) (?:discuss|talk about)|moving on to|the next topic is|we need to discuss)\s+(.+)$/iu,
    ],
  },
  {
    kind: 'decision',
    patterns: [
      /^(?:we decided|we agreed|the decision is|we will|let(?:'s| us) do)\s+(.+)$/iu,
    ],
  },
  {
    kind: 'action',
    patterns: [
      /^(?:i will|i'll|we need to|can you|could you|please)\s+(.+)$/iu,
    ],
  },
  {
    kind: 'fact',
    patterns: [
      /^(?:important|note that|for context|the constraint is|the deadline is)[:,]?\s+(.+)$/iu,
    ],
  },
];

const GENERIC_SPEAKERS = new Set(['speaker', 'unknown', 'me', 'them']);

const normalize = (value: string): string => value.trim().replace(/\s+/gu, ' ');

const cleanSummary = (value: string): string =>
  normalize(value).replace(/^[\s:,-]+|[\s.!?,;:]+$/gu, '');

const digest = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);

const makeEvent = (
  meetingId: string,
  segment: MeetingContextIngestionSegment,
  kind: MeetingContextEventKind,
  summary: string,
): MeetingContextEventInput => {
  const normalizedSummary = normalize(summary);
  const normalizedSpeaker = normalize(segment.speaker);
  const owner =
    kind === 'action' &&
    /^(?:i will|i'll)\b/iu.test(normalize(segment.text)) &&
    !GENERIC_SPEAKERS.has(normalizedSpeaker.toLocaleLowerCase())
      ? normalizedSpeaker
      : null;

  return {
    meetingId,
    eventKey: `${meetingId}:${kind}:${segment.id}:${digest(normalizedSummary.toLocaleLowerCase())}`,
    kind,
    summary: normalizedSummary,
    evidence: [
      {
        segmentId: segment.id,
        timestampMs: segment.timestampMs,
        quote: normalize(segment.text),
      },
    ],
    attributes: kind === 'action' ? { owner, deadline: null } : {},
    observedAtMs: segment.timestampMs,
  };
};

export const extractDeterministicMeetingContextEvents = (
  meetingId: string,
  segment: MeetingContextIngestionSegment,
): MeetingContextEventInput[] => {
  const normalizedMeetingId = meetingId.trim();
  const text = normalize(segment.text);
  if (
    !normalizedMeetingId ||
    !segment.confirmed ||
    !segment.id.trim() ||
    !text ||
    !Number.isFinite(segment.timestampMs) ||
    segment.timestampMs < 0
  ) {
    return [];
  }

  const events: MeetingContextEventInput[] = [];
  for (const rule of CUE_RULES) {
    if (
      rule.kind === 'action' &&
      /^we need to (?:discuss|talk about)\b/iu.test(text)
    ) {
      continue;
    }
    const match = rule.patterns
      .map((pattern) => text.match(pattern))
      .find((candidate) => candidate !== null);
    const summary = match?.[1] ? cleanSummary(match[1]) : '';
    if (summary) {
      events.push(makeEvent(normalizedMeetingId, segment, rule.kind, summary));
    }
  }

  if (
    /[?]["')\]]?$/u.test(text) ||
    /^(?:who|what|when|where|why|how|is|are|was|were|do|does|did|can|could|will|would|should|have|has|had)\b/iu.test(
      text,
    )
  ) {
    events.push(makeEvent(normalizedMeetingId, segment, 'open_question', text));
  }

  return events;
};
