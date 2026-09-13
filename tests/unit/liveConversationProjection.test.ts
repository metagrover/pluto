import { describe, expect, it } from 'vitest';
import type { LiveTranscriptSegment } from '../../src/components/features/recordingWorkspaceModel';
import {
  createLiveConversationProjection,
  liveConversationTranscriptSegments,
} from '../../src/services/liveTranscription/liveConversationProjection';
import type {
  LiveTranscriptReading,
  LiveTranscriptReadingRange,
} from '../../src/services/liveTranscription/liveTranscriptReconciliation';

const row = (
  id: string,
  source: 'mic' | 'system',
  text: string,
  timestampMs: number,
  confirmed = true,
): LiveTranscriptSegment => ({
  id,
  source,
  speaker: source === 'mic' ? 'Me' : 'Them',
  text,
  rawText: text,
  timestampMs,
  endTimestampMs: timestampMs + 1_000,
  confirmed,
});

const reading = (
  segments: LiveTranscriptSegment[],
  suppressed: Record<string, Array<[number, number]>> = {},
): LiveTranscriptReading => {
  const ranges: LiveTranscriptReadingRange[] = [];
  for (const segment of segments) {
    const words = segment.text.split(/\s+/u);
    const boundaries = (suppressed[segment.id] ?? []).flat();
    const points = [...new Set([0, ...boundaries, words.length])].sort(
      (left, right) => left - right,
    );
    for (let index = 0; index < points.length - 1; index += 1) {
      const startWord = points[index];
      const endWord = points[index + 1];
      const hidden = (suppressed[segment.id] ?? []).some(
        ([start, end]) => start <= startWord && endWord <= end,
      );
      const text = words.slice(startWord, endWord).join(' ');
      const startCharacter = segment.text.indexOf(text);
      ranges.push({
        id: `${segment.id}:${startWord}:${endWord}:${hidden}`,
        sourceSegmentId: segment.id,
        source: segment.source!,
        startWord,
        endWord,
        startCharacter,
        endCharacter: startCharacter + text.length,
        text,
        timestampMs: segment.timestampMs + startWord * 100,
        endTimestampMs: segment.timestampMs + endWord * 100,
        visibility: hidden ? 'suppressed_echo' : 'visible',
        supportingSegmentIds: hidden ? ['system-proof'] : [],
        ...(hidden ? { confidence: 1 } : {}),
      });
    }
  }
  return { segments, ranges };
};

