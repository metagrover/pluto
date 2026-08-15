import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  meetingTitleNeedsGeneration,
  retryMeetingTranscriptValidation,
  shouldAutoProcessMeetingAnalysis,
} from '../../src/services/retryMeetingTranscriptValidation';
import { buildCaptureActivityEvidence } from '../../src/utils/transcriptActivityEvidence';

const validationInputs = vi.hoisted(() => [] as unknown[]);

vi.mock('../../src/services/recordingTranscriptValidation.ts', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/services/recordingTranscriptValidation.ts')
  >('../../src/services/recordingTranscriptValidation.ts');
  return {
    ...actual,
    runRecordingTranscriptValidation: async (
      input: Parameters<typeof actual.runRecordingTranscriptValidation>[0],
    ) => {
      validationInputs.push(input);
      return actual.runRecordingTranscriptValidation(input);
    },
  };
});

const rawSegment = (start: number, end: number, text: string) => ({
  start,
  end,
  text,
});

const finalAudioPath = (payload: unknown): string =>
  typeof payload === 'object' &&
  payload !== null &&
  typeof (payload as { audioPath?: unknown }).audioPath === 'string'
    ? (payload as { audioPath: string }).audioPath
    : '';

const activityProducer = {
  clock: {
    kind: 'meeting_relative_seconds' as const,
    origin: 'recording_start' as const,
  },
  thresholds: {
    rms: 0.012,
    dominanceRatio: 1.25,
    minimumSwitchIntervalMs: 200,
  },
  algorithmVersion: 'speaker_activity_v1' as const,
};

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

describe('meetingTitleNeedsGeneration', () => {
  it.each([
    'Meeting',
    'New Meeting',
    'Meeting (Mic Only)',
    'Recovered recording',
    'Untitled Meeting',
    '  ',
  ])('recognizes the generic title %j', (title) => {
    expect(meetingTitleNeedsGeneration(title)).toBe(true);
  });

  it('preserves a descriptive title', () => {
    expect(meetingTitleNeedsGeneration('Quarterly Planning Review')).toBe(
      false,
    );
  });
});

