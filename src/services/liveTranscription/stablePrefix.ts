import type { LiveStreamSnapshot, LiveStreamUpdate } from './contracts';

const normalizeText = (value: string): string =>
  value.trim().replace(/\s+/gu, ' ');

const appendText = (committed: string, tentative: string): string => {
  const normalizedTentative = normalizeText(tentative);
  if (!committed) return normalizedTentative;
  if (!normalizedTentative) return committed;
  return `${committed} ${normalizedTentative}`;
};

const isNonnegativeFinite = (value: number): boolean =>
  Number.isFinite(value) && value >= 0;

const assertValidUpdate = (update: LiveStreamUpdate): void => {
  if (
    !isNonnegativeFinite(update.generation) ||
    !isNonnegativeFinite(update.revision) ||
    !isNonnegativeFinite(update.confidence) ||
    !isNonnegativeFinite(update.audioEndSeconds)
  ) {
    throw new Error('live_stream_update_invalid');
  }
};

export const reduceLiveStreamUpdate = (
  current: LiveStreamSnapshot | null | undefined,
  update: LiveStreamUpdate,
): LiveStreamSnapshot => {
  assertValidUpdate(update);

  if (current && current.source !== update.source) {
    throw new Error('live_stream_source_mismatch');
  }

  if (
    current &&
    (update.generation < current.generation ||
      (update.generation === current.generation &&
        update.revision <= current.revision))
  ) {
    return current;
  }

  const continuesGeneration = current?.generation === update.generation;
  const committedPreviewText = continuesGeneration
    ? update.qualifiesPriorTentative
      ? appendText(current.committedPreviewText, current.tentativeText)
      : current.committedPreviewText
    : '';

  return {
    source: update.source,
    generation: update.generation,
    revision: update.revision,
    committedPreviewText,
    tentativeText: normalizeText(update.text),
    audioEndSeconds: update.audioEndSeconds,
  };
};
