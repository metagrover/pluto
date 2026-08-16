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

const isNonnegativeSafeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const assertValidUpdate = (update: LiveStreamUpdate): void => {
  if (
    !Number.isSafeInteger(update.generation) ||
    update.generation < 0 ||
    !Number.isSafeInteger(update.revision) ||
    update.revision < 0 ||
    !isNonnegativeFinite(update.confidence) ||
    update.confidence > 1 ||
    !isNonnegativeFinite(update.audioEndSeconds) ||
    (update.captureSequence !== undefined &&
      !isNonnegativeSafeInteger(update.captureSequence)) ||
    (update.committedThroughCaptureSequence !== undefined &&
      !isNonnegativeSafeInteger(update.committedThroughCaptureSequence)) ||
    (update.tentativeThroughCaptureSequence !== undefined &&
      !isNonnegativeSafeInteger(update.tentativeThroughCaptureSequence)) ||
    (update.committedThroughSequence !== undefined &&
      !isNonnegativeSafeInteger(update.committedThroughSequence)) ||
    (update.tentativeThroughSequence !== undefined &&
      !isNonnegativeSafeInteger(update.tentativeThroughSequence)) ||
    (update.engineEpoch !== undefined &&
      (!Number.isSafeInteger(update.engineEpoch) || update.engineEpoch < 1)) ||
    (update.captureSequence !== undefined &&
      update.committedThroughCaptureSequence !== undefined &&
      update.committedThroughCaptureSequence > update.captureSequence) ||
    (update.captureSequence !== undefined &&
      update.tentativeThroughCaptureSequence !== undefined &&
      update.tentativeThroughCaptureSequence > update.captureSequence) ||
    (update.captureSequence === undefined &&
      (update.committedThroughCaptureSequence !== undefined ||
        update.tentativeThroughCaptureSequence !== undefined ||
        update.committedThroughSequence !== undefined ||
        update.tentativeThroughSequence !== undefined))
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

  if (current?.engineEpoch !== undefined && update.engineEpoch === undefined) {
    return current;
  }
  if (
    current?.engineEpoch !== undefined &&
    update.engineEpoch !== undefined &&
    update.engineEpoch < current.engineEpoch
  ) {
    return current;
  }

  if (
    update.captureSequence !== undefined &&
    (update.committedThroughCaptureSequence === undefined ||
      update.tentativeThroughCaptureSequence === undefined)
  ) {
    throw new Error('live_stream_update_invalid');
  }
  if (
    current?.captureSequence !== undefined &&
    update.captureSequence !== undefined &&
    update.captureSequence !== current.captureSequence + 1
  ) {
    throw new Error('live_stream_provenance_invalid');
  }

  if (update.captureSequence !== undefined) {
    const priorTentativeReceipt =
      current?.tentativeThroughCaptureSequence ?? current?.captureSequence;
    if (
      update.qualifiesPriorTentative &&
      priorTentativeReceipt !== undefined &&
      update.committedThroughCaptureSequence !== priorTentativeReceipt
    ) {
      throw new Error('live_stream_provenance_invalid');
    }
    if (update.tentativeThroughCaptureSequence !== update.captureSequence) {
      throw new Error('live_stream_provenance_invalid');
    }
  }

  if (
    current &&
    update.committedThroughCaptureSequence !== undefined &&
    current.committedThroughCaptureSequence !== undefined &&
    update.committedThroughCaptureSequence <
      current.committedThroughCaptureSequence
  ) {
    throw new Error('live_stream_provenance_invalid');
  }

  if (
    current &&
    update.committedThroughSequence !== undefined &&
    current.committedThroughSequence !== undefined &&
    update.committedThroughSequence < current.committedThroughSequence
  ) {
    throw new Error('live_stream_provenance_invalid');
  }
  if (
    current &&
    update.tentativeThroughSequence !== undefined &&
    current.tentativeThroughSequence !== undefined &&
    update.tentativeThroughSequence < current.tentativeThroughSequence
  ) {
    throw new Error('live_stream_provenance_invalid');
  }

  if (
    current &&
    ((update.engineEpoch !== undefined &&
      current.engineEpoch !== undefined &&
      update.engineEpoch < current.engineEpoch) ||
      (update.engineEpoch === current.engineEpoch &&
        (update.generation < current.generation ||
          (update.generation === current.generation &&
            (update.revision <= current.revision ||
              (update.captureSequence !== undefined &&
                current.captureSequence !== undefined &&
                update.captureSequence < current.captureSequence))))))
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
  const continuesEpoch =
    current === undefined ||
    current === null ||
    (current.engineEpoch !== undefined &&
      update.engineEpoch !== undefined &&
      current.engineEpoch === update.engineEpoch) ||
    (current.engineEpoch === undefined && update.engineEpoch === undefined);
  const committedPreviewText =
    continuesGeneration && continuesEpoch
      ? update.qualifiesPriorTentative
        ? appendText(current.committedPreviewText, current.tentativeText)
        : current.committedPreviewText
      : '';

  return {
    source: update.source,
    generation: update.generation,
    revision: update.revision,
    captureSequence: update.captureSequence,
    committedPreviewText,
    tentativeText: normalizeText(update.text),
    audioEndSeconds: update.audioEndSeconds,
    committedThroughSequence: update.committedThroughSequence,
    tentativeThroughSequence: update.tentativeThroughSequence,
    committedThroughCaptureSequence: update.committedThroughCaptureSequence,
    tentativeThroughCaptureSequence: update.tentativeThroughCaptureSequence,
    engineEpoch: update.engineEpoch,
  };
};