describe('retryMeetingTranscriptValidation', () => {
  beforeEach(() => {
    validationInputs.length = 0;
  });

  it('does not generate downstream intelligence while validation still needs attention', async () => {
    let current = { ...meeting };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL') return { segments: [] };
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

  it('converges partial capture-gap intelligence without claiming validation', async () => {
    let current: Record<string, unknown> = {
      ...meeting,
      title: 'Recovered recording',
      transcript_status: 'needs_attention',
      transcript_json: JSON.stringify({
        lifecycleStatus: 'needs_attention',
        segments: [{ speaker: 'Me', text: 'Synthetic statement.' }],
      }),
      transcript_integrity_json: JSON.stringify({
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [{ code: 'capture_gap_detected', sourceScope: 'mic' }],
        evidenceProvenance: { kind: 'sealed_capture_activity_v2' },
        recovery: {
          source: 'capture_journal',
          gapDetected: true,
          sourceScope: 'mic',
          acknowledgedChunkCount: 4,
          recoveredChunkCount: 3,
        },
      }),
      capture_journal_generation: 'journal-1',
    };
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'GENERATE_TITLE') return 'Recovered Planning Discussion';
      if (channel === 'UPDATE_MEETING_TITLE_IF_CURRENT') {
        const input = args[0] as { expectedTitle: string; title: string };
        if (current.title !== input.expectedTitle) return 'conflict';
        current = { ...current, title: input.title };
        return 'updated';
      }
      if (channel === 'CLAIM_DOWNSTREAM_PROCESSING') return true;
      if (channel === 'GENERATE_ANALYSIS_V2') {
        return {
          markdown: 'Partial synthetic analysis',
          analysis: { analysis_schema_version: 3 },
          signals: {},
        };
      }
      if (channel === 'SAVE_MEETING') {
        current = { ...current, ...(args[0] as Record<string, unknown>) };
        return true;
      }
      if (channel === 'EXTRACT_AND_PROCESS_ENTITIES') return { created: 0 };
      if (channel === 'REFRESH_KNOWLEDGE_FOR_MEETING_NOW') {
        return { requested: 1, completed: 1 };
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });

    await expect(
      retryMeetingTranscriptValidation('synthetic-id', invoke),
    ).resolves.toEqual({ status: 'needs_attention' });
    expect(current.title).toBe('Recovered Planning Discussion');
    expect(current.transcript_status).toBe('needs_attention');
    expect(invoke).toHaveBeenCalledWith(
      'GENERATE_ANALYSIS_V2',
      expect.anything(),
    );
    expect(invoke).toHaveBeenCalledWith(
      'CLAIM_DOWNSTREAM_PROCESSING',
      expect.anything(),
      expect.anything(),
    );
    expect(
      JSON.parse(String(current.downstream_processing_json)),
    ).toMatchObject({
      schemaVersion: 2,
      state: 'complete',
      source: { kind: 'partial_capture_gap' },
    });
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
    const stopToValidatedLatency = {
      schemaVersion: 1,
      status: 'available',
      durationMs: 840,
    };
    let current: Record<string, unknown> = {
      ...meeting,
      transcript_json: JSON.stringify({
        schemaVersion: 2,
        segments: [],
        liveTranscriptResponsiveness: responsiveness,
        stopToValidatedLatency,
      }),
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'CLAIM_DOWNSTREAM_PROCESSING') return true;
      if (channel === 'AUDIO_PROBE_DURATION') return 60;
      if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL') {
        const path = finalAudioPath(payload);
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
      if (channel === 'REFRESH_KNOWLEDGE_FOR_MEETING_NOW') {
        return { requested: 1, completed: 1 };
      }
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
    expect(
      JSON.parse(String(current.transcript_json)).stopToValidatedLatency,
    ).toEqual(stopToValidatedLatency);
    expect(
      JSON.parse(String(current.downstream_processing_json)),
    ).toMatchObject({ state: 'complete' });
    expect(invoke).toHaveBeenCalledWith(
      'EXTRACT_AND_PROCESS_ENTITIES',
      expect.objectContaining({
        expectedDownstreamRunId: expect.any(String),
      }),
    );
    expect(invoke).toHaveBeenCalledWith(
      'REFRESH_KNOWLEDGE_FOR_MEETING_NOW',
      'synthetic-id',
      expect.objectContaining({
        expectedDownstreamRunId: expect.any(String),
      }),
    );
  });

  it('does not duplicate downstream work when another durable owner is active', async () => {
    const current = {
      ...meeting,
      transcript_status: 'validated' as const,
      transcript_validated_at: '2026-08-04T00:00:00.000Z',
      transcript_json: JSON.stringify({
        lifecycleStatus: 'validated',
        segments: [{ speaker: 'Me', text: 'Synthetic statement.' }],
      }),
      transcript_integrity_json: JSON.stringify({
        schemaVersion: 2,
        state: 'validated',
        causes: [],
      }),
    };
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'CLAIM_DOWNSTREAM_PROCESSING') return false;
      throw new Error(`Unexpected channel: ${channel}`);
    });

    expect(
      await retryMeetingTranscriptValidation('synthetic-id', invoke),
    ).toEqual({ status: 'superseded' });
    expect(invoke).not.toHaveBeenCalledWith(
      'GENERATE_ANALYSIS_V2',
      expect.anything(),
    );
    expect(invoke).not.toHaveBeenCalledWith(
      'EXTRACT_AND_PROCESS_ENTITIES',
      expect.anything(),
    );
  });

  it('resumes at knowledge synthesis when analysis and MID are already durable', async () => {
    let current: Record<string, unknown> = {
      ...meeting,
      title: 'Synthetic meeting',
      transcript_status: 'validated',
      transcript_validated_at: '2026-08-04T00:00:00.000Z',
      transcript_json: JSON.stringify({
        lifecycleStatus: 'validated',
        segments: [{ speaker: 'Me', text: 'Synthetic statement.' }],
      }),
      analysis_json: JSON.stringify({ analysis_schema_version: 3 }),
      mid_json: JSON.stringify({ schema_version: 1 }),
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'CLAIM_DOWNSTREAM_PROCESSING') return true;
      if (channel === 'SAVE_MEETING') {
        current = { ...current, ...(payload as Record<string, unknown>) };
        return true;
      }
      if (channel === 'REFRESH_KNOWLEDGE_FOR_MEETING_NOW') {
        return { requested: 1, completed: 1 };
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });

    expect(
      await retryMeetingTranscriptValidation('synthetic-id', invoke),
    ).toEqual({ status: 'validated' });
    expect(invoke).not.toHaveBeenCalledWith(
      'EXTRACT_AND_PROCESS_ENTITIES',
      expect.anything(),
    );
    expect(invoke).not.toHaveBeenCalledWith(
      'GENERATE_ANALYSIS_V2',
      expect.anything(),
    );
    expect(
      JSON.parse(String(current.downstream_processing_json)),
    ).toMatchObject({ state: 'complete' });
  });

  it('repairs a generic title even when downstream artifacts are complete', async () => {
    let current: Record<string, unknown> = {
      ...meeting,
      title: 'Recovered recording',
      transcript_status: 'validated',
      transcript_validated_at: '2026-08-04T00:00:00.000Z',
      transcript_json: JSON.stringify({
        lifecycleStatus: 'validated',
        segments: [{ speaker: 'Me', text: 'Synthetic statement.' }],
      }),
      analysis_json: JSON.stringify({ analysis_schema_version: 3 }),
      mid_json: JSON.stringify({ mid_version: 1 }),
      downstream_processing_json: JSON.stringify({
        schemaVersion: 1,
        state: 'complete',
      }),
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'CLAIM_DOWNSTREAM_PROCESSING') return true;
      if (channel === 'GENERATE_TITLE') return 'Synthetic meeting';
      if (channel === 'SAVE_MEETING') {
        current = { ...current, ...(payload as Record<string, unknown>) };
        return true;
      }
      if (channel === 'REFRESH_KNOWLEDGE_FOR_MEETING_NOW') {
        return { requested: 1, completed: 1 };
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });

    await expect(
      retryMeetingTranscriptValidation('synthetic-id', invoke),
    ).resolves.toEqual({ status: 'validated' });
    expect(current.title).toBe('Synthetic meeting');
    expect(invoke).toHaveBeenCalledWith('GENERATE_TITLE', {
      transcript: 'Me: Synthetic statement.',
    });
  });

  it('processes a newly validated meeting without transcribing it a second time', async () => {
    let current: Record<string, unknown> = {
      ...meeting,
      transcript_status: 'validated',
      transcript_validated_at: '2026-08-04T00:00:00.000Z',
      transcript_json: JSON.stringify({
        lifecycleStatus: 'validated',
        segments: [
          {
            speaker: 'Me',
            startTime: 0,
            endTime: 4,
            text: 'Synthetic statement.',
          },
        ],
      }),
      transcript_integrity_json: JSON.stringify({
        schemaVersion: 2,
        state: 'validated',
        causes: [],
        validationProof: { gateVersion: 'canonical_integrity_v1' },
      }),
      downstream_processing_json: JSON.stringify({
        schemaVersion: 1,
        state: 'processing',
        stage: 'analysis',
      }),
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'CLAIM_DOWNSTREAM_PROCESSING') return true;
      if (channel === 'SAVE_MEETING') {
        current = { ...current, ...(payload as Record<string, unknown>) };
        return true;
      }
      if (channel === 'GENERATE_TITLE') return 'Synthetic meeting';
      if (channel === 'GENERATE_ANALYSIS_V2') {
        return { analysis: { analysis_schema_version: 3 }, signals: {} };
      }
      if (channel === 'EXTRACT_AND_PROCESS_ENTITIES') return { created: 0 };
      if (channel === 'REFRESH_KNOWLEDGE_FOR_MEETING_NOW') {
        return { requested: 1, completed: 1 };
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });

    const result = await retryMeetingTranscriptValidation(
      'synthetic-id',
      invoke,
    );

    expect(result).toEqual({ status: 'validated' });
    expect(invoke).not.toHaveBeenCalledWith(
      'TRANSCRIPTION_TRANSCRIBE_FINAL',
      expect.anything(),
      expect.anything(),
    );
    expect(
      JSON.parse(String(current.downstream_processing_json)),
    ).toMatchObject({ state: 'complete' });
  });

  it('persists a truthful analysis failure when the stage deadline expires', async () => {
    let current: Record<string, unknown> = {
      ...meeting,
      title: 'Synthetic planning review',
      transcript_status: 'validated',
      transcript_validated_at: '2026-08-04T00:00:00.000Z',
      transcript_json: JSON.stringify({
        lifecycleStatus: 'validated',
        segments: [{ speaker: 'Me', text: 'Synthetic statement.' }],
      }),
      downstream_processing_json: JSON.stringify({
        schemaVersion: 1,
        state: 'failed',
        stage: 'analysis',
      }),
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'CLAIM_DOWNSTREAM_PROCESSING') return true;
      if (channel === 'GENERATE_ANALYSIS_V2') {
        return await new Promise(() => undefined);
      }
      if (channel === 'SAVE_MEETING') {
        current = { ...current, ...(payload as Record<string, unknown>) };
        return true;
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });

    await expect(
      retryMeetingTranscriptValidation('synthetic-id', invoke, {
        downstreamStageTimeoutMs: { analysis: 5 },
      }),
    ).resolves.toEqual({ status: 'validated' });

    expect(
      JSON.parse(String(current.downstream_processing_json)),
    ).toMatchObject({
      state: 'failed',
      stage: 'analysis',
      failure: 'stage_timeout',
    });
  });

  it('replaces verified recovered checkpoints with a fresh Parakeet pass', async () => {
    const activityEvidence = await buildCaptureActivityEvidence(
      [
        { speaker: 'Me', startTime: 0, endTime: 4 },
        { speaker: 'Them', startTime: 5, endTime: 9 },
      ],
      activityProducer,
    );
    let current: Record<string, unknown> = {
      ...meeting,
      mixed_audio_path: null,
      transcript_json: JSON.stringify({
        schemaVersion: 2,
        lifecycleStatus: 'needs_attention',
        segments: [
          {
            id: 'mic-0',
            startTime: 0,
            endTime: 4,
            text: 'Synthetic local statement.',
            speaker: 'Me',
          },
          {
            id: 'system-0',
            startTime: 5,
            endTime: 9,
            text: 'Synthetic remote statement.',
            speaker: 'Them',
          },
        ],
      }),
      transcript_integrity_json: JSON.stringify({
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [{ code: 'recovered_awaiting_validation' }],
        evidenceProvenance: {
          kind: 'sealed_capture_activity_v2',
          digestSha256: activityEvidence.digestSha256,
        },
        activityEvidence,
        recovery: {
          source: 'capture_journal',
          journalSchemaVersion: 3,
          checkpointEvidenceVerified: true,
          gapDetected: false,
          sourceScope: 'multiple',
          acknowledgedChunkCount: 2,
          recoveredChunkCount: 2,
        },
      }),
      capture_journal_generation: 'checkpoint-generation-1',
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'AUDIO_CAPTURE_JOURNAL_VERIFY_TRANSCRIPT') {
        return {
          generation: 'checkpoint-generation-1',
          revision: 12,
          segmentCount: 2,
          sourceCoverageSegments: [
            { id: 'mic-source-0', startTime: 0, endTime: 4, speaker: 'Me' },
            {
              id: 'system-source-0',
              startTime: 5,
              endTime: 9,
              speaker: 'Them',
            },
          ],
        };
      }
      if (channel === 'FINALIZE_CHECKPOINT_TRANSCRIPT') {
        const finalization = payload as {
          journalGeneration: string;
          canonicalTranscriptJson: string;
          transcriptIntegrityJson: string;
          transcriptValidatedAt: string;
          downstreamRunId: string;
        };
        expect(finalization.journalGeneration).toBe('checkpoint-generation-1');
        current = {
          ...current,
          transcript_status: 'validated',
          transcript_json: finalization.canonicalTranscriptJson,
          transcript_integrity_json: finalization.transcriptIntegrityJson,
          transcript_validated_at: finalization.transcriptValidatedAt,
          downstream_processing_json: JSON.stringify({
            schemaVersion: 1,
            state: 'processing',
            transcriptValidatedAt: finalization.transcriptValidatedAt,
            runId: finalization.downstreamRunId,
            stage: 'analysis',
          }),
        };
        return 'committed_and_claimed';
      }
      if (channel === 'SAVE_MEETING') {
        current = { ...current, ...(payload as Record<string, unknown>) };
        return true;
      }
      if (channel === 'GENERATE_TITLE') return 'Recovered meeting';
      if (channel === 'GENERATE_ANALYSIS_V2') {
        return { markdown: 'Synthetic analysis', analysis: {}, signals: {} };
      }
      if (channel === 'EXTRACT_AND_PROCESS_ENTITIES') return { created: 0 };
      if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL') {
        return finalAudioPath(payload).includes('system')
          ? { segments: [rawSegment(5, 9, 'Synthetic remote statement.')] }
          : { segments: [rawSegment(0, 4, 'Synthetic local statement.')] };
      }
      if (channel === 'AUDIO_PROBE_DURATION') return 60;
      if (channel === 'REFRESH_KNOWLEDGE_FOR_MEETING_NOW')
        return { requested: 1, completed: 1 };
      throw new Error(`Unexpected channel: ${channel}`);
    });

    const result = await retryMeetingTranscriptValidation(
      'synthetic-id',
      invoke,
    );

    expect(result.status).toBe('validated');
    expect(invoke).toHaveBeenCalledWith(
      'TRANSCRIPTION_TRANSCRIBE_FINAL',
      expect.objectContaining({
        audioPath: '/synthetic/mic.wav',
        source: 'mic',
      }),
    );
    expect(invoke).toHaveBeenCalledWith(
      'AUDIO_PROBE_DURATION',
      '/synthetic/mic.wav',
    );
    expect(invoke).toHaveBeenCalledWith(
      'AUDIO_CAPTURE_JOURNAL_VERIFY_TRANSCRIPT',
      expect.objectContaining({ meetingId: 'synthetic-id' }),
    );
    expect(invoke).not.toHaveBeenCalledWith(
      'FINALIZE_CHECKPOINT_TRANSCRIPT',
      expect.anything(),
    );
    expect(validationInputs.at(-1) as { canonicalMode?: string }).toMatchObject(
      {
        canonicalMode: 'recovered_channels',
        checkpointEvidenceVerified: false,
        checkpointSourceSegments: [],
      },
    );
  });

  it('retranscribes preserved channels when verified checkpoints leave speech uncovered', async () => {
    const activityEvidence = await buildCaptureActivityEvidence(
      [
        { speaker: 'Me', startTime: 0, endTime: 8 },
        { speaker: 'Them', startTime: 10, endTime: 18 },
      ],
      activityProducer,
    );
    let current: Record<string, unknown> = {
      ...meeting,
      mixed_audio_path: null,
      transcript_json: JSON.stringify({
        schemaVersion: 2,
        lifecycleStatus: 'needs_attention',
        segments: [
          {
            id: 'system-0',
            startTime: 10,
            endTime: 18,
            text: 'Synthetic remote statement.',
            speaker: 'Them',
          },
        ],
      }),
      transcript_integrity_json: JSON.stringify({
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [{ code: 'local_speech_unaccounted' }],
        evidenceProvenance: {
          kind: 'sealed_capture_activity_v2',
          digestSha256: activityEvidence.digestSha256,
        },
        activityEvidence,
        recovery: {
          source: 'capture_journal',
          journalSchemaVersion: 3,
          checkpointEvidenceVerified: true,
          gapDetected: false,
        },
      }),
      capture_journal_generation: 'checkpoint-generation-2',
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'AUDIO_CAPTURE_JOURNAL_VERIFY_TRANSCRIPT') {
        return {
          generation: 'checkpoint-generation-2',
          revision: 13,
          segmentCount: 1,
          sourceCoverageSegments: [
            {
              id: 'system-source-0',
              startTime: 10,
              endTime: 18,
              speaker: 'Them',
            },
          ],
        };
      }
      if (channel === 'AUDIO_PROBE_DURATION') return 60;
      if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL') {
        return finalAudioPath(payload).includes('system')
          ? { segments: [rawSegment(10, 18, 'Synthetic remote statement.')] }
          : { segments: [rawSegment(0, 8, 'Synthetic local statement.')] };
      }
      if (channel === 'SAVE_MEETING') {
        current = { ...current, ...(payload as Record<string, unknown>) };
        return true;
      }
      if (channel === 'GENERATE_TITLE') return 'Recovered meeting';
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

    expect(result.status).toBe('validated');
    expect(invoke).toHaveBeenCalledWith(
      'TRANSCRIPTION_TRANSCRIBE_FINAL',
      expect.objectContaining({
        audioPath: '/synthetic/mic.wav',
        source: 'mic',
      }),
    );
    expect(validationInputs.at(-1)).toEqual(
      expect.objectContaining({ canonicalMode: 'recovered_channels' }),
    );
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
      if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL') {
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
        if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL') {
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
      if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL') {
        return finalAudioPath(payload).includes('mic')
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
      if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL') {
        const audioPath = finalAudioPath(payload);
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
      if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL') {
        const audioPath = finalAudioPath(payload);
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

    expect(result.status).toBe('validated');
    expect(
      JSON.parse(String(current.transcript_integrity_json))
        .activityEvidenceSource,
    ).toBe('legacy_provisional_segments');
    expect(invoke).toHaveBeenCalledWith(
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
      if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL') {
        const audioPath = finalAudioPath(payload);
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
      if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL') {
        const audioPath = finalAudioPath(payload);
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

  it('verifies sealed v2 activity windows and preserves the exact envelope after validation', async () => {
    const windows = [
      { startTime: 4.25, endTime: 12.75, speaker: 'Me' as const },
      { startTime: 18.5, endTime: 27.125, speaker: 'Them' as const },
    ];
    const sealedEvidence = await buildCaptureActivityEvidence(
      windows,
      activityProducer,
    );
    let current: Record<string, unknown> = {
      ...meeting,
      transcript_integrity_json: JSON.stringify({
        activityEvidenceSource: 'capture_activity_v2',
        activityEvidence: sealedEvidence,
        reasons: [],
      }),
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'AUDIO_PROBE_DURATION') return 60;
      if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL') {
        if (finalAudioPath(payload).includes('system')) {
          return { segments: [rawSegment(18.5, 27.125, 'Remote statement.')] };
        }
        if (finalAudioPath(payload).includes('mic')) {
          return { segments: [rawSegment(4.25, 12.75, 'Local statement.')] };
        }
        return {
          segments: [
            rawSegment(4.25, 12.75, 'Local statement.'),
            rawSegment(18.5, 27.125, 'Remote statement.'),
          ],
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

    expect(result.status).toBe('validated');
    expect(validationInputs).toHaveLength(1);
    expect(
      (validationInputs[0] as { activityWindows: unknown }).activityWindows,
    ).toEqual(windows);
    const savedIntegrity = JSON.parse(
      String(current.transcript_integrity_json),
    ) as Record<string, unknown>;
    expect(savedIntegrity.activityEvidenceSource).toBe('capture_activity_v2');
    expect(savedIntegrity.activityEvidence).toEqual(sealedEvidence);
  });

  it.each([
    {
      name: 'missing',
      evidence: undefined,
      source: 'capture_activity_missing',
      reason: 'capture_activity_missing',
    },
    {
      name: 'malformed',
      evidence: { source: 'capture_activity_v2' },
      source: 'capture_activity_corrupt',
      reason: 'capture_activity_corrupt',
    },
    {
      name: 'unsupported',
      evidence: {
        schemaVersion: 3,
        source: 'capture_activity_v2',
        serializationVersion: 1,
      },
      source: 'capture_activity_unsupported',
      reason: 'capture_activity_unsupported',
    },
    {
      name: 'digest mismatch',
      evidence: null,
      source: 'capture_activity_corrupt',
      reason: 'capture_activity_corrupt',
    },
  ])(
    'fails closed for $name sealed v2 evidence without provisional fallback',
    async ({ evidence, source, reason, name }) => {
      const validEvidence = await buildCaptureActivityEvidence(
        [{ startTime: 2, endTime: 8, speaker: 'Me' }],
        activityProducer,
      );
      const storedEvidence =
        name === 'digest mismatch'
          ? { ...validEvidence, digestSha256: '0'.repeat(64) }
          : evidence;
      let current: Record<string, unknown> = {
        ...meeting,
        transcript_integrity_json: JSON.stringify({
          activityEvidenceSource: 'capture_activity_v2',
          ...(storedEvidence === undefined
            ? {}
            : { activityEvidence: storedEvidence }),
          reasons: [],
        }),
        transcript_json: JSON.stringify({
          segments: [
            {
              speaker: 'Me',
              startTime: 0,
              endTime: 20,
              text: 'Provisional content must not become evidence.',
            },
          ],
        }),
      };
      const invoke = vi.fn(async (channel: string, payload?: unknown) => {
        if (channel === 'GET_MEETING') return current;
        if (channel === 'AUDIO_PROBE_DURATION') return 60;
        if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL')
          return { segments: [] };
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
      expect(validationInputs).toHaveLength(1);
      expect(
        (validationInputs[0] as { activityWindows: unknown }).activityWindows,
      ).toEqual([]);
      const savedIntegrity = JSON.parse(
        String(current.transcript_integrity_json),
      ) as { activityEvidenceSource: unknown; reasons: unknown[] };
      expect(savedIntegrity.activityEvidenceSource).toBe(source);
      expect(savedIntegrity.reasons).toContain(reason);
      expect(JSON.stringify(savedIntegrity)).not.toContain(
        'Provisional content must not become evidence.',
      );
    },
  );

  it.each(['capture_activity_unsupported', 'capture_activity_v3'])(
    'fails closed for declared unsupported source %s without provisional fallback',
    async (activityEvidenceSource) => {
      let current: Record<string, unknown> = {
        ...meeting,
        transcript_integrity_json: JSON.stringify({
          activityEvidenceSource,
          reasons: [],
        }),
        transcript_json: JSON.stringify({
          segments: [
            {
              speaker: 'Me',
              startTime: 0,
              endTime: 20,
              text: 'Provisional content must not become evidence.',
            },
          ],
        }),
      };
      const invoke = vi.fn(async (channel: string, payload?: unknown) => {
        if (channel === 'GET_MEETING') return current;
        if (channel === 'AUDIO_PROBE_DURATION') return 60;
        if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL')
          return { segments: [] };
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
      expect(validationInputs).toHaveLength(1);
      expect(
        (validationInputs[0] as { activityWindows: unknown }).activityWindows,
      ).toEqual([]);
      const savedIntegrity = JSON.parse(
        String(current.transcript_integrity_json),
      ) as { activityEvidenceSource: unknown; reasons: unknown[] };
      expect(savedIntegrity.activityEvidenceSource).toBe(
        'capture_activity_unsupported',
      );
      expect(savedIntegrity.reasons).toContain('capture_activity_unsupported');
      expect(JSON.stringify(savedIntegrity)).not.toContain(
        'Provisional content must not become evidence.',
      );
    },
  );

  it('fails closed when an unsupported declaration wraps a valid v1 envelope', async () => {
    let current: Record<string, unknown> = {
      ...meeting,
      transcript_integrity_json: JSON.stringify({
        activityEvidenceSource: 'capture_activity_v3',
        activityEvidence: {
          schemaVersion: 1,
          source: 'capture_activity_v1',
          windows: [{ startTime: 2, endTime: 8, speaker: 'Me' }],
        },
        reasons: [],
      }),
      transcript_json: JSON.stringify({
        segments: [
          {
            speaker: 'Them',
            startTime: 10,
            endTime: 20,
            text: 'Provisional content must not become evidence.',
          },
        ],
      }),
    };
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_MEETING') return current;
      if (channel === 'AUDIO_PROBE_DURATION') return 60;
      if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL') return { segments: [] };
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
    expect(validationInputs).toHaveLength(1);
    expect(
      (validationInputs[0] as { activityWindows: unknown }).activityWindows,
    ).toEqual([]);
    const savedIntegrity = JSON.parse(
      String(current.transcript_integrity_json),
    ) as { activityEvidenceSource: unknown; reasons: unknown[] };
    expect(savedIntegrity.activityEvidenceSource).toBe(
      'capture_activity_unsupported',
    );
    expect(savedIntegrity.reasons).toContain('capture_activity_unsupported');
    expect(JSON.stringify(savedIntegrity)).not.toContain(
      'Provisional content must not become evidence.',
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
      if (channel === 'TRANSCRIPTION_TRANSCRIBE_FINAL') {
        return await new Promise(() => undefined);
      }
      if (channel === 'TRANSCRIPTION_CANCEL_FINAL') return { cancelled: true };
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
      'TRANSCRIPTION_CANCEL_FINAL',
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

describe('shouldAutoProcessMeetingAnalysis', () => {
  it('starts background processing for an unanalyzed preserved recording', () => {
    expect(shouldAutoProcessMeetingAnalysis(meeting)).toBe(true);
  });

  it('resumes analysis interrupted after transcript validation', () => {
    expect(
      shouldAutoProcessMeetingAnalysis({
        ...meeting,
        transcript_status: 'validated',
        downstream_processing_json: JSON.stringify({
          schemaVersion: 1,
          state: 'processing',
          stage: 'analysis',
        }),
      }),
    ).toBe(true);
  });

  it('repairs a generic title on an otherwise complete validated meeting', () => {
    expect(
      shouldAutoProcessMeetingAnalysis({
        ...meeting,
        title: 'Recovered recording',
        transcript_status: 'validated',
        analysis_json: JSON.stringify({ overview: 'existing' }),
        downstream_processing_json: JSON.stringify({
          schemaVersion: 1,
          state: 'complete',
        }),
      }),
    ).toBe(true);
  });

  it('selects a capture-gap transcript until partial intelligence completes', () => {
    const captureGap = {
      ...meeting,
      title: 'Recovered recording',
      transcript_json: JSON.stringify({
        lifecycleStatus: 'needs_attention',
        segments: [{ speaker: 'Me', text: 'Synthetic statement.' }],
      }),
      transcript_integrity_json: JSON.stringify({
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [{ code: 'capture_gap_detected' }],
      }),
      capture_journal_generation: 'journal-1',
    };
    expect(shouldAutoProcessMeetingAnalysis(captureGap)).toBe(true);
    expect(
      shouldAutoProcessMeetingAnalysis({
        ...captureGap,
        title: 'Recovered Planning Discussion',
      }),
    ).toBe(true);
    expect(
      shouldAutoProcessMeetingAnalysis({
        ...captureGap,
        title: 'Recovered Planning Discussion',
        analysis_json: JSON.stringify({ overview: 'partial' }),
        downstream_processing_json: JSON.stringify({
          schemaVersion: 2,
          state: 'complete',
          source: { kind: 'partial_capture_gap' },
        }),
      }),
    ).toBe(false);
  });

  it('does not replace existing analysis or retry recovery-required meetings', () => {
    expect(
      shouldAutoProcessMeetingAnalysis({
        ...meeting,
        title: 'Existing analyzed meeting',
        analysis_json: JSON.stringify({ overview: 'existing' }),
      }),
    ).toBe(false);
    expect(
      shouldAutoProcessMeetingAnalysis({
        ...meeting,
        finalization_status: 'recovery_required',
      }),
    ).toBe(false);
  });
});
