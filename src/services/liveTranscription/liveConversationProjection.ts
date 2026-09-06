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
  source: 'mic' | 'system';
  speaker: LiveTranscriptSegment['speaker'];
  timestampMs: number;
  endTimestampMs: number;
  text: string;
  parts: LiveConversationPart[];
  display: 'speech' | 'duplicate_removed';
  qualifier?: 'updated' | 'earlier_speech';
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
};

export type LiveConversationSnapshot = {
  generation: number;
  status: 'active' | 'unavailable' | 'finished' | 'degraded';
  rows: LiveConversationRow[];
  draft: LiveConversationDraft | null;
  metrics: LiveConversationMetrics;
};

type OwnedRow = {
  row: LiveConversationRow;
  suppressedWordCount: number;
  signature: string;
};

const DRAFT_WORD_LIMIT = 24;
const sourceRank = { mic: 0, system: 1 } as const;

const visibleRanges = (
  reading: LiveTranscriptReading,
  segmentId: string,
): LiveTranscriptReadingRange[] =>
  reading.ranges.filter(
    (range) =>
      range.sourceSegmentId === segmentId && range.visibility === 'visible',
  );

const suppressedWordCount = (
  reading: LiveTranscriptReading,
  segmentId: string,
): number =>
  reading.ranges
    .filter(
      (range) =>
        range.sourceSegmentId === segmentId &&
        range.visibility === 'suppressed_echo',
    )
    .reduce((total, range) => total + range.endWord - range.startWord, 0);

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
  let remaining = limit;
  const collapsed: LiveConversationPart[] = [];
  for (const part of parts) {
    if (remaining <= 0) break;
    const words = part.text.match(/\S+/gu) ?? [];
    if (!words.length) continue;
    const text = words.slice(0, remaining).join(' ');
    collapsed.push({ ...part, id: `${part.id}:collapsed`, text });
    remaining -= Math.min(words.length, remaining);
  }
  return collapsed;
};

const rowSignature = (row: LiveConversationRow): string =>
  JSON.stringify([
    row.source,
    row.speaker,
    row.timestampMs,
    row.endTimestampMs,
    row.text,
    row.display,
    row.qualifier,
    row.parts,
  ]);

export const createLiveConversationProjection = ({
  generation,
}: {
  generation: number;
}) => {
  if (!Number.isSafeInteger(generation) || generation <= 0)
    throw new Error('live_conversation_generation_invalid');

  const owned = new Map<string, OwnedRow>();
  let order: string[] = [];
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
    },
  };

  const publish = (
    status: LiveConversationSnapshot['status'],
    draft: LiveConversationDraft | null,
    durationMs = 0,
  ) => {
    const projectedRows = order.map((id) => owned.get(id)!.row);
    const rows =
      projectedRows.length === snapshot.rows.length &&
      projectedRows.every((row, index) => row === snapshot.rows[index])
        ? snapshot.rows
        : projectedRows;
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
      const committed = reading.segments.filter(
        (segment) =>
          segment.confirmed &&
          (segment.source === 'mic' || segment.source === 'system'),
      );

      // unseen -> append once; visible -> correct in place; hidden -> wait
      // corrected hidden -> keep shell; restored hidden -> append as late speech
      const newVisible: LiveTranscriptSegment[] = [];
      for (const segment of committed) {
        const ranges = visibleRanges(reading, segment.id);
        const previous = owned.get(segment.id);
        if (!previous) {
          if (ranges.length) newVisible.push(segment);
          continue;
        }
        const nextSuppressedWordCount = suppressedWordCount(
          reading,
          segment.id,
        );
        const parts = ranges.map(toPart);
        const text = parts.map((part) => part.text).join(' ');
        const next: LiveConversationRow = {
          ...previous.row,
          endTimestampMs: segment.endTimestampMs ?? segment.timestampMs,
          text,
          parts,
          display: parts.length ? 'speech' : 'duplicate_removed',
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
        }
      }

      newVisible.sort(
        (left, right) =>
          left.timestampMs - right.timestampMs ||
          sourceRank[left.source as 'mic' | 'system'] -
            sourceRank[right.source as 'mic' | 'system'] ||
          left.id.localeCompare(right.id),
      );
      for (const segment of newVisible) {
        const parts = visibleRanges(reading, segment.id).map(toPart);
        const last = order.length ? owned.get(order.at(-1)!)?.row : undefined;
        const isLate = Boolean(last && segment.timestampMs < last.timestampMs);
        const row: LiveConversationRow = {
          id: segment.id,
          source: segment.source as 'mic' | 'system',
          speaker: segment.speaker,
          timestampMs: segment.timestampMs,
          endTimestampMs: segment.endTimestampMs ?? segment.timestampMs,
          text: parts.map((part) => part.text).join(' '),
          parts,
          display: 'speech',
          ...(isLate ? { qualifier: 'earlier_speech' as const } : {}),
        };
        if (isLate) snapshot.metrics.lateArrivals += 1;
        owned.set(segment.id, {
          row,
          suppressedWordCount: suppressedWordCount(reading, segment.id),
          signature: rowSignature(row),
        });
        order = [...order, segment.id];
      }

      const tentative = reading.segments
        .filter(
          (segment) =>
            !segment.confirmed &&
            (segment.source === 'mic' || segment.source === 'system'),
        )
        .sort(
          (left, right) =>
            left.timestampMs - right.timestampMs ||
            sourceRank[left.source as 'mic' | 'system'] -
              sourceRank[right.source as 'mic' | 'system'] ||
            left.id.localeCompare(right.id),
        );
      const draftParts = tentative.flatMap((segment) =>
        visibleRanges(reading, segment.id).map(toPart),
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
