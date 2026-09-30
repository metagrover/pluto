import type { LiveTranscriptSegment } from '../../components/features/recordingWorkspaceModel';
import type {
  LiveTranscriptReading,
  LiveTranscriptReadingRange,
} from './liveTranscriptReconciliation';

export type LiveConversationPart = {
  id: string;
  sourceSegmentId: string;
  source: 'mic' | 'system';
  text: string;
  timestampMs: number;
  endTimestampMs: number;
};

export type LiveConversationRow = {
  id: string;
  sourceSegmentId: string;
  source: 'mic' | 'system';
  speaker: LiveTranscriptSegment['speaker'];
  timestampMs: number;
  endTimestampMs: number;
  text: string;
  parts: LiveConversationPart[];
  display: 'speech' | 'duplicate_removed';
  qualifier?: 'updated';
};

export type LiveConversationDraft = {
  id: 'live-conversation-draft';
  parts: LiveConversationPart[];
  collapsedParts: LiveConversationPart[];
  wordCount: number;
  truncated: boolean;
};

export type LiveConversationMetrics = {
  corrections: number;
  restorations: number;
  lateArrivals: number;
  degradedReconciliations: number;
  draftWordCount: number;
  lastProjectionDurationMs: number;
  mutableRows: number;
  retainedParts: number;
  micWatermarkMs: number | null;
  systemWatermarkMs: number | null;
};

export type LiveConversationSnapshot = {
  generation: number;
  status:
    | 'active'
    | 'unavailable'
    | 'finished'
    | 'degraded'
    | 'catching_up'
    | 'reconnecting';
  rows: LiveConversationRow[];
  draft: LiveConversationDraft | null;
  metrics: LiveConversationMetrics;
};

export type LiveConversationTimelineItem =
  | {
      kind: 'committed';
      id: string;
      source: 'mic' | 'system';
      timestampMs: number;
      row: LiveConversationRow;
      continuesPrevious: boolean;
      continuesNext: boolean;
    }
  | {
      kind: 'draft';
      id: string;
      source: 'mic' | 'system';
      timestampMs: number;
      part: LiveConversationPart;
    };

type OwnedRow = {
  row: LiveConversationRow;
  suppressedWordCount: number;
  signature: string;
};

const DRAFT_WORD_LIMIT = 24;
const MUTABLE_TAIL_MS = 45_000;
const MUTABLE_TAIL_ROW_LIMIT = 128;
const MUTABLE_TAIL_PART_LIMIT = 512;
const sourceRank = { mic: 0, system: 1 } as const;

type OrderedItem = Pick<LiveConversationRow, 'id' | 'source' | 'timestampMs'>;

const compareEventTime = (left: OrderedItem, right: OrderedItem): number =>
  left.timestampMs - right.timestampMs ||
  sourceRank[left.source] - sourceRank[right.source] ||
  left.id.localeCompare(right.id);

const compareSegmentsByEventTime = (
  left: LiveTranscriptSegment,
  right: LiveTranscriptSegment,
): number =>
  compareEventTime(
    {
      id: left.id,
      source: left.source as 'mic' | 'system',
      timestampMs: left.timestampMs,
    },
    {
      id: right.id,
      source: right.source as 'mic' | 'system',
      timestampMs: right.timestampMs,
    },
  );

const indexRanges = (reading: LiveTranscriptReading) => {
  const visible = new Map<string, LiveTranscriptReadingRange[]>();
  const suppressedWords = new Map<string, number>();
  for (const range of reading.ranges) {
    if (range.visibility === 'visible') {
      const ranges = visible.get(range.sourceSegmentId) ?? [];
      ranges.push(range);
      visible.set(range.sourceSegmentId, ranges);
      continue;
    }
    suppressedWords.set(
      range.sourceSegmentId,
      (suppressedWords.get(range.sourceSegmentId) ?? 0) +
        range.endWord -
        range.startWord,
    );
  }
  return { visible, suppressedWords };
};

const toPart = (range: LiveTranscriptReadingRange): LiveConversationPart => ({
  id: range.id,
  sourceSegmentId: range.sourceSegmentId,
  source: range.source,
  text: range.text,
  timestampMs: range.timestampMs,
  endTimestampMs: range.endTimestampMs,
});

