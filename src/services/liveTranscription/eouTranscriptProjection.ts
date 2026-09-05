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
  apply(
    update: ParakeetEouUpdate,
    sourceOffsetSeconds?: number,
  ): LiveTranscriptSegment[];
  reset(generation: number): void;
} {
  let generation: number | null = null;
  let projections: Record<LiveSource, SourceProjection> = emptyProjections();
  let rows: LiveTranscriptSegment[] = [];

  return {
    apply(update, sourceOffsetSeconds = 0) {
      validateUpdate(update);
      if (!Number.isFinite(sourceOffsetSeconds) || sourceOffsetSeconds < 0) {
        throw new Error('parakeet_event_invalid');
      }
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
            tokens: committedTokens.slice(previous.committedTokenCount),
            sourceOffsetSeconds,
          }),
        );
      }
      const tentative = update.tentativeText
        ? makeSegment(update, 'tentative', { sourceOffsetSeconds })
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
            Number(right.segment.confirmed) - Number(left.segment.confirmed) ||
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

const projectWordTimings = (
  text: string,
  tokens: ParakeetEouToken[],
  offsetSeconds: number,
): LiveTranscriptSegment['wordTimings'] => {
  if (
    tokens.some(
      (token, index) =>
        index > 0 &&
        (token.startSeconds < tokens[index - 1].startSeconds ||
          token.endSeconds < tokens[index - 1].endSeconds),
    )
  )
    return undefined;
  const normalized = (value: string) => value.trim().replace(/\s+/gu, ' ');
  const pieces = tokens.map((token) => token.text.replace(/▁/gu, ' '));
  const separator = normalized(pieces.join('')) === normalized(text) ? '' : ' ';
  const decoded = pieces.join(separator);
  if (normalized(decoded) !== normalized(text)) return undefined;
  let cursor = 0;
  const ranges = pieces.map((piece, index) => {
    const start = cursor;
    cursor += piece.length;
    const range = { start, end: cursor, token: tokens[index] };
    cursor += separator.length;
    return range;
  });
  const words: NonNullable<LiveTranscriptSegment['wordTimings']> = [];
  let tokenIndex = 0;
  for (const word of decoded.matchAll(/\S+/gu)) {
    const start = word.index ?? 0;
    const end = start + word[0].length;
    while (tokenIndex < ranges.length && ranges[tokenIndex].end <= start)
      tokenIndex += 1;
    const first = ranges[tokenIndex];
    if (!first) return undefined;
    let lastIndex = tokenIndex;
    while (lastIndex + 1 < ranges.length && ranges[lastIndex + 1].start < end)
      lastIndex += 1;
    const last = ranges[lastIndex];
    words.push({
      text: word[0],
      timestampMs: (first.token.startSeconds + offsetSeconds) * 1000,
      endTimestampMs: (last.token.endSeconds + offsetSeconds) * 1000,
    });
  }
  return words;
};

const makeSegment = (
  update: ParakeetEouUpdate,
  kind: 'committed' | 'tentative',
  override?: {
    text?: string;
    startSeconds?: number;
    endSeconds?: number;
    tokens?: ParakeetEouToken[];
    sourceOffsetSeconds?: number;
  },
): ProjectedSegment => {
  const selectedTokens =
    override?.tokens ??
    update.tokens.filter((candidate) =>
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
      text:
        kind === 'committed'
          ? punctuateCommittedText(rawText, selectedTokens)
          : rawText,
      rawText,
      wordTimings: projectWordTimings(
        rawText,
        selectedTokens,
        override?.sourceOffsetSeconds ?? 0,
      ),
      source: update.source,
      timestampMs:
        ((override?.startSeconds ??
          token?.startSeconds ??
          update.processedAudioSeconds) +
          (override?.sourceOffsetSeconds ?? 0)) *
        1_000,
      endTimestampMs:
        ((override?.endSeconds ??
          selectedTokens.at(-1)?.endSeconds ??
          update.processedAudioSeconds) +
          (override?.sourceOffsetSeconds ?? 0)) *
        1_000,
      confirmed: kind === 'committed',
    },
    source: update.source,
    revision: update.revision,
  };
};

const QUESTION_START =
  /^(?:who|what|when|where|why|how|is|are|am|was|were|do|does|did|can|could|will|would|should|have|has|had)\b/iu;

const punctuateCommittedText = (
  text: string,
  tokens: ParakeetEouToken[],
): string => {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return normalized;
  const words = normalized.split(' ');
  const canUsePauses = tokens.length === words.length;
  let sentenceStart = 0;
  let capitalizeNext = true;

  return words
    .map((word, index) => {
      let presented = capitalizeNext
        ? word.replace(/[a-z]/i, (letter) => letter.toUpperCase())
        : word;
      capitalizeNext = false;
      const terminal = /[.!?…]["')\]]?$/u.test(presented);
      if (terminal) {
        sentenceStart = index + 1;
        capitalizeNext = true;
        return presented;
      }

      const nextGap = canUsePauses
        ? (tokens[index + 1]?.startSeconds ?? Number.POSITIVE_INFINITY) -
          tokens[index].endSeconds
        : index === words.length - 1
          ? Number.POSITIVE_INFINITY
          : 0;
      if (nextGap >= 0.8) {
        const sentence = words.slice(sentenceStart, index + 1).join(' ');
        presented += QUESTION_START.test(sentence) ? '?' : '.';
        sentenceStart = index + 1;
        capitalizeNext = true;
      } else if (nextGap >= 0.4 && !/[,;:]$/u.test(presented)) {
        presented += ',';
      }
      return presented;
    })
    .join(' ');
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
