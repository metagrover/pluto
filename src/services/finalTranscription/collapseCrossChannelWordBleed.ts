import type { AttributionSegment } from '../../utils/speakerAttribution.ts';
import {
  CROSS_CHANNEL_SKEW_POLICY_VERSION,
  type CrossChannelReconciliationMetadata,
  estimateCrossChannelSkew,
} from './crossChannelSkew.ts';

type WordLocation = {
  segmentIndex: number;
  wordIndex: number;
  token: string;
  at: number;
  start: number;
  end: number;
};

const normalizeToken = (word: string) =>
  word
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}']/gu, '')
    .trim();

const flattenWords = (segments: AttributionSegment[]): WordLocation[] =>
  segments.flatMap((segment, segmentIndex) =>
    (segment.words || []).flatMap((word, wordIndex) => {
      const token = normalizeToken(word.word);
      return token
        ? [
            {
              segmentIndex,
              wordIndex,
              token,
              at: (word.start + word.end) / 2,
              start: word.start,
              end: word.end,
            },
          ]
        : [];
    }),
  );

const renderWords = (
  words: NonNullable<AttributionSegment['words']>,
): string => {
  let text = '';
  for (const word of words) {
    if (!text) text = word.word;
    else if (/^[,.;:!?…%)\]}]/.test(word.word)) text += word.word;
    else text += ` ${word.word}`;
  }
  return text;
};

const segmentText = (segment: AttributionSegment): string =>
  segment.text
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();

const coveredSeconds = (words: WordLocation[]): number => {
  const sorted = [...words].sort((left, right) => left.start - right.start);
  let total = 0;
  let activeStart: number | null = null;
  let activeEnd = 0;
  for (const word of sorted) {
    if (activeStart === null || word.start > activeEnd) {
      if (activeStart !== null) total += activeEnd - activeStart;
      activeStart = word.start;
      activeEnd = word.end;
    } else {
      activeEnd = Math.max(activeEnd, word.end);
    }
  }
  return activeStart === null ? total : total + activeEnd - activeStart;
};

const dedupeExactSegments = (segments: AttributionSegment[]) => {
  const seen = new Set<string>();
  let dropped = 0;
  const retained = segments.filter((segment) => {
    const key = `${segment.startTime}|${segment.endTime}|${segmentText(segment)}`;
    if (seen.has(key)) {
      dropped += 1;
      return false;
    }
    seen.add(key);
    return true;
  });
  return { segments: retained, dropped };
};

const removeEmbeddedMicLetterArtifacts = (
  micSegments: AttributionSegment[],
  systemSegments: AttributionSegment[],
) => {
  let dropped = 0;
  const segments = micSegments.filter((mic) => {
    const normalized = segmentText(mic);
    const duration = mic.endTime - mic.startTime;
    if (!/^\p{L}$/u.test(normalized) || duration < 0 || duration > 0.25) {
      return true;
    }
    const embedded = systemSegments.some(
      (system) =>
        system.endTime - system.startTime >= 2 &&
        (system.words?.length ?? 0) >= 3 &&
        mic.startTime >= system.startTime &&
        mic.endTime <= system.endTime,
    );
    if (embedded) dropped += 1;
    return !embedded;
  });
  return { segments, dropped };
};

