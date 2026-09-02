import { isEmbeddedMicFragment } from '../../utils/readableTranscript.ts';
import type {
  AttributionSegment,
  SpeakerActivityWindow,
} from '../../utils/speakerAttribution.ts';
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

const rebuildWordSegments = (
  segments: AttributionSegment[],
  droppedWords: Set<string>,
  speakerForWord?: (key: string, fallback: string) => string,
): AttributionSegment[] =>
  segments.flatMap((segment, segmentIndex) => {
    if (!segment.words?.length) return [segment];
    const retained = segment.words.flatMap((word, wordIndex) => {
      const key = `${segmentIndex}:${wordIndex}`;
      return droppedWords.has(key)
        ? []
        : [
            {
              word,
              speaker:
                speakerForWord?.(key, segment.speaker) ?? segment.speaker,
            },
          ];
    });
    const chunks: Array<{
      speaker: string;
      words: NonNullable<AttributionSegment['words']>;
    }> = [];
    for (const entry of retained) {
      const current = chunks.at(-1);
      if (!current || current.speaker !== entry.speaker) {
        chunks.push({ speaker: entry.speaker, words: [entry.word] });
      } else {
        current.words.push(entry.word);
      }
    }
    return chunks.map((chunk) => ({
      ...segment,
      speaker: chunk.speaker,
      startTime: chunk.words[0].start,
      endTime: chunk.words.at(-1)?.end ?? chunk.words[0].end,
      text: renderWords(chunk.words),
      words: chunk.words,
    }));
  });

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

const activitySeconds = (
  windows: SpeakerActivityWindow[],
  speaker: SpeakerActivityWindow['speaker'],
  startTime: number,
  endTime: number,
): number =>
  windows
    .filter((window) => window.speaker === speaker)
    .reduce(
      (total, window) =>
        total +
        Math.max(
          0,
          Math.min(endTime, window.endTime) -
            Math.max(startTime, window.startTime),
        ),
      0,
    );

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

const removeEmbeddedMicFragments = (
  micSegments: AttributionSegment[],
  systemSegments: AttributionSegment[],
) => {
  let dropped = 0;
  const candidates = [...micSegments, ...systemSegments];
  const segments = micSegments.filter((mic) => {
    const embedded = isEmbeddedMicFragment(mic, candidates);
    if (embedded) dropped += 1;
    return !embedded;
  });
  return { segments, dropped };
};

export const collapseCrossChannelWordBleed = (input: {
  micSegments: AttributionSegment[];
  systemSegments: AttributionSegment[];
  activityWindows?: SpeakerActivityWindow[];
  fallbackActivityWindows?: SpeakerActivityWindow[];
  minimumSequenceWords?: number;
  timingToleranceSeconds?: number;
}) => {
  const minimumSequenceWords = input.minimumSequenceWords ?? 3;
  const timingToleranceSeconds = input.timingToleranceSeconds ?? 0.75;
  const dedupedMic = dedupeExactSegments(input.micSegments);
  const dedupedSystem = dedupeExactSegments(input.systemSegments);
  const filteredMic = removeEmbeddedMicFragments(
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
  const droppedSystemWords = new Set<string>();
  const ambiguousMicWords = new Set<string>();
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
          const micWord = micWords[micStart + offset];
          const systemWord = systemWords[systemStart + offset];
          const localActivity = activitySeconds(
            input.activityWindows ?? [],
            'Me',
            micWord.start,
            micWord.end,
          );
          const remoteActivity = activitySeconds(
            input.activityWindows ?? [],
            'Them',
            micWord.start,
            micWord.end,
          );
          let duplicateIsLocal = localActivity > remoteActivity;
          if (
            localActivity > 0 &&
            Math.abs(localActivity - remoteActivity) <= 0.01
          ) {
            const fallbackLocalActivity = activitySeconds(
              input.fallbackActivityWindows ?? [],
              'Me',
              micWord.start,
              micWord.end,
            );
            const fallbackRemoteActivity = activitySeconds(
              input.fallbackActivityWindows ?? [],
              'Them',
              micWord.start,
              micWord.end,
            );
            if (fallbackLocalActivity === fallbackRemoteActivity) {
              ambiguousMicWords.add(
                `${micWord.segmentIndex}:${micWord.wordIndex}`,
              );
              droppedSystemWords.add(
                `${systemWord.segmentIndex}:${systemWord.wordIndex}`,
              );
              continue;
            }
            duplicateIsLocal = fallbackLocalActivity > fallbackRemoteActivity;
          }
          const word = duplicateIsLocal ? systemWord : micWord;
          const key = `${word.segmentIndex}:${word.wordIndex}`;
          const droppedWords = duplicateIsLocal
            ? droppedSystemWords
            : droppedMicWords;
          if (!droppedWords.has(key)) added = true;
          droppedWords.add(key);
        }
        if (added) collapsedSequenceCount += 1;
        micStart += length - 1;
        collapsed = true;
        break;
      }
      if (collapsed) break;
    }
  }

  const micSegments = rebuildWordSegments(
    micSourceSegments,
    droppedMicWords,
    (key, fallback) => (ambiguousMicWords.has(key) ? 'Unknown' : fallback),
  );
  const systemSegments = rebuildWordSegments(
    systemSourceSegments,
    droppedSystemWords,
  );

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
    systemSegments,
    droppedMicWordCount: droppedMicWords.size,
    droppedMicSeconds: coveredSeconds(
      micWords.filter((word) =>
        droppedMicWords.has(`${word.segmentIndex}:${word.wordIndex}`),
      ),
    ),
    collapsedSequenceCount,
    unresolvedAmbiguousSeconds: 0,
    reconciliation,
  };
};
