import { describe, expect, it } from 'vitest';
import {
  evaluateLiveTranscriptCoverage,
  reconcileCanonicalTranscript,
  validateTranscriptIntegrity,
} from '../../src/utils/transcriptIntegrity';

const segment = (
  speaker: 'Me' | 'Them' | 'Unknown',
  startTime: number,
  endTime: number,
  text: string,
) => ({ id: `${speaker}-${startTime}`, speaker, startTime, endTime, text });

describe('transcriptIntegrity', () => {
  it('marks live local transcription as lagging when mic activity is unexplained', () => {
    expect(
      evaluateLiveTranscriptCoverage({
        micActivitySeconds: 18,
        localTranscriptSeconds: 0.4,
        conversionFailed: false,
        priorRetries: 0,
      }),
    ).toEqual({
      state: 'lagging',
      shouldRetry: true,
      reason: 'local_transcript_coverage_low',
    });
  });

  it('does not treat two trivial acknowledgements as complete local coverage', () => {
    const result = validateTranscriptIntegrity({
      recordingDurationSeconds: 1_500,
      micAudioDurationSeconds: 1_500,
      systemAudioDurationSeconds: 1_500,
      micActivitySeconds: 140,
      systemActivitySeconds: 900,
      localTranscriptCoveredSeconds: 1,
      remoteTranscriptCoveredSeconds: 850,
      unresolvedAmbiguousSeconds: 0,
      requiredSourcesSucceeded: true,
    });

    expect(result.status).toBe('needs_attention');
    expect(result.reasons).toContain('local_speech_unaccounted');
  });

  it('preserves mic-only canonical speech missing from provisional chunks', () => {
    const result = reconcileCanonicalTranscript({
      mixedSegments: [segment('Unknown', 10, 16, 'Synthetic local proposal')],
      micSegments: [segment('Me', 10, 16, 'Synthetic local proposal')],
      systemSegments: [],
      provisionalSegments: [],
      activityWindows: [{ speaker: 'Me' as const, startTime: 10, endTime: 16 }],
    });

    expect(result.segments).toEqual([
      expect.objectContaining({
        speaker: 'Me',
        text: 'Synthetic local proposal',
      }),
    ]);
  });

  it('collapses synthetic remote pass-through instead of duplicating Me', () => {
    const result = reconcileCanonicalTranscript({
      mixedSegments: [segment('Unknown', 20, 25, 'Synthetic remote update')],
      micSegments: [segment('Me', 20.1, 25.1, 'Synthetic remote update')],
      systemSegments: [segment('Them', 20, 25, 'Synthetic remote update')],
      provisionalSegments: [],
      activityWindows: [
        { speaker: 'Them' as const, startTime: 20, endTime: 25 },
      ],
    });

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].speaker).toBe('Them');
    expect(result.evidence.collapsedPassThroughSeconds).toBeGreaterThan(0);
  });

  it('prefers the system channel when exact pass-through evidence ties', () => {
    const result = reconcileCanonicalTranscript({
      mixedSegments: [segment('Unknown', 20, 25, 'Synthetic remote update')],
      micSegments: [segment('Me', 20, 25, 'Synthetic remote update')],
      systemSegments: [segment('Them', 20, 25, 'Synthetic remote update')],
      provisionalSegments: [],
      activityWindows: [{ speaker: 'Them', startTime: 20, endTime: 25 }],
    });

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].speaker).toBe('Them');
  });

  it('keeps distinct local speech that overlaps a longer remote segment', () => {
    const result = reconcileCanonicalTranscript({
      mixedSegments: [segment('Unknown', 10, 20, 'Synthetic remote response')],
      micSegments: [segment('Me', 12, 15, 'Synthetic distinct local question')],
      systemSegments: [segment('Them', 10, 20, 'Synthetic remote response')],
      provisionalSegments: [],
      activityWindows: [
        { speaker: 'Them', startTime: 10, endTime: 12 },
        { speaker: 'Me', startTime: 12, endTime: 15 },
        { speaker: 'Them', startTime: 15, endTime: 20 },
      ],
    });

    expect(result.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Synthetic distinct local question' }),
      ]),
    );
  });

  it('validates healthy synthetic two-channel coverage', () => {
    expect(
      validateTranscriptIntegrity({
        recordingDurationSeconds: 60,
        micAudioDurationSeconds: 60,
        systemAudioDurationSeconds: 60,
        micActivitySeconds: 20,
        systemActivitySeconds: 30,
        localTranscriptCoveredSeconds: 18,
        remoteTranscriptCoveredSeconds: 28,
        unresolvedAmbiguousSeconds: 0,
        requiredSourcesSucceeded: true,
      }),
    ).toEqual({ status: 'validated', reasons: [] });
  });
});
