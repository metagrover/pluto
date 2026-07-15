import { describe, expect, it, vi } from 'vitest';
import { runRecordingTranscriptValidation } from '../../src/services/recordingTranscriptValidation';

const rawSegment = (start: number, end: number, text: string) => ({
  start,
  end,
  text,
});

describe('runRecordingTranscriptValidation', () => {
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
