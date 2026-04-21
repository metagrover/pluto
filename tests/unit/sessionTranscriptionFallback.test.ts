import { describe, expect, it } from 'vitest';

import { getSessionFallbackDecision } from '../../src/utils/sessionTranscriptionFallback';

describe('sessionTranscriptionFallback', () => {
  it('skips session fallback when chunk transcript looks healthy', () => {
    const decision = getSessionFallbackDecision({
      meetingDurationSeconds: 900,
      totalSpeakerWindowSeconds: 420,
      segmentCount: 68,
      meSegmentCount: 31,
      themSegmentCount: 37,
      totalWords: 1850,
      micChunkConversionFailures: 0,
      micTranscriptionDisabled: false,
      systemChunkDecodeDropCount: 0,
    });

    expect(decision.shouldRun).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  it('requests session fallback when chunk transcription produced no segments', () => {
    const decision = getSessionFallbackDecision({
      meetingDurationSeconds: 300,
      totalSpeakerWindowSeconds: 140,
      segmentCount: 0,
      meSegmentCount: 0,
      themSegmentCount: 0,
      totalWords: 0,
      micChunkConversionFailures: 0,
      micTranscriptionDisabled: false,
      systemChunkDecodeDropCount: 0,
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.reasons).toContain('no_chunk_segments');
  });

  it('requests session fallback when a longer meeting is missing one speaker', () => {
    const decision = getSessionFallbackDecision({
      meetingDurationSeconds: 1500,
      totalSpeakerWindowSeconds: 500,
      segmentCount: 24,
      meSegmentCount: 24,
      themSegmentCount: 0,
      totalWords: 720,
      micChunkConversionFailures: 0,
      micTranscriptionDisabled: false,
      systemChunkDecodeDropCount: 18,
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.reasons).toContain('missing_speaker');
    expect(decision.reasons).toContain('system_channel_degraded');
  });

  it('requests session fallback when chunk output is implausibly sparse for active speech', () => {
    const decision = getSessionFallbackDecision({
      meetingDurationSeconds: 600,
      totalSpeakerWindowSeconds: 220,
      segmentCount: 5,
      meSegmentCount: 3,
      themSegmentCount: 2,
      totalWords: 45,
      micChunkConversionFailures: 0,
      micTranscriptionDisabled: false,
      systemChunkDecodeDropCount: 0,
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.reasons).toContain('low_words_per_active_minute');
  });

  it('requests session fallback after repeated mic chunk conversion failures', () => {
    const decision = getSessionFallbackDecision({
      meetingDurationSeconds: 180,
      totalSpeakerWindowSeconds: 70,
      segmentCount: 12,
      meSegmentCount: 6,
      themSegmentCount: 6,
      totalWords: 180,
      micChunkConversionFailures: 2,
      micTranscriptionDisabled: true,
      systemChunkDecodeDropCount: 0,
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.reasons).toContain('mic_chunk_failures');
  });
});
