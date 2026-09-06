import { describe, expect, it } from 'vitest';
import type { LiveTranscriptSegment } from '../../src/components/features/recordingWorkspaceModel';
import type {
  LiveTranscriptReading,
  LiveTranscriptReadingRange,
} from '../../src/services/liveTranscription/liveTranscriptReconciliation';
import { createLiveConversationProjection } from '../../src/services/liveTranscription/liveConversationProjection';

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
  it('allocates committed order once and appends older arrivals as earlier speech', () => {
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
      'system-newer',
      'mic-older',
    ]);
    expect(second.rows[1].qualifier).toBe('earlier_speech');
    expect(second.rows[0]).toBe(first.rows[0]);
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
      'mic-1',
      'system-1',
    ]);
    expect(corrected.rows[0]).toMatchObject({
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
    ).toEqual(['system-1', 'mic-1']);
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
});
