export interface MeetingAskPlutoVisibleStream {
  push(delta: string): void;
  flush(): void;
}

const EVIDENCE_PREFIX = '[evidence';
const COMPLETE_EVIDENCE_REFERENCE = /^\[Evidence\s+\d+\]/i;
const MEETING_EVIDENCE_PREAMBLES = [
  'based on the meeting evidence provided',
  'based on the meeting evidence',
  'based on the evidence provided',
  'based on the evidence',
  'based on the meeting context provided',
  'based on the meeting context',
  'based on the context provided',
  'based on the context',
  'according to the meeting evidence provided',
  'according to the meeting evidence',
  'according to the evidence provided',
  'according to the evidence',
  'from the meeting evidence provided',
  'from the meeting evidence',
  'from the evidence provided',
  'from the evidence',
] as const;

const preambleBoundaryLength = (value: string): number => {
  const match = value.match(/^(?:\s*[,;:—-]\s*|\s+)/u);
  return match?.[0].length ?? 0;
};

export const stripMeetingAskPlutoPreamble = (value: string): string => {
  const content = value.trimStart();
  const normalized = content.toLocaleLowerCase();
  const preamble = [...MEETING_EVIDENCE_PREAMBLES]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => {
      if (!normalized.startsWith(candidate)) return false;
      const remainder = content.slice(candidate.length);
      return !remainder || preambleBoundaryLength(remainder) > 0;
    });
  if (!preamble) return value;
  const remainder = content.slice(preamble.length);
  return remainder
    .slice(preambleBoundaryLength(remainder))
    .replace(/\p{Ll}/u, (letter) => letter.toLocaleUpperCase());
};

const TIMESTAMP_NARRATION_PATTERN =
  /(?:,\s*)?(?:\b(?:as|which(?:\s+the\s+speaker)?)\s+)?\b(?:mentioned|indicated|discussed|noted|asked|suggested|questioned|highlighted|stated|referenced)\s+(?:by\s+the\s+speaker\s+|by\s+[^,\n]+?\s+)?(?:at|on|around)\s+\d+(?:\.\d+)?\s*(?:seconds?|secs?|s)\b/gi;

const STANDALONE_TIMESTAMP_AT_PATTERN =
  /(?:,\s*)?\b(?:asked|questioned|noted|discussed|stated)\s+at\s+\d+(?:\.\d+)?\s*(?:seconds?|secs?|s)\b/gi;

const SPEAKER_AT_SECONDS_PATTERN =
  /\bthe\s+speaker\s+at\s+\d+(?:\.\d+)?\s*(?:seconds?|secs?|s)\s*(?:suggests?|notes?|mentions?|states?|asks?|indicates?)\b/gi;

const LEADING_AT_SECONDS_PATTERN =
  /(?:^|(?<=[.!?]\s+))At\s+\d+(?:\.\d+)?\s*(?:seconds?|secs?|s),?\s*/gi;

export const stripMeetingAskPlutoTimestampNarration = (
  value: string,
): string => {
  let cleaned = value
    .replace(TIMESTAMP_NARRATION_PATTERN, '')
    .replace(STANDALONE_TIMESTAMP_AT_PATTERN, '')
    .replace(SPEAKER_AT_SECONDS_PATTERN, '')
    .replace(LEADING_AT_SECONDS_PATTERN, '');
  cleaned = cleaned
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/([.,;:!?])\s*\1+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*[,;:—-]\s*/, '')
    .trim();
  if (/^[.,;:!?\s-]*$/.test(cleaned)) {
    return '';
  }
  return cleaned.replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase());
};


const couldBecomeEvidenceReference = (value: string) => {
  const normalized = value.toLowerCase();
  if (EVIDENCE_PREFIX.startsWith(normalized)) return true;
  if (!normalized.startsWith(EVIDENCE_PREFIX)) return false;
  return /^\s+\d*$/.test(value.slice(EVIDENCE_PREFIX.length));
};

export const createMeetingAskPlutoVisibleStream = (
  onDelta: (delta: string) => void,
): MeetingAskPlutoVisibleStream => {
  let pending = '';
  let resolvingOpening = true;
  let awaitingOpeningContent = false;

  const emit = (value: string) => {
    if (value) onDelta(value);
  };

  const drain = (final: boolean) => {
    if (resolvingOpening && pending) {
      if (awaitingOpeningContent) {
        pending = pending
          .trimStart()
          .replace(/\p{Ll}/u, (letter) => letter.toLocaleUpperCase());
        if (!pending) return;
        awaitingOpeningContent = false;
        resolvingOpening = false;
      }
    }
    if (resolvingOpening && pending) {
      const content = pending.trimStart();
      const normalized = content.toLocaleLowerCase();
      if (
        !final &&
        MEETING_EVIDENCE_PREAMBLES.some((candidate) =>
          candidate.startsWith(normalized),
        )
      ) {
        return;
      }
      const withoutPreamble = stripMeetingAskPlutoPreamble(pending);
      if (withoutPreamble !== pending && !withoutPreamble) {
        pending = '';
        awaitingOpeningContent = true;
        return;
      }
      pending = withoutPreamble;
      resolvingOpening = false;
    }

    while (pending) {
      const markerStart = pending.indexOf('[');
      if (markerStart < 0) {
        emit(pending);
        pending = '';
        return;
      }
      if (markerStart > 0) {
        emit(pending.slice(0, markerStart));
        pending = pending.slice(markerStart);
        continue;
      }

      const completeMarker = pending.match(COMPLETE_EVIDENCE_REFERENCE);
      if (completeMarker) {
        pending = pending.slice(completeMarker[0].length);
        continue;
      }
      if (couldBecomeEvidenceReference(pending)) {
        if (final) pending = '';
        return;
      }

      emit('[');
      pending = pending.slice(1);
    }
  };

  return {
    push(delta) {
      if (!delta) return;
      pending += delta;
      drain(false);
    },
    flush() {
      drain(true);
    },
  };
};
