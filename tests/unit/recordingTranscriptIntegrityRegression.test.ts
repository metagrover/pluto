import { describe, expect, it, vi } from 'vitest';

import { runRecordingTranscriptValidation } from '../../src/services/recordingTranscriptValidation';

const raw = (start: number, end: number, text: string) => ({
  start,
  end,
  text,
});

describe('recording transcript integrity regression', () => {
  it('recovers substantive synthetic local speech despite sparse provisional chunks', async () => {
    const localCanonical = [
      raw(420, 450, 'Synthetic proposal with multiple supporting points.'),
      raw(680, 720, 'Synthetic follow-up question and recommendation.'),
      raw(1020, 1060, 'Synthetic implementation constraints.'),
    ];
    const remoteCanonical = [
      raw(100, 160, 'Synthetic remote context.'),
      raw(500, 570, 'Synthetic remote response.'),
      raw(1150, 1220, 'Synthetic remote conclusion.'),
    ];
    const transcribe = vi.fn(async (path: string) => ({
      segments: path.includes('mic')
        ? localCanonical
        : path.includes('system')
          ? remoteCanonical
          : remoteCanonical,
    }));

    const result = await runRecordingTranscriptValidation({
      meetingId: 'synthetic-meeting',
      recordingDurationSeconds: 1500,
      micAudioPath: '/synthetic/mic.wav',
      mixAudioPath: '/synthetic/mix.wav',
      systemAudioPath: '/synthetic/system.wav',
      provisionalSegments: [
        {
          id: 'synthetic-short-1',
          speaker: 'Me',
          startTime: 7,
          endTime: 7.2,
          text: 'Acknowledged.',
        },
        {
          id: 'synthetic-short-2',
          speaker: 'Me',
          startTime: 25,
          endTime: 25.2,
          text: 'Confirmed.',
        },
      ],
      activityWindows: [
        ...localCanonical.map((segment) => ({
          speaker: 'Me' as const,
          startTime: segment.start,
          endTime: segment.end,
        })),
        ...remoteCanonical.map((segment) => ({
          speaker: 'Them' as const,
          startTime: segment.start,
          endTime: segment.end,
        })),
      ],
      transcribe,
      probeDuration: async () => 1500,
    });

    expect(transcribe).toHaveBeenCalledTimes(3);
    expect(result.status).toBe('validated');
    expect(result.segments.filter((item) => item.speaker === 'Me')).toEqual(
      expect.arrayContaining(
        localCanonical.map((item) =>
          expect.objectContaining({ text: item.text }),
        ),
      ),
    );
  });
});
