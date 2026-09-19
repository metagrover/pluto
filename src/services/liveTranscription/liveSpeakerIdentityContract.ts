export type LiveSpeakerIdentityRange = {
  startMs: number;
  endMs: number;
};

export type LiveSpeakerIdentityHint = {
  suggestionId: string;
  displayLabel: string;
  state: 'suggested' | 'confirmed' | 'rejected' | 'revoked';
  ranges: LiveSpeakerIdentityRange[];
  generation: number;
  revision: number;
};

export type LiveSpeakerIdentitySnapshot = {
  meetingId: string;
  generation: number;
  revision: number;
  hints: LiveSpeakerIdentityHint[];
};

const ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;

const hasOnlyKeys = (value: object, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

export const parseLiveSpeakerIdentitySnapshot = (
  value: unknown,
): LiveSpeakerIdentitySnapshot | null => {
  if (!value || typeof value !== 'object') return null;
  if (!hasOnlyKeys(value, ['meetingId', 'generation', 'revision', 'hints'])) {
    return null;
  }
  const candidate = value as Partial<LiveSpeakerIdentitySnapshot>;
  if (
    typeof candidate.meetingId !== 'string' ||
    !ID_PATTERN.test(candidate.meetingId) ||
    !Number.isSafeInteger(candidate.generation) ||
    Number(candidate.generation) <= 0 ||
    !Number.isSafeInteger(candidate.revision) ||
    Number(candidate.revision) <= 0 ||
    !Array.isArray(candidate.hints) ||
    candidate.hints.length > 16
  ) {
    return null;
  }
  const hints: LiveSpeakerIdentityHint[] = [];
  for (const hint of candidate.hints) {
    if (!hint || typeof hint !== 'object') return null;
    if (
      !hasOnlyKeys(hint, [
        'suggestionId',
        'displayLabel',
        'state',
        'ranges',
        'generation',
        'revision',
      ])
    ) {
      return null;
    }
    const entry = hint as Partial<LiveSpeakerIdentityHint>;
    if (
      typeof entry.suggestionId !== 'string' ||
      !ID_PATTERN.test(entry.suggestionId) ||
      typeof entry.displayLabel !== 'string' ||
      entry.displayLabel.length === 0 ||
      entry.displayLabel.length > 200 ||
      (entry.state !== 'suggested' &&
        entry.state !== 'confirmed' &&
        entry.state !== 'rejected' &&
        entry.state !== 'revoked') ||
      entry.generation !== candidate.generation ||
      !Number.isSafeInteger(entry.revision) ||
      Number(entry.revision) <= 0 ||
      !Array.isArray(entry.ranges) ||
      entry.ranges.length === 0 ||
      entry.ranges.length > 64 ||
      !entry.ranges.every((range) => {
        if (!range || typeof range !== 'object') return false;
        return (
          hasOnlyKeys(range, ['startMs', 'endMs']) &&
          Number.isFinite(range.startMs) &&
          Number.isFinite(range.endMs) &&
          range.startMs >= 0 &&
          range.endMs > range.startMs
        );
      })
    ) {
      return null;
    }
    hints.push(entry as LiveSpeakerIdentityHint);
  }
  return {
    meetingId: candidate.meetingId,
    generation: Number(candidate.generation),
    revision: Number(candidate.revision),
    hints,
  };
};

export const liveSpeakerHintForRange = (
  snapshot: LiveSpeakerIdentitySnapshot | null | undefined,
  startMs: number,
  endMs: number,
): LiveSpeakerIdentityHint | null => {
  if (!snapshot || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }
  const matches = snapshot.hints.filter(
    (hint) =>
      (hint.state === 'suggested' || hint.state === 'confirmed') &&
      hint.ranges.some(
        (range) => range.startMs <= startMs && range.endMs >= endMs,
      ),
  );
  const labels = new Set(matches.map((hint) => hint.displayLabel));
  return matches.length > 0 && labels.size === 1 ? matches[0] : null;
};
