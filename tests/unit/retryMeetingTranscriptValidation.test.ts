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
    const responsiveness = {
      schemaVersion: 1,
      status: 'available',
      firstTextLatencyMs: 250,
      acceptedPublicationCount: 3,
      cadenceSampleCount: 2,
      maximumUpdateGapMs: 450,
    };
    let current: Record<string, unknown> = {
      ...meeting,
      transcript_json: JSON.stringify({
        schemaVersion: 2,
        segments: [],
        liveTranscriptResponsiveness: responsiveness,
      }),
    };
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
    expect(
      JSON.parse(String(current.transcript_json)).liveTranscriptResponsiveness,
    ).toEqual(responsiveness);
  });

  it('preserves user edits made while validation is running', async () => {
    let current: Record<string, unknown> = { ...meeting };
    let meetingReads = 0;
    let analysisUserNotes: unknown;
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') {
        meetingReads += 1;
        if (meetingReads >= 2) {
          current = {
            ...current,
            title: 'User edited title',
            user_notes: 'User edited notes',
            is_favorite: true,
          };
        }
        return current;
      }
      if (channel === 'AUDIO_PROBE_DURATION') return 60;
      if (channel === 'WHISPER_TRANSCRIBE') {
        return {
          segments: [rawSegment(5, 20, 'Synthetic attributed statement.')],
        };
      }
      if (channel === 'SAVE_MEETING') {
        current = { ...current, ...(payload as Record<string, unknown>) };
        return true;
      }
      if (channel === 'GENERATE_TITLE') return 'Generated title';
      if (channel === 'GENERATE_ANALYSIS_V2') {
        analysisUserNotes = (payload as { userNotes?: unknown }).userNotes;
        return { markdown: 'Synthetic analysis', analysis: {}, signals: {} };
      }
      if (channel === 'EXTRACT_AND_PROCESS_ENTITIES') return { created: 0 };
      throw new Error(`Unexpected channel: ${channel}`);
    });

    const result = await retryMeetingTranscriptValidation(
      'synthetic-id',
      invoke,
    );

    expect(result.status).toBe('validated');
    expect(current).toMatchObject({
      title: 'User edited title',
      user_notes: 'User edited notes',
      is_favorite: true,
      transcript_status: 'validated',
    });
    expect(analysisUserNotes).toBe('User edited notes');
  });

  it('returns superseded when another retry wins the final save race', async () => {
    let current: Record<string, unknown> = { ...meeting };
    const invoke = vi.fn(
      async (channel: string, payload?: unknown, options?: unknown) => {
        if (channel === 'GET_MEETING') return current;
        if (channel === 'AUDIO_PROBE_DURATION') return 60;
        if (channel === 'WHISPER_TRANSCRIBE') {
          return {
            segments: [rawSegment(5, 20, 'Synthetic attributed statement.')],
          };
        }
        if (channel === 'SAVE_MEETING') {
          if (options) return false;
          current = { ...current, ...(payload as Record<string, unknown>) };
          return true;
        }
        if (channel === 'GENERATE_TITLE') return 'Generated title';
        if (channel === 'GENERATE_ANALYSIS_V2') {
          return { markdown: 'Synthetic analysis', analysis: {}, signals: {} };
        }
        throw new Error(`Unexpected channel: ${channel}`);
      },
    );

    const result = await retryMeetingTranscriptValidation(
      'synthetic-id',
      invoke,
    );

    expect(result).toEqual({ status: 'superseded' });
    expect(invoke).not.toHaveBeenCalledWith(
      'EXTRACT_AND_PROCESS_ENTITIES',
      expect.anything(),
    );
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

  it('reuses stored activity evidence when partial retry recovery is still below the original coverage gate', async () => {
    let current: Record<string, unknown> = {
      ...meeting,
      transcript_integrity_json: JSON.stringify({
        micActivitySeconds: 20,
        systemActivitySeconds: 10,
        reasons: ['local_speech_unaccounted'],
        activityEvidence: {
          schemaVersion: 1,
          source: 'capture_activity_v1',
          windows: [
            { startTime: 0, endTime: 20, speaker: 'Me' },
            { startTime: 20, endTime: 30, speaker: 'Them' },
          ],
        },
      }),
      transcript_json: JSON.stringify({
        segments: [
          {
            speaker: 'Me',
            startTime: 0,
            endTime: 2,
            text: 'Short recovered local segment.',
          },
        ],
      }),
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'AUDIO_PROBE_DURATION') return 60;
      if (channel === 'WHISPER_TRANSCRIBE') {
        const audioPath = String(payload);
        if (audioPath.includes('mic')) {
          return {
            segments: [rawSegment(0, 2, 'Short recovered local segment.')],
          };
        }
        if (audioPath.includes('system')) {
          return {
            segments: [rawSegment(20, 30, 'Synthetic remote statement.')],
          };
        }
        return {
          segments: [
            rawSegment(0, 2, 'Short recovered local segment.'),
            rawSegment(20, 30, 'Synthetic remote statement.'),
          ],
        };
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
    expect(
      JSON.parse(String(current.transcript_integrity_json)).reasons,
    ).toContain('local_speech_unaccounted');
    expect(
      JSON.parse(String(current.transcript_integrity_json))
        .activityEvidenceSource,
    ).toBe('capture_activity_v1');
  });

  it('labels legacy retries when they fall back to provisional transcript activity windows', async () => {
    let current: Record<string, unknown> = {
      ...meeting,
      transcript_integrity_json: JSON.stringify({
        micActivitySeconds: 4,
        reasons: [],
      }),
      transcript_json: JSON.stringify({
        segments: [
          {
            speaker: 'Me',
            startTime: 0,
            endTime: 4,
            text: 'Recovered local statement.',
          },
          {
            speaker: 'Them',
            startTime: 10,
            endTime: 14,
            text: 'Recovered remote statement.',
          },
        ],
      }),
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'AUDIO_PROBE_DURATION') return 60;
      if (channel === 'WHISPER_TRANSCRIBE') {
        const audioPath = String(payload);
        if (audioPath.includes('system')) {
          return {
            segments: [rawSegment(10, 14, 'Recovered remote statement.')],
          };
        }
        return {
          segments: [rawSegment(0, 4, 'Recovered local statement.')],
        };
      }
      if (channel === 'SAVE_MEETING') {
        current = { ...current, ...(payload as Record<string, unknown>) };
        return true;
      }
      if (channel === 'GENERATE_TITLE') return 'Synthetic meeting';
      if (channel === 'GENERATE_ANALYSIS_V2') {
        return { markdown: 'Synthetic analysis', analysis: {}, signals: {} };
      }
      if (channel === 'EXTRACT_AND_PROCESS_ENTITIES') return { created: 0 };
      throw new Error(`Unexpected channel: ${channel}`);
    });

    const result = await retryMeetingTranscriptValidation(
      'synthetic-id',
      invoke,
    );

    expect(result.status).toBe('needs_attention');
    expect(
      JSON.parse(String(current.transcript_integrity_json))
        .activityEvidenceSource,
    ).toBe('legacy_provisional_segments');
    expect(invoke).not.toHaveBeenCalledWith(
      'GENERATE_ANALYSIS_V2',
      expect.anything(),
    );
  });

  it('fails closed when a deterministic retry expects stored activity evidence but none is present', async () => {
    let current: Record<string, unknown> = {
      ...meeting,
      transcript_integrity_json: JSON.stringify({
        activityEvidenceSource: 'capture_activity_v1',
        reasons: [],
      }),
      transcript_json: JSON.stringify({
        segments: [
          {
            speaker: 'Me',
            startTime: 0,
            endTime: 4,
            text: 'Recovered local statement.',
          },
          {
            speaker: 'Them',
            startTime: 10,
            endTime: 14,
            text: 'Recovered remote statement.',
          },
        ],
      }),
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'AUDIO_PROBE_DURATION') return 60;
      if (channel === 'WHISPER_TRANSCRIBE') {
        const audioPath = String(payload);
        if (audioPath.includes('system')) {
          return {
            segments: [rawSegment(10, 14, 'Recovered remote statement.')],
          };
        }
        return {
          segments: [rawSegment(0, 4, 'Recovered local statement.')],
        };
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
    expect(
      JSON.parse(String(current.transcript_integrity_json)).reasons,
    ).toContain('deterministic_retry_evidence_missing');
    expect(
      JSON.parse(String(current.transcript_integrity_json))
        .activityEvidenceSource,
    ).toBe('capture_activity_missing');
    expect(invoke).not.toHaveBeenCalledWith(
      'GENERATE_ANALYSIS_V2',
      expect.anything(),
    );
  });

  it('fails closed when stored deterministic retry evidence is corrupt', async () => {
    let current: Record<string, unknown> = {
      ...meeting,
      transcript_integrity_json: JSON.stringify({
        activityEvidenceSource: 'capture_activity_v1',
        activityEvidence: {
          schemaVersion: 999,
          source: 'capture_activity_v1',
          windows: [{ startTime: 0, endTime: 4, speaker: 'Me' }],
        },
        reasons: [],
      }),
      transcript_json: JSON.stringify({
        segments: [
          {
            speaker: 'Me',
            startTime: 0,
            endTime: 4,
            text: 'Recovered local statement.',
          },
          {
            speaker: 'Them',
            startTime: 10,
            endTime: 14,
            text: 'Recovered remote statement.',
          },
        ],
      }),
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'AUDIO_PROBE_DURATION') return 60;
      if (channel === 'WHISPER_TRANSCRIBE') {
        const audioPath = String(payload);
        if (audioPath.includes('system')) {
          return {
            segments: [rawSegment(10, 14, 'Recovered remote statement.')],
          };
        }
        return {
          segments: [rawSegment(0, 4, 'Recovered local statement.')],
        };
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
    expect(
      JSON.parse(String(current.transcript_integrity_json)).reasons,
    ).toContain('deterministic_retry_evidence_corrupt');
    expect(
      JSON.parse(String(current.transcript_integrity_json))
        .activityEvidenceSource,
    ).toBe('capture_activity_corrupt');
    expect(invoke).not.toHaveBeenCalledWith(
      'GENERATE_ANALYSIS_V2',
      expect.anything(),
    );
  });

  it('cancels timed-out work and restores preserved evidence to needs attention', async () => {
    let current: Record<string, unknown> = {
      ...meeting,
      transcript_integrity_json: JSON.stringify({
        reasons: ['remote_speech_unaccounted'],
        systemActivitySeconds: 12,
      }),
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'AUDIO_PROBE_DURATION') return 60;
      if (channel === 'WHISPER_TRANSCRIBE') {
        return await new Promise(() => undefined);
      }
      if (channel === 'CANCEL_MEETING_TRANSCRIPTION')
        return { cancelled: true };
      if (channel === 'FAIL_TRANSCRIPT_VALIDATION_RETRY') {
        const integrity = JSON.parse(
          String(current.transcript_integrity_json),
        ) as Record<string, unknown>;
        const { retry: _retry, ...prior } = integrity;
        current = {
          ...current,
          transcript_status: 'needs_attention',
          transcript_integrity_json: JSON.stringify({
            ...prior,
            retryFailure: 'retry_timeout',
          }),
        };
        return true;
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
      { validationTimeoutMs: 5 },
    );

    expect(result).toEqual({ status: 'needs_attention' });
    expect(invoke).toHaveBeenCalledWith(
      'CANCEL_MEETING_TRANSCRIPTION',
      'synthetic-id',
    );
    expect(current.transcript_status).toBe('needs_attention');
    expect(JSON.parse(String(current.transcript_integrity_json))).toMatchObject(
      {
        reasons: ['remote_speech_unaccounted'],
        systemActivitySeconds: 12,
        retryFailure: 'retry_timeout',
      },
    );
  });
});
