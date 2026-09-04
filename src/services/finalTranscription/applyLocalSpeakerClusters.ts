import type { DiarizationTurn } from '../../utils/acousticSpeakerAttribution.ts';
import type {
  AttributionSegment,
  WordTimestamp,
} from '../../utils/speakerAttribution.ts';

const MINIMUM_CLUSTER_SECONDS = 1;
const MINIMUM_ITEM_COVERAGE = 0.5;
const MINIMUM_TOTAL_COVERAGE = 0.8;

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

const bestLabel = (
  interval: { startTime: number; endTime: number },
  turns: DiarizationTurn[],
  labels: Map<string, string>,
): string | null => {
  const duration = interval.endTime - interval.startTime;
  if (duration <= 0) return null;
  const scores = new Map<string, number>();
  for (const turn of turns) {
    if (!labels.has(turn.cluster)) continue;
    scores.set(
      turn.cluster,
      (scores.get(turn.cluster) ?? 0) + overlapSeconds(interval, turn),
    );
  }
  const ranked = [...scores.entries()].sort(
    (left, right) => right[1] - left[1],
  );
  const winner = ranked[0];
  if (
    !winner ||
    winner[1] / duration < MINIMUM_ITEM_COVERAGE ||
    (ranked[1]?.[1] ?? 0) > 0.001
  ) {
    return null;
  }
  return labels.get(winner[0]) ?? null;
};

const renderWords = (words: WordTimestamp[]): string => {
  let text = '';
  for (const recognized of words) {
    if (text.length === 0) text = recognized.word;
    else if (/^[,.;:!?…%)\]}]/u.test(recognized.word)) text += recognized.word;
    else text += ` ${recognized.word}`;
  }
  return text;
};

export type LocalSpeakerClusterResult<T extends AttributionSegment> = {
  applied: boolean;
  multipleSpeakers: boolean;
  confidence: number;
  clusterCount: number;
  labeledSegmentCount: number;
  segments: T[];
};

export const applyLocalSpeakerClusters = <T extends AttributionSegment>(input: {
  segments: T[];
  turns: DiarizationTurn[];
}): LocalSpeakerClusterResult<T> => {
  const micSegments = input.segments.filter(
    (segment) => segment.speaker === 'Me',
  );
  const turns = input.turns.filter(validTurn);
  const support = new Map<string, { seconds: number; first: number }>();
  for (const turn of turns) {
    const seconds = micSegments.reduce(
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
    return {
      applied: false,
      multipleSpeakers: false,
      confidence: 0,
      clusterCount: established.length,
      labeledSegmentCount: 0,
      segments: input.segments.map((segment) => ({ ...segment })),
    };
  }

  const labels = new Map(
    established.map(([cluster], index) => [
      cluster,
      `Local Speaker ${index + 1}`,
    ]),
  );
  const projected: T[] = [];
  let totalSeconds = 0;
  let labeledSeconds = 0;
  for (const segment of input.segments) {
    if (segment.speaker !== 'Me') {
      projected.push({ ...segment });
      continue;
    }
    const timedWords = segment.words?.filter(
      (word) =>
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end >= word.start,
    );
    if (timedWords?.length) {
      const assignments = timedWords.map((word) => ({
        word,
        speaker:
          bestLabel(
            { startTime: word.start, endTime: word.end },
            turns,
            labels,
          ) ?? 'Unknown',
      }));
      const knownLabels = new Set(
        assignments
          .map((assignment) => assignment.speaker)
          .filter((speaker) => speaker !== 'Unknown'),
      );
      const segmentLabel = bestLabel(segment, turns, labels);
      if (
        knownLabels.size === 1 &&
        segmentLabel &&
        knownLabels.has(segmentLabel)
      ) {
        for (const assignment of assignments) {
          if (assignment.speaker === 'Unknown') {
            assignment.speaker = segmentLabel;
          }
        }
      } else {
        for (const [index, assignment] of assignments.entries()) {
          if (assignment.speaker !== 'Unknown') continue;
          const before = assignments
            .slice(0, index)
            .reverse()
            .find((candidate) => candidate.speaker !== 'Unknown')?.speaker;
          const after = assignments
            .slice(index + 1)
            .find((candidate) => candidate.speaker !== 'Unknown')?.speaker;
          if (before && before === after) assignment.speaker = before;
        }
      }
      let groupStart = 0;
      for (let index = 1; index <= assignments.length; index++) {
        if (
          index < assignments.length &&
          assignments[index]?.speaker === assignments[groupStart]?.speaker
        ) {
          continue;
        }
        const group = assignments.slice(groupStart, index);
        const duration = group.reduce(
          (total, entry) =>
            total + Math.max(0, entry.word.end - entry.word.start),
          0,
        );
        totalSeconds += duration;
        if (group[0]?.speaker !== 'Unknown') labeledSeconds += duration;
        projected.push({
          ...segment,
          speaker: group[0]?.speaker ?? 'Unknown',
          text: renderWords(group.map((entry) => entry.word)).trim(),
          startTime: group[0]?.word.start ?? segment.startTime,
          endTime: group.at(-1)?.word.end ?? segment.endTime,
          words: group.map((entry) => entry.word),
        } as T);
        groupStart = index;
      }
      continue;
    }
    const duration = Math.max(0, segment.endTime - segment.startTime);
    const speaker = bestLabel(segment, turns, labels) ?? 'Unknown';
    totalSeconds += duration;
    if (speaker !== 'Unknown') labeledSeconds += duration;
    projected.push({ ...segment, speaker } as T);
  }
  const confidence =
    totalSeconds > 0
      ? Math.round(Math.min(1, labeledSeconds / totalSeconds) * 1000) / 1000
      : 0;
  const applied = confidence >= MINIMUM_TOTAL_COVERAGE;
  const segments = applied
    ? projected
    : projected.map((segment) =>
        /^Local Speaker \d+$/u.test(segment.speaker)
          ? ({ ...segment, speaker: 'Unknown' } as T)
          : segment,
      );
  return {
    applied,
    multipleSpeakers: true,
    confidence,
    clusterCount: established.length,
    labeledSegmentCount: applied
      ? segments.filter((segment) =>
          /^Local Speaker \d+$/u.test(segment.speaker),
        ).length
      : 0,
    segments,
  };
};
