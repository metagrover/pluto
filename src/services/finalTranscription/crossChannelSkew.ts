import type { AttributionSegment } from '../../utils/speakerAttribution.ts';

export const CROSS_CHANNEL_SKEW_POLICY_VERSION =
  'cross_channel_skew_v1' as const;

export type CrossChannelSkewEstimate = {
  policyVersion: typeof CROSS_CHANNEL_SKEW_POLICY_VERSION;
  offsetSeconds: number;
  anchorCount: number;
  confidence: number;
};

export type CrossChannelReconciliationMetadata = {
  policyVersion: typeof CROSS_CHANNEL_SKEW_POLICY_VERSION;
  skewApplied: boolean;
  estimatedOffsetMs: number;
  anchorCount: number;
  confidence: number;
  droppedMicWordCount: number;
  collapsedSequenceCount: number;
  droppedExactDuplicateSegmentCount: number;
  droppedEmbeddedMicFragmentCount: number;
};

type Anchor = {
  key: string;
  segmentIndex: number;
  wordStartIndex: number;
  wordEndIndex: number;
  startTime: number;
  endTime: number;
};

type AnchorPair = {
  mic: Anchor;
  system: Anchor;
  offsetSeconds: number;
};

const normalizeToken = (token: string): string =>
  token.toLowerCase().replace(/[^a-z0-9]/g, '');

const uniqueAnchors = (
  segments: AttributionSegment[],
  anchorWords: number,
): Map<string, Anchor> => {
  const anchors = new Map<string, Anchor | null>();

  segments.forEach((segment, segmentIndex) => {
    const words = segment.words ?? [];
    for (
      let startIndex = 0;
      startIndex <= words.length - anchorWords;
      startIndex++
    ) {
      const slice = words.slice(startIndex, startIndex + anchorWords);
      const tokens = slice.map((word) => normalizeToken(word.word));
      if (tokens.some((token) => token.length === 0)) continue;

      const key = tokens.join(' ');
      const anchor: Anchor = {
        key,
        segmentIndex,
        wordStartIndex: startIndex,
        wordEndIndex: startIndex + anchorWords - 1,
        startTime: slice[0].start,
        endTime: slice.at(-1)?.end ?? slice[0].end,
      };
      anchors.set(key, anchors.has(key) ? null : anchor);
    }
  });

  return new Map(
    [...anchors.entries()].filter(
      (entry): entry is [string, Anchor] => entry[1] !== null,
    ),
  );
};

const rangesOverlap = (left: Anchor, right: Anchor): boolean =>
  left.segmentIndex === right.segmentIndex &&
  left.wordStartIndex <= right.wordEndIndex &&
  right.wordStartIndex <= left.wordEndIndex;

const independentPairs = (pairs: AnchorPair[]): AnchorPair[] => {
  const selected: AnchorPair[] = [];
  for (const pair of [...pairs].sort(
    (left, right) => left.mic.startTime - right.mic.startTime,
  )) {
    if (
      selected.some(
        (existing) =>
          rangesOverlap(existing.mic, pair.mic) ||
          rangesOverlap(existing.system, pair.system),
      )
    ) {
      continue;
    }
    selected.push(pair);
  }
  return selected;
};

const round = (value: number): number => Number(value.toFixed(6));

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

export const estimateCrossChannelSkew = (input: {
  micSegments: AttributionSegment[];
  systemSegments: AttributionSegment[];
  anchorWords?: number;
  directToleranceSeconds?: number;
  maximumOffsetSeconds?: number;
  clusterWidthSeconds?: number;
  minimumIndependentAnchors?: number;
  minimumDominance?: number;
}): CrossChannelSkewEstimate | null => {
  const anchorWords = input.anchorWords ?? 4;
  const directToleranceSeconds = input.directToleranceSeconds ?? 0.75;
  const maximumOffsetSeconds = input.maximumOffsetSeconds ?? 2.5;
  const clusterWidthSeconds = input.clusterWidthSeconds ?? 0.24;
  const minimumIndependentAnchors = input.minimumIndependentAnchors ?? 3;
  const minimumDominance = input.minimumDominance ?? 0.75;

  const micAnchors = uniqueAnchors(input.micSegments, anchorWords);
  const systemAnchors = uniqueAnchors(input.systemSegments, anchorWords);
  const candidates: AnchorPair[] = [];

  for (const [key, mic] of micAnchors) {
    const system = systemAnchors.get(key);
    if (!system) continue;
    const micMidpoint = (mic.startTime + mic.endTime) / 2;
    const systemMidpoint = (system.startTime + system.endTime) / 2;
    const offsetSeconds = systemMidpoint - micMidpoint;
    if (Math.abs(offsetSeconds) > maximumOffsetSeconds) continue;
    candidates.push({ mic, system, offsetSeconds });
  }

  const independent = independentPairs(candidates);
  if (independent.length < minimumIndependentAnchors) return null;

  const sorted = [...independent].sort(
    (left, right) => left.offsetSeconds - right.offsetSeconds,
  );
  let dominant: AnchorPair[] = [];
  for (let start = 0; start < sorted.length; start++) {
    const cluster: AnchorPair[] = [];
    for (let end = start; end < sorted.length; end++) {
      if (
        sorted[end].offsetSeconds - sorted[start].offsetSeconds >
        clusterWidthSeconds
      ) {
        break;
      }
      cluster.push(sorted[end]);
    }
    if (cluster.length > dominant.length) dominant = cluster;
  }

  const confidence = dominant.length / independent.length;
  if (
    dominant.length < minimumIndependentAnchors ||
    confidence < minimumDominance
  ) {
    return null;
  }

  const offsetSeconds = median(
    dominant.map((candidate) => candidate.offsetSeconds),
  );
  if (Math.abs(offsetSeconds) <= directToleranceSeconds) return null;

  return {
    policyVersion: CROSS_CHANNEL_SKEW_POLICY_VERSION,
    offsetSeconds: round(offsetSeconds),
    anchorCount: dominant.length,
    confidence: round(confidence),
  };
};
