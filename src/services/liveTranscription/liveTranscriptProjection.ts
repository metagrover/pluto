import type { LiveSource } from './contracts';

export type LiveTranscriptProjectionInput = {
  source: LiveSource;
  engineEpoch: number;
  parakeetGeneration: number;
  revision: number;
  committedPreviewText: string;
  tentativeText: string;
  audioEndSeconds: number;
};

export type LiveTranscriptProjectionSegment = {
  id: string;
  source: LiveSource;
  engineEpoch: number;
  parakeetGeneration: number;
  revision: number;
  text: string;
  canonical: false;
  isCanonical: false;
  kind: 'committed_preview' | 'tentative';
};

export type LiveTranscriptProjection = {
  source: LiveSource;
  engineEpoch: number;
  parakeetGeneration: number;
  revision: number;
  audioEndSeconds: number;
  committed: LiveTranscriptProjectionSegment;
  tentative: LiveTranscriptProjectionSegment | null;
  committedHistory: LiveTranscriptProjectionSegment[];
};

const projectionID = (
  input: LiveTranscriptProjectionInput,
  kind: 'committed' | 'tentative',
): string =>
  `${input.source}:e${input.engineEpoch}:g${input.parakeetGeneration}:r${input.revision}:${kind}`;

const makeSegment = (
  input: LiveTranscriptProjectionInput,
  kind: 'committed_preview' | 'tentative',
  text: string,
): LiveTranscriptProjectionSegment => ({
  id: projectionID(
    input,
    kind === 'committed_preview' ? 'committed' : 'tentative',
  ),
  source: input.source,
  engineEpoch: input.engineEpoch,
  parakeetGeneration: input.parakeetGeneration,
  revision: input.revision,
  text,
  canonical: false,
  isCanonical: false,
  kind,
});

export const projectLiveTranscript = (
  input: LiveTranscriptProjectionInput,
  previous?: LiveTranscriptProjection,
): LiveTranscriptProjection => {
  if (
    !Number.isSafeInteger(input.engineEpoch) ||
    input.engineEpoch < 1 ||
    !Number.isSafeInteger(input.parakeetGeneration) ||
    input.parakeetGeneration < 0 ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0 ||
    !Number.isFinite(input.audioEndSeconds) ||
    input.audioEndSeconds < 0
  ) {
    throw new Error('live_projection_identity_invalid');
  }
  if (previous && previous.source !== input.source) {
    throw new Error('live_projection_source_mismatch');
  }
  if (
    previous &&
    (input.engineEpoch < previous.engineEpoch ||
      (input.engineEpoch === previous.engineEpoch &&
        (input.parakeetGeneration < previous.parakeetGeneration ||
          (input.parakeetGeneration === previous.parakeetGeneration &&
            input.revision <= previous.revision))))
  ) {
    return previous;
  }
  if (
    previous &&
    !(
      input.engineEpoch > previous.engineEpoch &&
      input.committedPreviewText === ''
    ) &&
    !input.committedPreviewText.startsWith(previous.committed.text)
  ) {
    return previous;
  }
  const committedPreviewText =
    previous &&
    input.engineEpoch > previous.engineEpoch &&
    input.committedPreviewText === ''
      ? previous.committed.text
      : input.committedPreviewText;
  const committed =
    previous &&
    previous.source === input.source &&
    previous.engineEpoch === input.engineEpoch &&
    previous.parakeetGeneration === input.parakeetGeneration &&
    previous.committed.text === committedPreviewText
      ? previous.committed
      : makeSegment(input, 'committed_preview', committedPreviewText);
  const tentative = input.tentativeText
    ? makeSegment(input, 'tentative', input.tentativeText)
    : null;
  return {
    source: input.source,
    engineEpoch: input.engineEpoch,
    parakeetGeneration: input.parakeetGeneration,
    revision: input.revision,
    audioEndSeconds: input.audioEndSeconds,
    committed,
    tentative,
    committedHistory: [committed],
  };
};

export const projectLiveTranscriptSnapshot = projectLiveTranscript;