describe('live conversation projection', () => {
  it('inserts delayed committed speech at its event-time position', () => {
    const projection = createLiveConversationProjection({ generation: 4 });
    const newer = row('system-newer', 'system', 'newer remote words', 20_000);
    const first = projection.apply({
      generation: 4,
      reading: reading([newer]),
      reason: 'recognition',
    });
    const older = row('mic-older', 'mic', 'older local words', 10_000);
    const second = projection.apply({
      generation: 4,
      reading: reading([older, newer]),
      reason: 'recognition',
    });
    expect(second.rows.map((item) => item.id)).toEqual([
      'mic-older',
      'system-newer',
    ]);
    expect(second.rows[0].qualifier).toBeUndefined();
    expect(second.rows[1]).toBe(first.rows[0]);
    expect(second.metrics.lateArrivals).toBe(1);
  });

  it('orders a retained local reply by its own time after removing an echo prefix', () => {
    const projection = createLiveConversationProjection({ generation: 1 });
    const mic = row('mic', 'mic', 'remote phrase local reply', 1_000);
    const system = row('system', 'system', 'remote phrase', 1_100);
    projection.apply({
      generation: 1,
      reading: reading([mic, system]),
      reason: 'recognition',
    });
    const corrected = projection.apply({
      generation: 1,
      reading: reading([mic, system], { mic: [[0, 2]] }),
      reason: 'echo_evidence',
    });
    expect(corrected.rows.map(({ id }) => id)).toEqual(['system', 'mic']);
    expect(corrected.rows[1]).toMatchObject({
      timestampMs: 1_200,
      text: 'local reply',
    });
    const restored = projection.apply({
      generation: 1,
      reading: reading([mic, system]),
      reason: 'echo_evidence',
    });
    expect(restored.rows.map(({ id }) => id)).toEqual(['mic', 'system']);
    expect(restored.rows[0].timestampMs).toBe(1_000);
  });

  it('places a sentence after silence at its own time while preserving raw row provenance', () => {
    const projection = createLiveConversationProjection({ generation: 1 });
    const remote = {
      ...row('remote', 'system', 'that next topic', 2_000),
      wordTimings: [
        { text: 'that', timestampMs: 2_000, endTimestampMs: 30_000 },
        { text: 'next', timestampMs: 30_000, endTimestampMs: 30_300 },
        { text: 'topic', timestampMs: 30_300, endTimestampMs: 31_000 },
      ],
    };
    const local = row('local', 'mic', 'my reply', 10_000);
    const raw = reading([remote, local]);
    const snapshot = projection.apply({
      generation: 1,
      reading: raw,
      reason: 'recognition',
    });
    expect(snapshot.rows.map(({ timestampMs }) => timestampMs)).toEqual([
      2_000, 10_000, 30_000,
    ]);
    expect(snapshot.rows.map(({ text }) => text)).toEqual([
      'that',
      'my reply',
      'next topic',
    ]);
    expect(snapshot.rows[2].parts[0].sourceSegmentId).toBe('remote');
    expect(raw.segments).toEqual([remote, local]);
  });

  it('orders speech retained on both sides of removed echo around an intervening reply', () => {
    const projection = createLiveConversationProjection({ generation: 1 });
    const mic = {
      ...row('mic', 'mic', 'before echoed after', 1_000),
      endTimestampMs: 3_500,
      wordTimings: [
        { text: 'before', timestampMs: 1_000, endTimestampMs: 1_500 },
        { text: 'echoed', timestampMs: 2_000, endTimestampMs: 2_500 },
        { text: 'after', timestampMs: 3_000, endTimestampMs: 3_500 },
      ],
    };
    const reply = row('reply', 'system', 'intervening reply', 2_000);

    const snapshot = projection.apply({
      generation: 1,
      reading: reading([mic, reply], { mic: [[1, 2]] }),
      reason: 'echo_evidence',
    });

    expect(snapshot.rows.map(({ text }) => text)).toEqual([
      'before',
      'intervening reply',
      'after',
    ]);
    expect(snapshot.rows.map(({ timestampMs }) => timestampMs)).toEqual([
      1_000, 2_000, 3_000,
    ]);
    expect(snapshot.rows[0].parts[0].sourceSegmentId).toBe('mic');
    expect(snapshot.rows[2].parts[0].sourceSegmentId).toBe('mic');
  });

  it('produces the same event-time order for every callback permutation', () => {
    const segments = [
      row('system-later', 'system', 'remote later', 20_000),
      row('mic-first', 'mic', 'local first', 10_000),
      row('system-same-time', 'system', 'remote overlap', 10_000),
    ];
    const applyOrder = (order: LiveTranscriptSegment[]) => {
      const projection = createLiveConversationProjection({ generation: 1 });
      const seen: LiveTranscriptSegment[] = [];
      for (const segment of order) {
        seen.push(segment);
        projection.apply({
          generation: 1,
          reading: reading([...seen].reverse()),
          reason: 'recognition',
        });
      }
      return projection.snapshot().rows.map((item) => item.id);
    };

    expect(applyOrder(segments)).toEqual([
      'mic-first',
      'system-same-time',
      'system-later',
    ]);
    expect(applyOrder([...segments].reverse())).toEqual([
      'mic-first',
      'system-same-time',
      'system-later',
    ]);
  });

  it('corrects and restores an owned row in the same keyed shell', () => {
    const projection = createLiveConversationProjection({ generation: 1 });
    const mic = row('mic-1', 'mic', 'remote phrase local answer', 1_000);
    const system = row('system-1', 'system', 'remote phrase', 1_000);
    const initial = projection.apply({
      generation: 1,
      reading: reading([mic, system]),
      reason: 'recognition',
    });
    const corrected = projection.apply({
      generation: 1,
      reading: reading([mic, system], { 'mic-1': [[0, 2]] }),
      reason: 'echo_evidence',
    });
    expect(corrected.rows.map((item) => item.id)).toEqual([
      'system-1',
      'mic-1',
    ]);
    expect(corrected.rows[1]).toMatchObject({
      id: 'mic-1',
      text: 'local answer',
      qualifier: 'updated',
    });
    const restored = projection.apply({
      generation: 1,
      reading: reading([mic, system]),
      reason: 'echo_evidence',
    });
    expect(restored.rows[0]).toMatchObject({
      id: 'mic-1',
      text: mic.text,
      qualifier: 'updated',
    });
    expect(restored.metrics.corrections).toBe(1);
    expect(restored.metrics.restorations).toBe(1);
    expect(initial.rows[0].id).toBe(restored.rows[0].id);
  });

  it('keeps a displayed fully suppressed row as a duplicate-removed shell', () => {
    const projection = createLiveConversationProjection({ generation: 1 });
    const mic = row('mic-1', 'mic', 'duplicated remote speech', 1_000);
    projection.apply({
      generation: 1,
      reading: reading([mic]),
      reason: 'recognition',
    });
    const corrected = projection.apply({
      generation: 1,
      reading: reading([mic], { 'mic-1': [[0, 3]] }),
      reason: 'echo_evidence',
    });
    expect(corrected.rows).toMatchObject([
      {
        id: 'mic-1',
        text: '',
        display: 'duplicate_removed',
        qualifier: 'updated',
      },
    ]);
  });

  it('does not allocate a hidden row until restoration makes it visible', () => {
    const projection = createLiveConversationProjection({ generation: 1 });
    const system = row('system-1', 'system', 'remote words', 2_000);
    const mic = row('mic-1', 'mic', 'remote words', 2_000);
    expect(
      projection
        .apply({
          generation: 1,
          reading: reading([mic, system], { 'mic-1': [[0, 2]] }),
          reason: 'recognition',
        })
        .rows.map((item) => item.id),
    ).toEqual(['system-1']);
    expect(
      projection
        .apply({
          generation: 1,
          reading: reading([mic, system]),
          reason: 'echo_evidence',
        })
        .rows.map((item) => item.id),
    ).toEqual(['mic-1', 'system-1']);
  });

  it('keeps both tentative sources in one bounded expandable draft', () => {
    const projection = createLiveConversationProjection({ generation: 1 });
    const mic = row(
      'mic-draft',
      'mic',
      Array.from({ length: 18 }, (_, index) => `mic${index}`).join(' '),
      1_000,
      false,
    );
    const system = row(
      'system-draft',
      'system',
      Array.from({ length: 18 }, (_, index) => `call${index}`).join(' '),
      1_100,
      false,
    );
    const snapshot = projection.apply({
      generation: 1,
      reading: reading([mic, system]),
      reason: 'recognition',
    });
    expect(snapshot.draft?.parts.map((part) => part.source)).toEqual([
      'mic',
      'system',
    ]);
    expect(snapshot.draft?.wordCount).toBe(36);
    expect(
      snapshot.draft?.collapsedParts.reduce(
        (total, part) => total + part.text.split(/\s+/u).length,
        0,
      ),
    ).toBe(24);
    expect(snapshot.draft?.truncated).toBe(true);
  });

  it('reserves collapsed draft space for every active source', () => {
    const projection = createLiveConversationProjection({ generation: 1 });
    const snapshot = projection.apply({
      generation: 1,
      reading: reading([
        row(
          'long-mic-draft',
          'mic',
          Array.from({ length: 40 }, (_, index) => `mic${index}`).join(' '),
          1_000,
          false,
        ),
        row('short-system-draft', 'system', 'remote reply', 1_100, false),
      ]),
      reason: 'recognition',
    });

    expect(snapshot.draft?.collapsedParts.map((part) => part.source)).toEqual([
      'mic',
      'system',
    ]);
    expect(
      snapshot.draft?.collapsedParts.find((part) => part.source === 'system')
        ?.text,
    ).toBe('remote reply');
    expect(
      snapshot.draft?.collapsedParts.reduce(
        (total, part) => total + part.text.split(/\s+/u).length,
        0,
      ),
    ).toBe(24);
  });

  it('fences stale generations and retains history when live recognition becomes unavailable', () => {
    const projection = createLiveConversationProjection({ generation: 2 });
    const committed = row('committed', 'mic', 'keep this history', 1_000);
    const accepted = projection.apply({
      generation: 2,
      reading: reading([committed]),
      reason: 'recognition',
    });
    expect(
      projection.apply({
        generation: 1,
        reading: reading([row('stale', 'mic', 'ignore me', 2_000)]),
        reason: 'recognition',
      }),
    ).toBe(accepted);
    const unavailable = projection.unavailable(2);
    expect(unavailable.rows).toBe(accepted.rows);
    expect(unavailable.status).toBe('unavailable');
    expect(projection.finish(2).draft).toBeNull();
  });

  it('keeps detailed correction evidence bounded to the mutable tail', () => {
    const projection = createLiveConversationProjection({ generation: 1 });
    const segments = Array.from({ length: 180 }, (_, index) =>
      row(
        `row-${index}`,
        index % 2 ? 'system' : 'mic',
        `words ${index}`,
        index * 1_000,
      ),
    );
    const snapshot = projection.apply({
      generation: 1,
      reading: reading(segments),
      reason: 'recognition',
    });

    expect(snapshot.rows).toHaveLength(180);
    expect(snapshot.metrics.mutableRows).toBeLessThanOrEqual(128);
    expect(snapshot.metrics.retainedParts).toBeLessThanOrEqual(128);
    expect(snapshot.rows[0].parts).toEqual([]);
    expect(snapshot.rows.at(-1)?.parts).not.toEqual([]);
  });

  it('applies supported echo correction after a row has been compacted', () => {
    const projection = createLiveConversationProjection({ generation: 1 });
    const segments = Array.from({ length: 180 }, (_, index) =>
      row(
        `row-${index}`,
        index % 2 ? 'system' : 'mic',
        `words ${index}`,
        index * 1_000,
      ),
    );
    projection.apply({
      generation: 1,
      reading: reading(segments),
      reason: 'recognition',
    });

    const corrected = projection.apply({
      generation: 1,
      reading: reading(segments, { 'row-0': [[0, 2]] }),
      reason: 'echo_evidence',
    });

    expect(corrected.rows[0]).toMatchObject({
      id: 'row-0',
      text: '',
      parts: [],
      display: 'duplicate_removed',
      qualifier: 'updated',
    });
    expect(corrected.metrics.retainedParts).toBeLessThanOrEqual(128);
  });

  it('projects the same ordered visible history for active Ask Pluto', () => {
    const projection = createLiveConversationProjection({ generation: 1 });
    const newer = row('system-newer', 'system', 'newer remote words', 20_000);
    projection.apply({
      generation: 1,
      reading: reading([newer]),
      reason: 'recognition',
    });
    const older = row('mic-older', 'mic', 'older local words', 10_000);
    const snapshot = projection.apply({
      generation: 1,
      reading: reading([newer, older]),
      reason: 'recognition',
    });

    expect(
      liveConversationTranscriptSegments(snapshot).map((segment) => segment.id),
    ).toEqual(['mic-older', 'system-newer']);
  });
});
