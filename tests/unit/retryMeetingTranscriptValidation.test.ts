import { describe, expect, it, vi } from 'vitest';

import { retryMeetingTranscriptValidation } from '../../src/services/retryMeetingTranscriptValidation';

const rawSegment = (start: number, end: number, text: string) => ({
  start,
  end,
  text,
});

const meeting = {
  id: 'synthetic-id',
  title: 'Meeting',
  created_at: '2026-01-01T00:00:00.000Z',
  started_at: '2026-01-01T00:00:00.000Z',
  duration_seconds: 60,
  audio_path: '/synthetic/mic.wav',
  system_audio_path: '/synthetic/system.wav',
  mixed_audio_path: '/synthetic/mix.wav',
  transcript_status: 'needs_attention',
  transcript_json: JSON.stringify({ segments: [] }),
};

describe('retryMeetingTranscriptValidation', () => {
  it('does not generate downstream intelligence while validation still needs attention', async () => {
    let current = { ...meeting };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'WHISPER_TRANSCRIBE') return { segments: [] };
      if (channel === 'AUDIO_PROBE_DURATION') return 60;
      if (channel === 'SAVE_MEETING') {
        current = { ...current, ...(payload as typeof current) };
        return true;
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });

    const result = await retryMeetingTranscriptValidation(
      'synthetic-id',
      invoke,
    );

    expect(result.status).toBe('needs_attention');
    expect(invoke).not.toHaveBeenCalledWith(
      'GENERATE_ANALYSIS_V2',
      expect.anything(),
    );
    expect(invoke).not.toHaveBeenCalledWith(
      'EXTRACT_AND_PROCESS_ENTITIES',
      expect.anything(),
    );
  });

  it('generates downstream artifacts exactly once after validation succeeds', async () => {
    let current: Record<string, unknown> = { ...meeting };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'AUDIO_PROBE_DURATION') return 60;
      if (channel === 'WHISPER_TRANSCRIBE') {
        const path = String(payload);
        return {
          segments: [
            {
              start: 5,
              end: 20,
              text: path.includes('system')
                ? 'Synthetic remote statement.'
                : 'Synthetic local statement.',
            },
          ],
        };
      }
      if (channel === 'SAVE_MEETING') {
        current = { ...current, ...(payload as Record<string, unknown>) };
        return true;
      }
      if (channel === 'GENERATE_TITLE') return 'Synthetic meeting';
      if (channel === 'GENERATE_ANALYSIS_V2') {
        return {
          markdown: 'Synthetic analysis',
          analysis: { analysis_schema_version: 3 },
          signals: {},
        };
      }
      if (channel === 'EXTRACT_AND_PROCESS_ENTITIES') return { created: 0 };
      throw new Error(`Unexpected channel: ${channel}`);
    });

    const first = await retryMeetingTranscriptValidation(
      'synthetic-id',
      invoke,
    );
    const second = await retryMeetingTranscriptValidation(
      'synthetic-id',
      invoke,
    );

    expect(first.status).toBe('validated');
    expect(second.status).toBe('validated');
    expect(
      invoke.mock.calls.filter(
        ([channel]) => channel === 'GENERATE_ANALYSIS_V2',
      ),
    ).toHaveLength(1);
    expect(
      invoke.mock.calls.filter(
        ([channel]) => channel === 'EXTRACT_AND_PROCESS_ENTITIES',
      ),
    ).toHaveLength(1);
  });

  it('does not clear prior missing-local-speech evidence when the mic retry stays empty', async () => {
    let current: Record<string, unknown> = {
      ...meeting,
      transcript_integrity_json: JSON.stringify({
        micActivitySeconds: 20,
        reasons: ['local_speech_unaccounted'],
      }),
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'AUDIO_PROBE_DURATION') return 60;
      if (channel === 'WHISPER_TRANSCRIBE') {
        return String(payload).includes('mic')
          ? { segments: [] }
          : { segments: [rawSegment(10, 20, 'Synthetic remote statement')] };
      }
      if (channel === 'SAVE_MEETING') {
        current = { ...current, ...(payload as Record<string, unknown>) };
        return true;
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });

    const result = await retryMeetingTranscriptValidation(
      'synthetic-id',
      invoke,
    );

    expect(result.status).toBe('needs_attention');
    expect(invoke).not.toHaveBeenCalledWith(
      'GENERATE_ANALYSIS_V2',
      expect.anything(),
    );
  });
});