const truncateDraft = (
  parts: LiveConversationPart[],
  limit: number,
): LiveConversationPart[] => {
  const wordsByPart = parts.map((part) => part.text.match(/\S+/gu) ?? []);
  const sources = [...new Set(parts.map((part) => part.source))];
  const selected = parts.map(() => 0);
  const reservedPerSource = Math.floor(limit / Math.max(1, sources.length));
  const selectedBySource = new Map<'mic' | 'system', number>();

  // Give each active source a share before using the rest chronologically. A
  // long first draft must not hide a later reply from the other participant.
  for (let index = 0; index < parts.length; index += 1) {
    const source = parts[index].source;
    const sourceRemaining =
      reservedPerSource - (selectedBySource.get(source) ?? 0);
    const count = Math.min(wordsByPart[index].length, sourceRemaining);
    selected[index] = count;
    selectedBySource.set(source, (selectedBySource.get(source) ?? 0) + count);
  }
  let remaining = limit - selected.reduce((total, count) => total + count, 0);
  for (let index = 0; index < parts.length && remaining > 0; index += 1) {
    const count = Math.min(
      wordsByPart[index].length - selected[index],
      remaining,
    );
    selected[index] += count;
    remaining -= count;
  }
  return parts.flatMap((part, index) =>
    selected[index]
      ? [
          {
            ...part,
            text: wordsByPart[index].slice(0, selected[index]).join(' '),
          },
        ]
      : [],
  );
};

export const buildLiveConversationTimeline = (
  rows: LiveConversationRow[],
  draftParts: LiveConversationPart[],
): LiveConversationTimelineItem[] => {
  const ordered: LiveConversationTimelineItem[] = [
    ...rows.flatMap((row) =>
      row.display === 'speech'
        ? [
            {
              kind: 'committed' as const,
              id: row.parts[0]?.id ?? row.id,
              source: row.source,
              timestampMs: row.timestampMs,
              row,
              continuesPrevious: false,
              continuesNext: false,
            },
          ]
        : [],
    ),
    ...draftParts.map((part) => ({
      kind: 'draft' as const,
      id: part.id,
      source: part.source,
      timestampMs: part.timestampMs,
      part,
    })),
  ].sort(compareEventTime);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const item = ordered[index];
    if (item.kind !== 'committed' || previous.kind !== 'committed') continue;
    const continues =
      previous.row.source === item.row.source &&
      item.row.timestampMs - previous.row.timestampMs <= 30_000 &&
      item.row.timestampMs -
        Math.min(
          previous.row.endTimestampMs,
          previous.row.timestampMs + 5_000,
        ) <=
        2_000;
    if (continues) {
      previous.continuesNext = true;
      item.continuesPrevious = true;
    }
  }
  return ordered;
};

const rowSignature = (row: LiveConversationRow): string =>
  JSON.stringify([
    row.sourceSegmentId,
    row.source,
    row.speaker,
    row.timestampMs,
    row.endTimestampMs,
    row.text,
    row.display,
    row.qualifier,
    row.parts,
  ]);

// Split the reading surface only; source row IDs on parts retain provenance.
const splitCommittedAtPauses = (
  segment: LiveTranscriptSegment,
  indexed: ReturnType<typeof indexRanges>,
): Array<LiveTranscriptSegment & { projectionSourceSegmentId: string }> => {
  const times = segment.wordTimings;
  const words = [...segment.text.matchAll(/\S+/gu)];
  if (!times || times.length !== words.length)
    return [{ ...segment, projectionSourceSegmentId: segment.id }];
  const original = [...(indexed.visible.get(segment.id) ?? [])].sort(
    (left, right) => left.startWord - right.startWord,
  );
  const starts = new Set([0]);
  for (let index = 1; index < times.length; index++) {
    if (times[index].timestampMs - times[index - 1].timestampMs > 2_000)
      starts.add(index);
  }
  for (let index = 1; index < original.length; index++) {
    if (original[index - 1].endWord < original[index].startWord) {
      starts.add(original[index].startWord);
    }
  }
  if (starts.size === 1)
    return [{ ...segment, projectionSourceSegmentId: segment.id }];
  const orderedStarts = [...starts].sort((left, right) => left - right);
  return orderedStarts.map((start, index) => {
    const end = orderedStarts[index + 1] ?? times.length;
    const id = `${segment.id}:speech-${start}`;
    const ranges = original.flatMap((range) => {
      const startWord = Math.max(start, range.startWord);
      const endWord = Math.min(end, range.endWord);
      if (startWord >= endWord) return [];
      const startCharacter = words[startWord].index!;
      const endCharacter =
        words[endWord - 1].index! + words[endWord - 1][0].length;
      return [
        {
          ...range,
          id: `${range.id}:speech-${start}`,
          startWord,
          endWord,
          startCharacter,
          endCharacter,
          text: segment.text.slice(startCharacter, endCharacter),
          timestampMs: times[startWord].timestampMs,
          endTimestampMs: times[endWord - 1].endTimestampMs,
        },
      ];
    });
    indexed.visible.set(id, ranges);
    indexed.suppressedWords.set(
      id,
      end -
        start -
        ranges.reduce((n, range) => n + range.endWord - range.startWord, 0),
    );
    return {
      ...segment,
      id,
      projectionSourceSegmentId: segment.id,
      timestampMs: times[start].timestampMs,
      endTimestampMs: times[end - 1].endTimestampMs,
    };
  });
};

