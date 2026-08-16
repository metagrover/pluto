import type { LiveStreamSnapshot, LiveStreamUpdate } from './contracts';

const normalizeText = (value: string): string =>
  value.trim().replace(/\s+/gu, ' ');

const CLOSING_PUNCTUATION = /^[,.;:!?%…、。，！？；：\p{Pe}\p{Pf}]/u;
const CJK_AT_END =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;
const CJK_AT_START =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const appendText = (committed: string, tentative: string): string => {
  const normalizedTentative = normalizeText(tentative);
  if (!committed) return normalizedTentative;
  if (!normalizedTentative) return committed;
  const needsSpace =
    !CLOSING_PUNCTUATION.test(normalizedTentative) &&
    !(CJK_AT_END.test(committed) && CJK_AT_START.test(normalizedTentative));
  return `${committed}${needsSpace ? ' ' : ''}${normalizedTentative}`;
};

const isNonnegativeFinite = (value: number): boolean =>
  Number.isFinite(value) && value >= 0;

const assertValidUpdate = (update: LiveStreamUpdate): void => {
  if (
    !Number.isSafeInteger(update.generation) ||
    update.generation < 0 ||
    !Number.isSafeInteger(update.revision) ||
    update.revision < 0 ||
    !isNonnegativeFinite(update.confidence) ||
    update.confidence > 1 ||
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

  if (
    current?.generation === update.generation &&
    update.audioEndSeconds < current.audioEndSeconds
  ) {
    throw new Error('live_stream_audio_watermark_regression');
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
