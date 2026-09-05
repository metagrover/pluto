import type { DiarizationTurn } from '../../utils/acousticSpeakerAttribution.ts';
import type {
  AttributionSegment,
  WordTimestamp,
} from '../../utils/speakerAttribution.ts';

import {
  type RemoteSpeechSupport,
  type SystemEnergyWindow,
  createRemoteSpeechSupport,
} from './remoteSpeakerSupport.ts';

const MINIMUM_CLUSTER_SECONDS = 1;
const MINIMUM_ALIGNMENT_COVERAGE = 0.8;
const MINIMUM_ITEM_COVERAGE = 0.5;

export type RemoteDiarizationFallbackReason =
  | 'no_system_speech'
  | 'no_diarization_segments'
  | 'not_enough_speakers'
  | 'low_coverage';

export type RemoteDiarizationMetadata = {
  attempted: true;
  input: 'system_audio';
  applied: boolean;
  confidence: number;
  clusterCount: number;
  labeledSegmentCount: number;
  fallbackReason?: RemoteDiarizationFallbackReason;
};

const overlapSeconds = (
  left: { startTime: number; endTime: number },
  right: { startTime: number; endTime: number },
) =>
  Math.max(
    0,
    Math.min(left.endTime, right.endTime) -
      Math.max(left.startTime, right.startTime),
  );

const validTurn = (turn: DiarizationTurn) =>
  Number.isFinite(turn.startTime) &&
  Number.isFinite(turn.endTime) &&
  turn.startTime >= 0 &&
  turn.endTime > turn.startTime &&
  Boolean(turn.cluster.trim());

const roundConfidence = (value: number) =>
  Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;

const bestCluster = (
  support: RemoteSpeechSupport,
  turns: DiarizationTurn[],
  labels: Map<string, string>,
): string | null => {
  const duration = support.duration;
  if (duration <= 0) return null;
  const rank = (padding: number) => {
    const scores = new Map<string, number>();
    const coveredUntil = new Map<string, number>();
    for (const turn of turns) {
      if (!labels.has(turn.cluster)) continue;
      // Turns are chronological. Count their union for each speaker so nearby
      // expanded boundaries cannot credit the same speech interval twice.
      const startTime = Math.max(
        0,
        turn.startTime - padding,
        coveredUntil.get(turn.cluster) ?? 0,
      );
      const endTime = turn.endTime + padding;
      coveredUntil.set(turn.cluster, Math.max(startTime, endTime));
      if (endTime <= startTime) continue;
      scores.set(
        turn.cluster,
        (scores.get(turn.cluster) ?? 0) +
          support.intervals.reduce(
            (total, interval) =>
              total +
              overlapSeconds(interval, {
                startTime,
                endTime,
              }),
            0,
          ),
      );
    }
    return [...scores.entries()].sort((left, right) => right[1] - left[1]);
  };
  const raw = rank(0);
  // Never resolve an actual overlap by enlarging or preferring either speaker.
  if ((raw[1]?.[1] ?? 0) > 0.001) return null;
  if (raw[0] && raw[0][1] / duration >= MINIMUM_ITEM_COVERAGE)
    return labels.get(raw[0][0]) ?? null;
  if (!support.measured) return null;
  // Permit at most one native energy frame of boundary disagreement. This is
  // only a fallback; padding cannot make an already aligned word ambiguous.
  const padded = rank(0.1);
  if (
    !padded[0] ||
    padded[0][1] / duration < MINIMUM_ITEM_COVERAGE ||
    (padded[1]?.[1] ?? 0) > 0.001
  )
    return null;
  return labels.get(padded[0][0]) ?? null;
};

const wordInterval = (word: WordTimestamp) => ({
  startTime: word.start,
  endTime: word.end,
});

const renderWords = (words: WordTimestamp[]): string => {
  let text = '';
  for (const recognized of words) {
    const token = recognized.word;
    if (text.length === 0) text = token;
    else if (/^[,.;:!?…%)\]}]/u.test(token)) text += token;
    else text += ` ${token}`;
  }
  return text;
};

export const applyRemoteSpeakerClusters = <
  T extends AttributionSegment,
