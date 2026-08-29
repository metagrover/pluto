import type {
  MeetingAskPlutoLiveTranscriptSegment,
  MeetingAskPlutoRequest,
  MeetingAskPlutoTurn,
} from '../types/askPluto';

export const MEETING_ASK_PLUTO_LIMITS = {
  requestBytes: 32_000,
  requestIdChars: 128,
  queryChars: 4_000,
  meetingIdChars: 256,
  titleChars: 200,
  participants: 8,
  participantChars: 200,
  notesChars: 1_800,
  transcriptSegments: 24,
  transcriptSegmentChars: 500,
  segmentIdChars: 256,
  speakerChars: 200,
  interimChars: 700,
  turns: 6,
  turnChars: 1_200,
  citationIds: 20,
  citationIdChars: 128,
} as const;

export type MeetingAskPlutoRequestParseResult =
  | { ok: true; request: MeetingAskPlutoRequest }
  | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBoundedString = (
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): value is string =>
  typeof value === 'string' &&
  value.length <= maxLength &&
  (allowEmpty || value.trim().length > 0);

const isValidId = (value: unknown, maxLength: number): value is string =>
  isBoundedString(value, maxLength) && /^[\p{L}\p{N}._:@/-]+$/u.test(value);

const isValidTurn = (value: unknown): value is MeetingAskPlutoTurn => {
  if (!isRecord(value)) return false;
  if (value.role !== 'user' && value.role !== 'assistant') return false;
  if (!isBoundedString(value.content, MEETING_ASK_PLUTO_LIMITS.turnChars)) {
    return false;
  }
  if (value.citationIds === undefined) return true;
  return (
    Array.isArray(value.citationIds) &&
    value.citationIds.length <= MEETING_ASK_PLUTO_LIMITS.citationIds &&
    value.citationIds.every((id) =>
      isValidId(id, MEETING_ASK_PLUTO_LIMITS.citationIdChars),
    )
  );
};

const isValidSegment = (
  value: unknown,
): value is MeetingAskPlutoLiveTranscriptSegment => {
  if (!isRecord(value)) return false;
  return (
    isValidId(value.id, MEETING_ASK_PLUTO_LIMITS.segmentIdChars) &&
    isBoundedString(
      value.speaker,
      MEETING_ASK_PLUTO_LIMITS.speakerChars,
      true,
    ) &&
    isBoundedString(
      value.text,
      MEETING_ASK_PLUTO_LIMITS.transcriptSegmentChars,
      true,
    ) &&
    typeof value.timestampMs === 'number' &&
    Number.isFinite(value.timestampMs) &&
    value.timestampMs >= 0 &&
    typeof value.confirmed === 'boolean'
  );
};

export const parseMeetingAskPlutoRequest = (
  value: unknown,
): MeetingAskPlutoRequestParseResult => {
  if (!isRecord(value))
    return { ok: false, reason: 'request must be an object' };
  try {
    const serializedBytes = new TextEncoder().encode(JSON.stringify(value));
    if (serializedBytes.byteLength > MEETING_ASK_PLUTO_LIMITS.requestBytes) {
      return { ok: false, reason: 'request is too large' };
    }
  } catch {
    return { ok: false, reason: 'request is not serializable' };
  }
  if (!isValidId(value.requestId, MEETING_ASK_PLUTO_LIMITS.requestIdChars)) {
    return { ok: false, reason: 'requestId is invalid' };
  }
  if (!isBoundedString(value.query, MEETING_ASK_PLUTO_LIMITS.queryChars)) {
    return { ok: false, reason: 'query is invalid' };
  }
  if (
    value.turns !== undefined &&
    (!Array.isArray(value.turns) ||
      value.turns.length > MEETING_ASK_PLUTO_LIMITS.turns ||
      !value.turns.every(isValidTurn))
  ) {
    return { ok: false, reason: 'turns are invalid' };
  }
  if (!isRecord(value.scope)) {
    return { ok: false, reason: 'scope is invalid' };
  }

  if (value.scope.type === 'meeting') {
    if (
      !isValidId(value.scope.meetingId, MEETING_ASK_PLUTO_LIMITS.meetingIdChars)
    ) {
      return { ok: false, reason: 'meeting scope is invalid' };
    }
  } else if (value.scope.type === 'live_meeting') {
    const scope = value.scope;
    if (
      !isBoundedString(scope.title, MEETING_ASK_PLUTO_LIMITS.titleChars) ||
      !Array.isArray(scope.participants) ||
      scope.participants.length > MEETING_ASK_PLUTO_LIMITS.participants ||
      !scope.participants.every((participant) =>
        isBoundedString(participant, MEETING_ASK_PLUTO_LIMITS.participantChars),
      ) ||
      !isBoundedString(
        scope.notes,
        MEETING_ASK_PLUTO_LIMITS.notesChars,
        true,
      ) ||
      !Array.isArray(scope.transcript) ||
      scope.transcript.length > MEETING_ASK_PLUTO_LIMITS.transcriptSegments ||
      !scope.transcript.every(isValidSegment) ||
      (scope.interimText !== undefined &&
        !isBoundedString(
          scope.interimText,
          MEETING_ASK_PLUTO_LIMITS.interimChars,
          true,
        ))
    ) {
      return { ok: false, reason: 'live meeting scope is invalid' };
    }
  } else {
    return { ok: false, reason: 'scope type is invalid' };
  }

  return { ok: true, request: value as unknown as MeetingAskPlutoRequest };
};