export const createLiveConversationProjection = ({
  generation,
}: {
  generation: number;
}) => {
  if (!Number.isSafeInteger(generation) || generation <= 0)
    throw new Error('live_conversation_generation_invalid');

  const owned = new Map<string, OwnedRow>();
  const sealed = new Set<string>();
  const sourceWatermarks: Record<'mic' | 'system', number | null> = {
    mic: null,
    system: null,
  };
  const order: string[] = [];
  let committedRowsDirty = false;
  let snapshot: LiveConversationSnapshot = {
    generation,
    status: 'active',
    rows: [],
    draft: null,
    metrics: {
      corrections: 0,
      restorations: 0,
      lateArrivals: 0,
      degradedReconciliations: 0,
      draftWordCount: 0,
      lastProjectionDurationMs: 0,
      mutableRows: 0,
      retainedParts: 0,
      micWatermarkMs: null,
      systemWatermarkMs: null,
    },
  };

  const publish = (
    status: LiveConversationSnapshot['status'],
    draft: LiveConversationDraft | null,
    durationMs = 0,
  ) => {
    const rows = committedRowsDirty
      ? order.map((id) => owned.get(id)!.row)
      : snapshot.rows;
    committedRowsDirty = false;
    snapshot = {
      generation,
      status,
      rows,
      draft,
      metrics: {
        ...snapshot.metrics,
        draftWordCount: draft?.wordCount ?? 0,
        lastProjectionDurationMs: durationMs,
      },
    };
    return snapshot;
  };

  const insertInEventTimeOrder = (row: LiveConversationRow) => {
    let low = 0;
    let high = order.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const middleRow = owned.get(order[middle])!.row;
      if (compareEventTime(middleRow, row) <= 0) low = middle + 1;
      else high = middle;
    }
    order.splice(low, 0, row.id);
    committedRowsDirty = true;
  };

  const compactCommittedPrefix = () => {
    const watermarks = Object.values(sourceWatermarks).filter(
      (value): value is number => value !== null,
    );
    const safeWatermarkMs = watermarks.length
      ? Math.min(...watermarks)
      : Number.NEGATIVE_INFINITY;
    const timeCutoffMs = safeWatermarkMs - MUTABLE_TAIL_MS;
    const countCutoff = Math.max(0, order.length - MUTABLE_TAIL_ROW_LIMIT);
    const sealRow = (id: string) => {
      const current = owned.get(id)!;
      const compactedRow = current.row.parts.length
        ? { ...current.row, parts: [] }
        : current.row;
      owned.set(id, {
        ...current,
        row: compactedRow,
        signature: rowSignature(compactedRow),
      });
      sealed.add(id);
      committedRowsDirty = true;
    };
    for (let index = 0; index < order.length; index += 1) {
      const id = order[index];
      if (sealed.has(id)) continue;
      const current = owned.get(id)!;
      if (index >= countCutoff && current.row.timestampMs >= timeCutoffMs)
        continue;
      sealRow(id);
    }
    let retainedParts = order.reduce(
      (total, id) => total + owned.get(id)!.row.parts.length,
      0,
    );
    for (const id of order) {
      if (retainedParts <= MUTABLE_TAIL_PART_LIMIT) break;
      if (sealed.has(id)) continue;
      retainedParts -= owned.get(id)!.row.parts.length;
      sealRow(id);
    }
    snapshot.metrics.mutableRows = order.length - sealed.size;
    snapshot.metrics.retainedParts = retainedParts;
    snapshot.metrics.micWatermarkMs = sourceWatermarks.mic;
    snapshot.metrics.systemWatermarkMs = sourceWatermarks.system;
  };

  return {
    apply({
      generation: updateGeneration,
      reading,
      reason,
    }: {
      generation: number;
      reading: LiveTranscriptReading;
      reason: 'recognition' | 'echo_evidence';
    }): LiveConversationSnapshot {
      if (updateGeneration !== generation || snapshot.status === 'finished')
        return snapshot;
      snapshot = {
        ...snapshot,
        metrics: { ...snapshot.metrics },
      };
      const startedAt = performance.now();
      const rangesBySegment = indexRanges(reading);
      const committed = reading.segments
        .filter(
          (segment) =>
            segment.confirmed &&
            (segment.source === 'mic' || segment.source === 'system'),
        )
        .flatMap((segment) => splitCommittedAtPauses(segment, rangesBySegment));
      const projectedIds = new Set(committed.map((segment) => segment.id));
      const updatedSourceIds = new Set(
        committed.map((segment) => segment.projectionSourceSegmentId),
      );
      for (const [id, previous] of owned) {
        if (
          !updatedSourceIds.has(previous.row.sourceSegmentId) ||
          projectedIds.has(id) ||
          previous.row.display === 'duplicate_removed'
        )
          continue;
        const next: LiveConversationRow = {
          ...previous.row,
          text: '',
          parts: [],
          display: 'duplicate_removed',
          ...(reason === 'echo_evidence'
            ? { qualifier: 'updated' as const }
            : {}),
        };
        owned.set(id, {
          row: next,
          suppressedWordCount: previous.suppressedWordCount,
          signature: rowSignature(next),
        });
        committedRowsDirty = true;
      }
      const previousWatermarkMs = Math.max(
        sourceWatermarks.mic ?? Number.NEGATIVE_INFINITY,
        sourceWatermarks.system ?? Number.NEGATIVE_INFINITY,
      );
      for (const segment of committed) {
        const source = segment.source as 'mic' | 'system';
        sourceWatermarks[source] = Math.max(
          sourceWatermarks[source] ?? Number.NEGATIVE_INFINITY,
          segment.endTimestampMs ?? segment.timestampMs,
        );
      }

      // Unseen visible rows are inserted by event time. Mutable rows can be
      // corrected in place; sealed history remains a stable lightweight prefix.
      const newVisible: Array<
        LiveTranscriptSegment & { projectionSourceSegmentId: string }
      > = [];
      for (const segment of committed) {
        const previous = owned.get(segment.id);
        const ranges = rangesBySegment.visible.get(segment.id) ?? [];
        if (!previous) {
          if (ranges.length) newVisible.push(segment);
          continue;
        }
        const nextSuppressedWordCount =
          rangesBySegment.suppressedWords.get(segment.id) ?? 0;
        const projectedParts = ranges.map(toPart);
        const text = projectedParts.map((part) => part.text).join(' ');
        const parts = sealed.has(segment.id) ? [] : projectedParts;
        const next: LiveConversationRow = {
          ...previous.row,
          sourceSegmentId: segment.projectionSourceSegmentId,
          timestampMs: projectedParts[0]?.timestampMs ?? segment.timestampMs,
          endTimestampMs:
            projectedParts.at(-1)?.endTimestampMs ??
            segment.endTimestampMs ??
            segment.timestampMs,
          text,
          parts,
          display: projectedParts.length ? 'speech' : 'duplicate_removed',
          ...(reason === 'echo_evidence' &&
          (text !== previous.row.text ||
            nextSuppressedWordCount !== previous.suppressedWordCount)
            ? { qualifier: 'updated' as const }
            : {}),
        };
        const signature = rowSignature(next);
        if (signature !== previous.signature) {
          if (nextSuppressedWordCount > previous.suppressedWordCount)
            snapshot.metrics.corrections += 1;
          if (nextSuppressedWordCount < previous.suppressedWordCount)
            snapshot.metrics.restorations += 1;
          owned.set(segment.id, {
            row: next,
            suppressedWordCount: nextSuppressedWordCount,
            signature,
          });
          if (next.timestampMs !== previous.row.timestampMs) {
            order.splice(order.indexOf(segment.id), 1);
            insertInEventTimeOrder(next);
          }
          committedRowsDirty = true;
        }
      }

      newVisible.sort(compareSegmentsByEventTime);
      for (const segment of newVisible) {
        const parts = (rangesBySegment.visible.get(segment.id) ?? []).map(
          toPart,
        );
        const isLate = segment.timestampMs < previousWatermarkMs;
        const row: LiveConversationRow = {
          id: segment.id,
          sourceSegmentId: segment.projectionSourceSegmentId,
          source: segment.source as 'mic' | 'system',
          speaker: segment.speaker,
          timestampMs: parts[0]?.timestampMs ?? segment.timestampMs,
          endTimestampMs:
            parts.at(-1)?.endTimestampMs ??
            segment.endTimestampMs ??
            segment.timestampMs,
          text: parts.map((part) => part.text).join(' '),
          parts,
          display: 'speech',
        };
        if (isLate) snapshot.metrics.lateArrivals += 1;
        owned.set(segment.id, {
          row,
          suppressedWordCount:
            rangesBySegment.suppressedWords.get(segment.id) ?? 0,
          signature: rowSignature(row),
        });
        insertInEventTimeOrder(row);
      }

      compactCommittedPrefix();

      const tentative = reading.segments
        .filter(
          (segment) =>
            !segment.confirmed &&
            (segment.source === 'mic' || segment.source === 'system'),
        )
        .sort(compareSegmentsByEventTime);
      const draftParts = tentative.flatMap((segment) =>
        (rangesBySegment.visible.get(segment.id) ?? []).map(toPart),
      );
      const wordCount = draftParts.reduce(
        (total, part) => total + (part.text.match(/\S+/gu)?.length ?? 0),
        0,
      );
      const draft: LiveConversationDraft | null = draftParts.length
        ? {
            id: 'live-conversation-draft',
            parts: draftParts,
            collapsedParts: truncateDraft(draftParts, DRAFT_WORD_LIMIT),
            wordCount,
            truncated: wordCount > DRAFT_WORD_LIMIT,
          }
        : null;
      return publish(
        snapshot.status === 'degraded' ? 'degraded' : 'active',
        draft,
        performance.now() - startedAt,
      );
    },

    unavailable(updateGeneration: number): LiveConversationSnapshot {
      if (updateGeneration !== generation || snapshot.status === 'finished')
        return snapshot;
      return publish('unavailable', snapshot.draft);
    },

    recovering(
      updateGeneration: number,
      status: 'active' | 'catching_up' | 'reconnecting',
    ): LiveConversationSnapshot {
      if (updateGeneration !== generation || snapshot.status === 'finished')
        return snapshot;
      return publish(status, status === 'reconnecting' ? null : snapshot.draft);
    },

    degraded(updateGeneration: number): LiveConversationSnapshot {
      if (updateGeneration !== generation || snapshot.status === 'finished')
        return snapshot;
      snapshot = {
        ...snapshot,
        metrics: {
          ...snapshot.metrics,
          degradedReconciliations: snapshot.metrics.degradedReconciliations + 1,
        },
      };
      return publish('degraded', snapshot.draft);
    },

    finish(updateGeneration: number): LiveConversationSnapshot {
      if (updateGeneration !== generation) return snapshot;
      return publish('finished', null);
    },

    snapshot(): LiveConversationSnapshot {
      return snapshot;
    },
  };
};

export const liveConversationTranscriptSegments = (
  snapshot: LiveConversationSnapshot,
): LiveTranscriptSegment[] =>
  snapshot.rows.flatMap((row) =>
    row.display === 'speech' && row.text.trim()
      ? [
          {
            id: row.id,
            source: row.source,
            speaker: row.speaker,
            text: row.text,
            rawText: row.text,
            timestampMs: row.timestampMs,
            endTimestampMs: row.endTimestampMs,
            confirmed: true,
          },
        ]
      : [],
  );