>(input: {
  segments: T[];
  turns: DiarizationTurn[];
  systemEnergyWindows?: SystemEnergyWindow[];
}): {
  applied: boolean;
  segments: T[];
  metadata: RemoteDiarizationMetadata;
} => {
  const systemSegments = input.segments.filter(
    (segment) => segment.speaker === 'Them',
  );
  const fallback = (
    fallbackReason: RemoteDiarizationFallbackReason,
    confidence = 0,
    clusterCount = 0,
  ) => ({
    applied: false,
    segments: input.segments.map((segment) => ({ ...segment })),
    metadata: {
      attempted: true as const,
      input: 'system_audio' as const,
      applied: false,
      confidence: roundConfidence(confidence),
      clusterCount,
      labeledSegmentCount: 0,
      fallbackReason,
    },
  });

  if (systemSegments.length === 0) return fallback('no_system_speech');
  const turns = input.turns.filter(validTurn);
  if (turns.length === 0) return fallback('no_diarization_segments');

  const support = new Map<string, { seconds: number; first: number }>();
  for (const turn of turns) {
    const seconds = systemSegments.reduce(
      (total, segment) => total + overlapSeconds(turn, segment),
      0,
    );
    if (seconds <= 0) continue;
    const current = support.get(turn.cluster);
    support.set(turn.cluster, {
      seconds: (current?.seconds ?? 0) + seconds,
      first: Math.min(
        current?.first ?? Number.POSITIVE_INFINITY,
        turn.startTime,
      ),
    });
  }
  const established = [...support.entries()]
    .filter(([, value]) => value.seconds >= MINIMUM_CLUSTER_SECONDS)
    .sort(
      (left, right) =>
        left[1].first - right[1].first || left[0].localeCompare(right[0]),
    );
  if (established.length < 2) {
    return fallback('not_enough_speakers', 0, established.length);
  }
  const labels = new Map(
    established.map(([cluster], index) => [
      cluster,
      `Remote Speaker ${index + 1}`,
    ]),
  );
  const orderedTurns = [...turns].sort(
    (left, right) => left.startTime - right.startTime,
  );
  const alignmentTurns = orderedTurns.map((turn, index) => {
    if (
      labels.has(turn.cluster) ||
      turn.endTime - turn.startTime >= MINIMUM_CLUSTER_SECONDS
    ) {
      return turn;
    }
    const previous = orderedTurns[index - 1];
    const next = orderedTurns[index + 1];
    if (
      previous &&
      next &&
      labels.has(previous.cluster) &&
      previous.cluster === next.cluster &&
      turn.startTime - previous.endTime <= 0.25 &&
      next.startTime - turn.endTime <= 0.25
    ) {
      return { ...turn, cluster: previous.cluster };
    }
    return turn;
  });

  const speechSupport = createRemoteSpeechSupport(input.systemEnergyWindows);
  let totalSpeechSeconds = 0;
  let labeledSpeechSeconds = 0;
  const aligned: T[] = [];
  for (const segment of input.segments) {
    if (segment.speaker !== 'Them') {
      aligned.push({ ...segment });
      continue;
    }
    const timedWords = segment.words?.filter(
      (word) =>
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end >= word.start,
    );
    if (timedWords?.length) {
      const assignments = timedWords.map((word) => {
        const support = speechSupport(wordInterval(word));
        return {
          word,
          support,
          speaker: bestCluster(support, alignmentTurns, labels) ?? 'Them',
        };
      });
      for (let index = 0; index < assignments.length; index++) {
        const assignment = assignments[index];
        if (
          assignment.word.end > assignment.word.start ||
          assignment.speaker !== 'Them'
        ) {
          continue;
        }
        const previous = assignments[index - 1]?.speaker;
        const next = assignments[index + 1]?.speaker;
        if (/^[,.;:!?…%)\]}]/u.test(assignment.word.word) && previous) {
          assignment.speaker = previous;
        } else if (previous && previous === next) {
          assignment.speaker = previous;
        }
      }
      for (const assignment of assignments) {
        const duration = assignment.support.duration;
        totalSpeechSeconds += duration;
        if (assignment.speaker !== 'Them') labeledSpeechSeconds += duration;
      }
      let groupStart = 0;
      for (let index = 1; index <= assignments.length; index++) {
        if (
          index < assignments.length &&
          assignments[index].speaker === assignments[groupStart].speaker
        ) {
          continue;
        }
        const group = assignments.slice(groupStart, index);
        aligned.push({
          ...segment,
          speaker: group[0].speaker,
          text: renderWords(group.map(({ word }) => word)).trim(),
          startTime: group[0].word.start,
          endTime: group.at(-1)?.word.end ?? group[0].word.end,
          words: group.map(({ word }) => word),
        } as T);
        groupStart = index;
      }
      continue;
    }

    const support = speechSupport(segment);
    const duration = support.duration;
    const speaker = bestCluster(support, alignmentTurns, labels) ?? 'Them';
    totalSpeechSeconds += duration;
    if (speaker !== 'Them') labeledSpeechSeconds += duration;
    aligned.push({ ...segment, speaker } as T);
  }

  const confidence =
    totalSpeechSeconds > 0 ? labeledSpeechSeconds / totalSpeechSeconds : 0;
  if (confidence < MINIMUM_ALIGNMENT_COVERAGE) {
    return fallback('low_coverage', confidence, established.length);
  }
  const labeledSegmentCount = aligned.filter((segment) =>
    /^Remote Speaker \d+$/u.test(segment.speaker),
  ).length;
  return {
    applied: true,
    segments: aligned,
    metadata: {
      attempted: true,
      input: 'system_audio',
      applied: true,
      confidence: roundConfidence(confidence),
      clusterCount: established.length,
      labeledSegmentCount,
    },
  };
};
