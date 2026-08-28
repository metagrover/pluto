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

  it('preserves an uncertain word substitution even when remote activity dominates', () => {
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

    expect(result.presentation).toBeUndefined();
  });

  it('suppresses a long ordered echo despite louder microphone activity', () => {
    const system = segment(
      'system',
      'system',
      'So when I open the report the download option is not active can you show what the icon says it says the administrator has disabled this feature',
      3_900,
      23_600,
    );
    const mic = segment(
      'mic',
      'mic',
      'So when I uh open the report the download option is not active can you show what the icon says it says the administrator has disabled this feature',
      4_140,
      23_580,
    );
    const result = reconcileLiveTranscriptSegments({
      segments: [system, mic],
      activityWindows: [{ startTime: 4, endTime: 24, speaker: 'Me' }],
    });
    expect(result[1].presentation?.visibility).toBe('suppressed_echo');
    expect(mic).not.toHaveProperty('presentation');
  });

  it('keeps a local correction that differs by one important word', () => {
    const system = segment(
      'system',
      'system',
      'We should deploy the release today because the migration is ready for production',
      1_000,
      6_000,
    );
    const mic = segment(
      'mic',
      'mic',
      'We should not deploy the release today because the migration is ready for production',
      1_100,
      6_100,
    );
    expect(
      reconcileLiveTranscriptSegments({
        segments: [system, mic],
        activityWindows: [{ startTime: 1, endTime: 7, speaker: 'Them' }],
      }),
    ).toEqual([system, mic]);
  });

  it('does not confuse the same vocabulary in a different order with echo', () => {
    const system = segment(
      'system',
      'system',
      'The release blocks the migration and the migration blocks the report',
      1_000,
      6_000,
    );
    const mic = segment(
      'mic',
      'mic',
      'The report blocks the migration and the migration blocks the release',
      1_100,
      6_100,
    );
    expect(
      reconcileLiveTranscriptSegments({
        segments: [system, mic],
        activityWindows: [{ startTime: 1, endTime: 7, speaker: 'Them' }],
      }),
    ).toEqual([system, mic]);
  });

  it('matches a mic echo split across adjacent system utterances', () => {
    const first = segment(
      'system-1',
      'system',
      'Please open the report and check the download menu',
      1_000,
      4_000,
    );
    const second = segment(
      'system-2',
      'system',
      'The administrator has disabled this feature for the current role',
      4_100,
      7_000,
    );
    const mic = segment(
      'mic',
      'mic',
      `${first.text} ${second.text}`,
      1_100,
      7_100,
    );
    const result = reconcileLiveTranscriptSegments({
      segments: [first, second, mic],
      activityWindows: [],
    });
    expect(result[2].presentation?.visibility).toBe('suppressed_echo');
  });

  it('restores a previously matched provisional echo when the remote text revises', () => {
    const text =
      'Please open the report and check the download menu before calling the administrator';
    const mic = segment('mic', 'mic', text, 1_100, 5_100);
    const system = {
      ...segment('system', 'system', text, 1_000, 5_000),
      confirmed: false,
    };
    const first = reconcileLiveTranscriptSegments({
      segments: [mic, system],
      activityWindows: [],
    });
    expect(first[0].presentation?.visibility).toBe('suppressed_echo');
    const revised = {
      ...system,
      text: 'A different sentence',
      rawText: 'a different sentence',
    };
    const next = reconcileLiveTranscriptSegments({
      segments: [first[0], revised],
      activityWindows: [],
    });
    expect(next[0].presentation).toBeUndefined();
  });

  it('retains a mixed mic segment containing echo plus a unique local interruption', () => {
    const text =
      'Please open the report and check the download menu before calling the administrator';
    const system = segment('system', 'system', text, 1_000, 8_000);
    const mic = segment(
      'mic',
      'mic',
      `${text} Wait I will share my screen instead`,
      1_100,
      8_100,
    );
    expect(
      reconcileLiveTranscriptSegments({
        segments: [mic, system],
        activityWindows: [{ startTime: 1, endTime: 9, speaker: 'Them' }],
      }),
    ).toEqual([mic, system]);
  });

  it.each([
    [
      'Keep the cost at $ 15 before the review so the team can finish today',
      'Keep the cost at € 15 before the review so the team can finish today',
    ],
    [
      'Keep the adjustment at - 15 percent before the review so the team can finish today',
      'Keep the adjustment at + 15 percent before the review so the team can finish today',
    ],
    [
      'Keep the error rate at .5 percent before the review so the team can finish today',
      'Keep the error rate at 5 percent before the review so the team can finish today',
    ],
    [
      'Keep the adjustment at −15 percent before the review so the team can finish today',
      'Keep the adjustment at 15 percent before the review so the team can finish today',
    ],
    [
      'Keep the cost at $15 before the review so the team can finish today',
      'Keep the cost at €15 before the review so the team can finish today',
    ],
    [
      'Keep the error rate at 1.5 percent before the review so the team can finish today',
      'Keep the error rate at 15 percent before the review so the team can finish today',
    ],
    [
      'Keep the adjustment at -15 percent before the review so the team can finish today',
      'Keep the adjustment at +15 percent before the review so the team can finish today',
    ],
    [
      'We will approve 15 reports before the review so the team can finish today',
      'We will approve 50 reports before the review so the team can finish today',
    ],
    [
      'We should deploy the release today because the migration is ready for production',
      'We should not deploy the release today because the migration is ready for production',
    ],
  ])(
    'retains contradictory numbers or remote negations',
    (micText, systemText) => {
      const mic = segment('mic', 'mic', micText, 1_100, 6_100);
      const system = segment('system', 'system', systemText, 1_000, 6_000);
      expect(
        reconcileLiveTranscriptSegments({
          segments: [mic, system],
          activityWindows: [],
        }),
      ).toEqual([mic, system]);
    },
  );

  it('keeps a later local repetition despite overlapping long segment timestamps', () => {
    const text =
      'Please open the report and check the download menu before calling the administrator';
    const system = segment('system', 'system', text, 1_000, 10_000);
    const mic = segment('mic', 'mic', text, 4_000, 13_000);
    expect(
      reconcileLiveTranscriptSegments({
        segments: [mic, system],
        activityWindows: [],
      }),
    ).toEqual([mic, system]);
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