export const collapseCrossChannelWordBleed = (input: {
  micSegments: AttributionSegment[];
  systemSegments: AttributionSegment[];
  minimumSequenceWords?: number;
  timingToleranceSeconds?: number;
}) => {
  const minimumSequenceWords = input.minimumSequenceWords ?? 3;
  const timingToleranceSeconds = input.timingToleranceSeconds ?? 0.75;
  const dedupedMic = dedupeExactSegments(input.micSegments);
  const dedupedSystem = dedupeExactSegments(input.systemSegments);
  const filteredMic = removeEmbeddedMicLetterArtifacts(
    dedupedMic.segments,
    dedupedSystem.segments,
  );
  const micSourceSegments = filteredMic.segments;
  const systemSourceSegments = dedupedSystem.segments;
  const micWords = flattenWords(micSourceSegments);
  const systemWords = flattenWords(systemSourceSegments);
  const skewEstimate = estimateCrossChannelSkew({
    micSegments: micSourceSegments,
    systemSegments: systemSourceSegments,
    directToleranceSeconds: timingToleranceSeconds,
  });
  const alignmentOffsets = skewEstimate ? [0, skewEstimate.offsetSeconds] : [0];
  const systemStartsByToken = new Map<string, number[]>();
  systemWords.forEach((word, index) => {
    const starts = systemStartsByToken.get(word.token) || [];
    starts.push(index);
    systemStartsByToken.set(word.token, starts);
  });
  const droppedMicWords = new Set<string>();
  let collapsedSequenceCount = 0;

  for (let micStart = 0; micStart < micWords.length; micStart += 1) {
    let collapsed = false;
    for (const alignmentOffsetSeconds of alignmentOffsets) {
      for (const systemStart of systemStartsByToken.get(
        micWords[micStart].token,
      ) || []) {
        if (
          Math.abs(
            systemWords[systemStart].at -
              micWords[micStart].at -
              alignmentOffsetSeconds,
          ) > timingToleranceSeconds
        ) {
          continue;
        }
        let length = 0;
        while (
          micStart + length < micWords.length &&
          systemStart + length < systemWords.length &&
          micWords[micStart + length].token ===
            systemWords[systemStart + length].token &&
          Math.abs(
            systemWords[systemStart + length].at -
              micWords[micStart + length].at -
              alignmentOffsetSeconds,
          ) <= timingToleranceSeconds
        ) {
          length += 1;
        }
        if (length < minimumSequenceWords) continue;
        let added = false;
        for (let offset = 0; offset < length; offset += 1) {
          const word = micWords[micStart + offset];
          const key = `${word.segmentIndex}:${word.wordIndex}`;
          if (!droppedMicWords.has(key)) added = true;
          droppedMicWords.add(key);
        }
        if (added) collapsedSequenceCount += 1;
        micStart += length - 1;
        collapsed = true;
        break;
      }
      if (collapsed) break;
    }
  }

  const micSegments = micSourceSegments.flatMap((segment, segmentIndex) => {
    if (!segment.words?.length) return [segment];
    const words = segment.words.filter(
      (_word, wordIndex) =>
        !droppedMicWords.has(`${segmentIndex}:${wordIndex}`),
    );
    if (words.length === 0) return [];
    if (words.length === segment.words.length) return [segment];
    return [
      {
        ...segment,
        startTime: words[0].start,
        endTime: words.at(-1)?.end ?? words[0].end,
        text: renderWords(words),
        words,
      },
    ];
  });

  const reconciliation: CrossChannelReconciliationMetadata = {
    policyVersion: CROSS_CHANNEL_SKEW_POLICY_VERSION,
    skewApplied: skewEstimate !== null,
    estimatedOffsetMs: skewEstimate
      ? Math.round(skewEstimate.offsetSeconds * 1_000)
      : 0,
    anchorCount: skewEstimate?.anchorCount ?? 0,
    confidence: skewEstimate?.confidence ?? 0,
    droppedMicWordCount: droppedMicWords.size,
    collapsedSequenceCount,
    droppedExactDuplicateSegmentCount:
      dedupedMic.dropped + dedupedSystem.dropped,
    droppedEmbeddedMicFragmentCount: filteredMic.dropped,
  };

  return {
    micSegments,
    systemSegments: systemSourceSegments,
    droppedMicWordCount: droppedMicWords.size,
    droppedMicSeconds: coveredSeconds(
      micWords.filter((word) =>
        droppedMicWords.has(`${word.segmentIndex}:${word.wordIndex}`),
      ),
    ),
    collapsedSequenceCount,
    reconciliation,
  };
};
