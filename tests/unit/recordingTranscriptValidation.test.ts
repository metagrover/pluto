import { describe, expect, it, vi } from 'vitest';
import { runRecordingTranscriptValidation } from '../../src/services/recordingTranscriptValidation';

const rawSegment = (start: number, end: number, text: string) => ({
  start,
  end,
  text,
});

describe('runRecordingTranscriptValidation', () => {
  it('validates verified checkpoint segments without full-session transcription', async () => {
    const transcribe = vi.fn();
    const probeDuration = vi.fn();

    const result = await runRecordingTranscriptValidation({
      meetingId: 'checkpointed-meeting',
      recordingDurationSeconds: 60,
      micAudioPath: '/synthetic/mic.wav',
      mixAudioPath: '',
      systemAudioPath: '/synthetic/system.wav',
      provisionalSegments: [
        {
          id: 'mic-0',
          startTime: 0,
          endTime: 4,
          text: 'Synthetic local statement',
          speaker: 'Me',
        },
        {
          id: 'system-0',
          startTime: 5,
          endTime: 9,
          text: 'Synthetic remote statement',
          speaker: 'Them',
        },
      ],
      activityWindows: [
        { speaker: 'Me', startTime: 0, endTime: 4 },
        { speaker: 'Them', startTime: 5, endTime: 9 },
      ],
      canonicalMode: 'checkpointed',
      checkpointEvidenceVerified: true,
      transcribe,
      probeDuration,
    });

    expect(transcribe).not.toHaveBeenCalled();
    expect(probeDuration).not.toHaveBeenCalled();
    expect(result.status).toBe('validated');
    expect(result.segments).toHaveLength(2);
    expect(result.reconciliation).toEqual({
      policyVersion: 'cross_channel_skew_v1',
      skewApplied: false,
      estimatedOffsetMs: 0,
      anchorCount: 0,
      confidence: 0,
      droppedMicWordCount: 0,
      collapsedSequenceCount: 0,
    });
  });

  it('validates checkpoint source coverage after canonical duplicate arbitration', async () => {
    const transcribe = vi.fn();
    const probeDuration = vi.fn();

    const result = await runRecordingTranscriptValidation({
      meetingId: 'checkpointed-duplicate-meeting',
      recordingDurationSeconds: 60,
      micAudioPath: '/synthetic/mic.wav',
      mixAudioPath: '',
      systemAudioPath: '/synthetic/system.wav',
      provisionalSegments: [
        {
          id: 'system-0',
          startTime: 0,
          endTime: 9,
          text: 'Canonical duplicate winner',
          speaker: 'Them',
        },
      ],
      checkpointSourceSegments: [
        {
          id: 'mic-source-0',
          startTime: 0,
          endTime: 9,
          text: '',
          speaker: 'Me',
        },
        {
          id: 'system-source-0',
          startTime: 0,
          endTime: 9,
          text: '',
          speaker: 'Them',
        },
      ],
      activityWindows: [
        { speaker: 'Me', startTime: 0, endTime: 4 },
        { speaker: 'Them', startTime: 5, endTime: 9 },
      ],
      canonicalMode: 'checkpointed',
      checkpointEvidenceVerified: true,
      transcribe,
      probeDuration,
    });

    expect(result.status).toBe('validated');
    expect(result.reasons).toEqual([]);
    expect(result.segments).toEqual([
      expect.objectContaining({ speaker: 'Them' }),
    ]);
    expect(result.sourceSegmentCounts).toMatchObject({ mic: 1, system: 1 });
  });

  it('always transcribes mic, mix, and system sources', async () => {
    const transcribe = vi.fn(async (path: string) => ({
      segments: path.includes('mix')
        ? [
            rawSegment(0, 4, 'Synthetic local statement'),
            rawSegment(5, 9, 'Synthetic remote statement'),
          ]
        : path.includes('system')
          ? [rawSegment(5, 9, 'Synthetic remote statement')]
          : [rawSegment(0, 4, 'Synthetic local statement')],
      meta: { elapsedMs: 10 },
    }));

    const result = await runRecordingTranscriptValidation({
      meetingId: 'synthetic-meeting',
      recordingDurationSeconds: 60,
      micAudioPath: '/synthetic/mic.wav',
      mixAudioPath: '/synthetic/mix.wav',
      systemAudioPath: '/synthetic/system.wav',
      provisionalSegments: [],
      activityWindows: [
        { speaker: 'Me', startTime: 0, endTime: 4 },
        { speaker: 'Them', startTime: 5, endTime: 9 },
      ],
      transcribe,
      probeDuration: async () => 60,
    });

    expect(transcribe).toHaveBeenCalledTimes(3);
    expect(result.status).toBe('validated');
    expect(result.segments.map((item) => item.speaker)).toEqual(['Me', 'Them']);
    expect(result.reconciliation).toMatchObject({
      policyVersion: 'cross_channel_skew_v1',
      skewApplied: false,
      droppedMicWordCount: 0,
    });
  });

  it('returns needs_attention when a required source fails twice', async () => {
    const transcribe = vi.fn(async (path: string) => {
      if (path.includes('system')) throw new Error('synthetic failure');
      return { segments: [], meta: { elapsedMs: 10 } };
    });

    const result = await runRecordingTranscriptValidation({
      meetingId: 'synthetic-meeting',
      recordingDurationSeconds: 60,
      micAudioPath: '/synthetic/mic.wav',
      mixAudioPath: '/synthetic/mix.wav',
      systemAudioPath: '/synthetic/system.wav',
      provisionalSegments: [],
      activityWindows: [],
      transcribe,
      probeDuration: async () => 60,
    });

    expect(result.status).toBe('needs_attention');
    expect(result.reasons).toContain('required_source_failed');
    expect(result.attempts.system).toBe(2);
  });

  it('rejects acoustic false positives only when every preserved source returns explicit no-speech VAD proof', async () => {
    const result = await runRecordingTranscriptValidation({
      meetingId: 'detector-false-positive',
      recordingDurationSeconds: 60,
      micAudioPath: '/synthetic/mic.wav',
      mixAudioPath: '/synthetic/mix.wav',
      systemAudioPath: '/synthetic/system.wav',
      provisionalSegments: [],
      activityWindows: [
        { speaker: 'Me', startTime: 0, endTime: 40 },
        { speaker: 'Them', startTime: 40, endTime: 60 },
      ],
      transcribe: async () => ({
        segments: [],
        vad: { status: 'no_speech', speechSeconds: 0 },
      }),
      probeDuration: async () => 60,
    });

    expect(result.status).toBe('validated');
    expect(result.reasons).toEqual([]);
    expect(result.evidence).toMatchObject({
      micActivitySeconds: 40,
      systemActivitySeconds: 20,
      unexplainedMicSeconds: 0,
      unexplainedSystemSeconds: 0,
      rejectedMicCandidateSeconds: 40,
      rejectedSystemCandidateSeconds: 20,
    });
  });

  it('keeps empty transcription fail-closed when explicit VAD proof is missing', async () => {
    const result = await runRecordingTranscriptValidation({
      meetingId: 'ambiguous-empty-transcription',
      recordingDurationSeconds: 60,
      micAudioPath: '/synthetic/mic.wav',
      mixAudioPath: '/synthetic/mix.wav',
      systemAudioPath: '/synthetic/system.wav',
      provisionalSegments: [],
      activityWindows: [{ speaker: 'Me', startTime: 0, endTime: 40 }],
      transcribe: async () => ({ segments: [] }),
      probeDuration: async () => 60,
    });

    expect(result.status).toBe('needs_attention');
    expect(result.reasons).toContain('required_source_failed');
  });

  it('uses preserved source ASR coverage even when canonical speaker arbitration disagrees', async () => {
    const result = await runRecordingTranscriptValidation({
      meetingId: 'source-coverage-survives-attribution',
      recordingDurationSeconds: 10,
      micAudioPath: '/synthetic/mic.wav',
      mixAudioPath: '/synthetic/mix.wav',
      systemAudioPath: '/synthetic/system.wav',
      provisionalSegments: [],
      activityWindows: [{ speaker: 'Me', startTime: 0, endTime: 10 }],
      transcribe: async (path) => {
        if (path.includes('mic')) {
          return {
            segments: [],
            vad: { status: 'no_speech' as const, speechSeconds: 0 },
          };
        }
        if (path.includes('system')) {
          return {
            segments: [rawSegment(0, 4, 'Preserved remote source evidence')],
            vad: { status: 'speech' as const, speechSeconds: 4 },
          };
        }
        return {
          segments: [rawSegment(0, 4, 'Different canonical wording')],
          vad: { status: 'speech' as const, speechSeconds: 4 },
        };
      },
      probeDuration: async () => 10,
    });

    expect(result.segments[0]?.speaker).toBe('Me');
    expect(result.status).toBe('validated');
    expect(result.reasons).not.toContain('remote_speech_unaccounted');
  });

  it('counts duplicate and overlapping transcript segments once when measuring coverage', async () => {
    const result = await runRecordingTranscriptValidation({
      meetingId: 'synthetic-meeting',
      recordingDurationSeconds: 10,
      micAudioPath: '/synthetic/mic.wav',
      mixAudioPath: '/synthetic/mix.wav',
      systemAudioPath: '/synthetic/system.wav',
      provisionalSegments: [],
      activityWindows: [{ speaker: 'Me', startTime: 0, endTime: 10 }],
      transcribe: async (path) => ({
        segments: path.includes('mix')
          ? [
              rawSegment(0, 4, 'Synthetic first overlapping segment'),
              rawSegment(0, 4, 'Synthetic second overlapping segment'),
              rawSegment(2, 6, 'Synthetic partially overlapping segment'),
            ]
          : [],
      }),
      probeDuration: async () => 10,
    });

    expect(result.evidence.localTranscriptCoveredSeconds).toBe(6);
    expect(result.status).toBe('needs_attention');
    expect(result.reasons).toContain('local_speech_unaccounted');
  });

  it('counts overlapping activity windows once when measuring coverage', async () => {
    const result = await runRecordingTranscriptValidation({
      meetingId: 'synthetic-meeting',
      recordingDurationSeconds: 12,
      micAudioPath: '/synthetic/mic.wav',
      mixAudioPath: '/synthetic/mix.wav',
      systemAudioPath: '/synthetic/system.wav',
      provisionalSegments: [],
      activityWindows: [
        { speaker: 'Me', startTime: 0, endTime: 10 },
        { speaker: 'Me', startTime: 2, endTime: 12 },
      ],
      transcribe: async (path) => ({
        segments: path.includes('mix')
          ? [rawSegment(2, 9, 'Synthetic partial coverage')]
          : [],
      }),
      probeDuration: async () => 12,
    });

    expect(result.evidence.micActivitySeconds).toBe(12);
    expect(result.evidence.localTranscriptCoveredSeconds).toBe(7);
    expect(result.status).toBe('needs_attention');
    expect(result.reasons).toContain('local_speech_unaccounted');
  });

  it('does not let sparse ASR speech replace sealed capture activity', async () => {
    const result = await runRecordingTranscriptValidation({
      meetingId: 'synthetic-meeting',
      recordingDurationSeconds: 60,
      micAudioPath: '/synthetic/mic.wav',
      mixAudioPath: '',
      systemAudioPath: '',
      provisionalSegments: [],
      activityWindows: [{ speaker: 'Me', startTime: 0, endTime: 60 }],
      canonicalMode: 'recovered_channels',
      transcriptionScheduling: 'sequential_channels',
      transcribe: async (_path, options) => ({
        segments:
          options.canonicalSource === 'mic'
            ? [rawSegment(0, 2, 'Only a short recovered fragment')]
            : [],
        vad:
          options.canonicalSource === 'mic'
            ? { status: 'speech' as const, speechSeconds: 2 }
            : { status: 'no_speech' as const, speechSeconds: 0 },
      }),
      probeDuration: async () => 60,
    });

    expect(result.status).toBe('needs_attention');
    expect(result.reasons).toContain('local_speech_unaccounted');
    expect(result.evidence.micActivitySeconds).toBe(60);
  });

  it('does not expose source paths or transcript text in integrity evidence', async () => {
    const result = await runRecordingTranscriptValidation({
      meetingId: 'synthetic-meeting',
      recordingDurationSeconds: 10,
      micAudioPath: '/synthetic/mic.wav',
      mixAudioPath: '/synthetic/mix.wav',
      systemAudioPath: '/synthetic/system.wav',
      provisionalSegments: [],
      activityWindows: [],
      transcribe: async () => ({ segments: [], meta: {} }),
      probeDuration: async () => 10,
    });

    expect(JSON.stringify(result.evidence)).not.toContain('/synthetic');
    expect(JSON.stringify(result.evidence)).not.toContain('text');
  });
});
