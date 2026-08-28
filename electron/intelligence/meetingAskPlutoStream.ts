export interface MeetingAskPlutoVisibleStream {
  push(delta: string): void;
  flush(): void;
}

const EVIDENCE_PREFIX = '[evidence';
const COMPLETE_EVIDENCE_REFERENCE = /^\[Evidence\s+\d+\]/i;

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

  const emit = (value: string) => {
    if (value) onDelta(value);
  };

  const drain = (final: boolean) => {
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
