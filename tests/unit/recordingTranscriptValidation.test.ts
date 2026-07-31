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
