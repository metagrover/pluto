import type { LiveTranscriptSegment } from '../../components/features/recordingWorkspaceModel';
import type { LiveSource } from './contracts';

export type ParakeetEouToken = {
  text: string;
  startSeconds: number;
  endSeconds: number;
  committed: boolean;
};

export type ParakeetEouUpdate = {
  streamId: string;
  source: LiveSource;
  generation: number;
  revision: number;
  processedAudioSeconds: number;
  committedText: string;
  tentativeText: string;
  tokens: ParakeetEouToken[];
};

type ProjectedSegment = {
  segment: LiveTranscriptSegment;
  source: LiveSource;
  revision: number;
};

type SourceProjection = {
  revision: number;
  committedText: string;
  committedTokenCount: number;
  committed: ProjectedSegment[];
  tentative: ProjectedSegment | null;
};

const sourceRank: Record<LiveSource, number> = { mic: 0, system: 1 };
const STREAM_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;

export function createEouTranscriptProjection(): {
  apply(update: ParakeetEouUpdate): LiveTranscriptSegment[];
  reset(generation: number): void;
} {
  let generation: number | null = null;
  let projections: Record<LiveSource, SourceProjection> = emptyProjections();
  let rows: LiveTranscriptSegment[] = [];

  return {
    apply(update) {
      validateUpdate(update);
      if (generation === null) generation = update.generation;
      if (update.generation !== generation) return rows;
      const previous = projections[update.source];
      if (update.revision <= previous.revision) return rows;

      if (
        previous.committedText &&
        update.committedText !== previous.committedText &&
        !update.committedText.startsWith(`${previous.committedText} `)
      ) {
        throw new Error('parakeet_prefix_mutated');
      }
      const committedTokens = update.tokens.filter((token) => token.committed);
      const committed = [...previous.committed];
      if (update.committedText.length > previous.committedText.length) {
        const suffix = update.committedText
          .slice(previous.committedText.length)
          .trim();
        if (!suffix) throw new Error('parakeet_prefix_mutated');
        committed.push(
          makeSegment(update, 'committed', {
            text: suffix,
            startSeconds:
              committedTokens[previous.committedTokenCount]?.startSeconds ??
              (previous.tentative
                ? previous.tentative.segment.timestampMs / 1_000
                : update.processedAudioSeconds),
            endSeconds:
              committedTokens.at(-1)?.endSeconds ??
              update.processedAudioSeconds,
          }),
        );
      }
      const tentative = update.tentativeText
        ? makeSegment(update, 'tentative')
        : null;
      projections = {
        ...projections,
        [update.source]: {
          revision: update.revision,
          committedText: update.committedText,
          committedTokenCount: committedTokens.length,
          committed,
          tentative,
        },
      };
      rows = (Object.values(projections) as SourceProjection[])
        .flatMap((projection) => [
          ...projection.committed,
          ...(projection.tentative ? [projection.tentative] : []),
        ])
        .sort(
          (left, right) =>
            left.segment.timestampMs - right.segment.timestampMs ||
            sourceRank[left.source] - sourceRank[right.source] ||
            left.revision - right.revision,
        )
        .map(({ segment }) => segment);
      return rows;
    },
    reset(nextGeneration) {
      if (!Number.isSafeInteger(nextGeneration) || nextGeneration <= 0) {
        throw new Error('parakeet_request_invalid');
      }
      generation = nextGeneration;
      projections = emptyProjections();
      rows = [];
    },
  };
}

const emptyProjections = (): Record<LiveSource, SourceProjection> => ({
  mic: {
    revision: 0,
    committedText: '',
    committedTokenCount: 0,
    committed: [],
    tentative: null,
  },
  system: {
    revision: 0,
    committedText: '',
    committedTokenCount: 0,
    committed: [],
    tentative: null,
  },
});

const makeSegment = (
  update: ParakeetEouUpdate,
  kind: 'committed' | 'tentative',
  override?: { text: string; startSeconds: number; endSeconds: number },
): ProjectedSegment => {
  const selectedTokens = update.tokens.filter((candidate) =>
    kind === 'committed' ? candidate.committed : !candidate.committed,
  );
  const token = selectedTokens[0];
  const rawText =
    override?.text ??
    (kind === 'committed' ? update.committedText : update.tentativeText);
  return {
    segment: {
      id:
        kind === 'committed'
          ? `eou:${update.generation}:${update.source}:committed-${update.revision}`
          : `eou:${update.generation}:${update.source}:tentative`,
      speaker: 'Speaker',
      text: kind === 'committed' ? punctuateCommittedText(rawText) : rawText,
      rawText,
      source: update.source,
      timestampMs:
        (override?.startSeconds ??
          token?.startSeconds ??
          update.processedAudioSeconds) * 1_000,
      endTimestampMs:
        (override?.endSeconds ??
          selectedTokens.at(-1)?.endSeconds ??
          update.processedAudioSeconds) * 1_000,
      confirmed: kind === 'committed',
    },
    source: update.source,
    revision: update.revision,
  };
};

const punctuateCommittedText = (text: string): string => {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return normalized;
  const capitalized = normalized.replace(/[a-z]/i, (letter) =>
    letter.toUpperCase(),
  );
  if (/[.!?…]["')\]]?$/u.test(capitalized)) return capitalized;
  const isQuestion =
    /^(?:who|what|when|where|why|how|is|are|am|was|were|do|does|did|can|could|will|would|should|have|has|had)\b/iu.test(
      normalized,
    );
  return `${capitalized}${isQuestion ? '?' : '.'}`;
};

const validateUpdate = (update: ParakeetEouUpdate): void => {
  if (
    typeof update.streamId !== 'string' ||
    !STREAM_ID_PATTERN.test(update.streamId) ||
    update.streamId.includes('..') ||
    (update.source !== 'mic' && update.source !== 'system') ||
    !Number.isSafeInteger(update.generation) ||
    update.generation <= 0 ||
    !Number.isSafeInteger(update.revision) ||
    update.revision <= 0 ||
    !Number.isFinite(update.processedAudioSeconds) ||
    update.processedAudioSeconds < 0 ||
    typeof update.committedText !== 'string' ||
    typeof update.tentativeText !== 'string' ||
    !Array.isArray(update.tokens) ||
    update.tokens.some(
      (token) =>
        typeof token.text !== 'string' ||
        token.text.length === 0 ||
        !Number.isFinite(token.startSeconds) ||
        !Number.isFinite(token.endSeconds) ||
        token.startSeconds < 0 ||
        token.endSeconds < token.startSeconds ||
        token.endSeconds > update.processedAudioSeconds ||
        typeof token.committed !== 'boolean',
    )
  ) {
    throw new Error('parakeet_event_invalid');
  }
};
