import { describe, expect, it } from 'vitest';

import { reconcileLiveTranscriptSegments } from '../../src/services/liveTranscription/liveTranscriptReconciliation';

const segment = (
  id: string,
  source: 'mic' | 'system',
  text: string,
  startMs: number,
  endMs: number,
) => ({
  id,
  speaker: 'Speaker' as const,
  source,
  text,
  rawText: text.toLowerCase(),
  timestampMs: startMs,
  endTimestampMs: endMs,
  confirmed: true,
});

describe('live transcript reconciliation', () => {
  it('presentation-suppresses a strongly aligned microphone echo without deleting it', () => {
    const mic = segment(
      'mic-1',
      'mic',
      'Please request Docker from the software portal.',
      1_100,
      3_100,
    );
    const system = segment(
      'system-1',
      'system',
      'Please request Docker from the software portal.',
      1_000,
      3_000,
    );

    const result = reconcileLiveTranscriptSegments({
      segments: [mic, system],
      activityWindows: [{ startTime: 1, endTime: 3.2, speaker: 'Them' }],
    });

    expect(result).toHaveLength(2);
    expect(result[0]).not.toBe(mic);
    expect(result[0].presentation).toEqual({
      visibility: 'suppressed_echo',
      matchedSegmentId: 'system-1',
      confidence: 1,
      reason: 'cross_channel_echo',
    });
    expect(mic).not.toHaveProperty('presentation');
  });

  it('preserves similar overlapping speech when microphone activity is locally dominant', () => {
    const mic = segment(
      'mic-1',
      'mic',
      'I think we should request Docker today.',
      1_000,
      2_500,
    );
    const system = segment(
      'system-1',
      'system',
      'I think we should request Docker today.',
      1_050,
      2_550,
    );

    const result = reconcileLiveTranscriptSegments({
      segments: [mic, system],
      activityWindows: [{ startTime: 1, endTime: 2.6, speaker: 'Me' }],
    });

    expect(result).toEqual([mic, system]);
  });

  it('suppresses a long fuzzy echo when remote activity dominates', () => {
    const mic = segment(
      'mic-1',
      'mic',
      'Please request Docker from the internal software portal today.',
      1_100,
      3_100,
    );
    const system = segment(
      'system-1',
      'system',
      'Please request Docker through the internal software portal today.',
      1_000,
      3_000,
    );

    const [result] = reconcileLiveTranscriptSegments({
      segments: [mic, system],
      activityWindows: [{ startTime: 1, endTime: 3.2, speaker: 'Them' }],
    });

    expect(result.presentation?.visibility).toBe('suppressed_echo');
  });

  it('preserves short and uncertain repeated phrases', () => {
    const mic = segment('mic-1', 'mic', 'Sounds good.', 1_000, 1_500);
    const system = segment('system-1', 'system', 'Sounds good.', 1_000, 1_500);

    expect(
      reconcileLiveTranscriptSegments({
        segments: [mic, system],
        activityWindows: [{ startTime: 1, endTime: 1.5, speaker: 'Them' }],
      }),
    ).toEqual([mic, system]);
  });
});
