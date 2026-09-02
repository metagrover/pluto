import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Meeting } from '../../src/types';

const mocks = vi.hoisted(() => ({
  parseEvidence: vi.fn(),
  runFinal: vi.fn(),
  processDownstream: vi.fn(),
}));

const finalMetadata = {
  policy: 'parakeet_final_v1' as const,
  engine: 'parakeet_coreml' as const,
  model: 'parakeet-tdt-0.6b-v3' as const,
  computeUnits: 'cpu_and_neural_engine' as const,
  computeType: 'int8' as const,
  language: 'en',
  elapsedMs: 10,
  sources: { mic: 'speech' as const, system: 'no_speech' as const },
  sourceDetails: {
    mic: {
      outcome: 'speech' as const,
      providerVersion: 'test-provider',
      elapsedMs: 10,
      vadStatus: 'speech' as const,
      speechSeconds: 1,
      segmentCount: 1,
      wordCount: 1,
    },
  },
  providerVersions: ['test-provider'],
  modelBundleVersions: [],
  warnings: [],
  vocabularyCount: 1,
  reconciliation: {
    policyVersion: 'cross_channel_skew_v1' as const,
    skewApplied: false,
    estimatedOffsetMs: 0,
    anchorCount: 0,
    confidence: 0,
    droppedMicWordCount: 0,
    collapsedSequenceCount: 0,
    droppedExactDuplicateSegmentCount: 0,
    droppedEmbeddedMicFragmentCount: 0,
  },
  speakerAttribution: {
    source: 'offline_diarization_acoustic_v1' as const,
    confidence: 1,
    diarizationAttempted: true,
    mappingApplied: true,
  },
  speakerEvidence: {
    provenance: {
      modelIdentifier: 'speaker-diarization-offline-v1',
      modelRevision: 'a'.repeat(40),
      artifactDigest: 'b'.repeat(64),
      runtimeVersion: 'fluidaudio-test',
    },
    timings: { diarizationMs: 10, energyAnalysisMs: 2, totalMs: 12 },
  },
};

vi.mock('../../src/utils/transcriptActivityEvidence', () => ({
  parseCaptureActivityEvidence: mocks.parseEvidence,
}));
vi.mock('../../src/services/finalTranscription/runFinalTranscription', () => ({
  runFinalTranscription: mocks.runFinal,
}));
vi.mock('../../src/services/processValidatedMeetingDownstream', () => ({
  processValidatedMeetingDownstream: mocks.processDownstream,
}));

import { runPersistedMeetingFinalTranscription } from '../../src/services/finalTranscription/runPersistedMeetingFinalTranscription';

describe('runPersistedMeetingFinalTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseEvidence.mockResolvedValue({
      ok: true,
      evidence: {
        digestSha256: 'digest',
        windows: [{ startTime: 0, endTime: 1, speaker: 'Me' }],
      },
    });
    mocks.processDownstream.mockResolvedValue({ status: 'complete' });
  });

  it('reconstructs sealed inputs and hands the exact canonical commit downstream', async () => {
    const meeting = {
      id: 'meeting-1',
      title: 'Meeting',
      created_at: '2026-08-15T00:00:00.000Z',
      started_at: '2026-08-15T00:00:00.000Z',
      duration_seconds: 60,
      audio_path: '/approved/mic.wav',
      mixed_audio_path: '/approved/mixed.wav',
      system_audio_path: '/approved/system.wav',
      capture_journal_generation: 'generation-1',
      transcript_status: 'provisional',
      transcript_json: JSON.stringify({
        transcription: {
          language: 'en',
          vocabularyHintPolicyVersion: 'known-people-v1',
          vocabularyTerms: ['Known Person'],
        },
        segments: [
          { text: 'preview', startTime: 0, endTime: 1, speaker: 'Me' },
        ],
      }),
      transcript_integrity_json: JSON.stringify({
        evidenceProvenance: {
          kind: 'sealed_capture_activity_v2',
          digestSha256: 'digest',
        },
        activityEvidence: { private: 'verified by parser' },
      }),
    } as Meeting;
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'GET_TRANSCRIPTION_VOCABULARY') {
        throw new Error('persisted vocabulary must survive process restart');
      }
      if (channel === 'GET_CAPTURE_COMPUTE_POLICY') {
        return {
          thermalState: 'nominal',
          freeMemoryBytes: 8 * 1024 ** 3,
          totalMemoryBytes: 16 * 1024 ** 3,
        };
      }
      if (channel === 'COMMIT_FINAL_TRANSCRIPTION') {
        const request = args[0] as { canonicalTranscriptJson: string };
        return {
          committed: true,
          transcriptJson: request.canonicalTranscriptJson,
        };
      }
      if (channel === 'TRANSCRIPTION_SPEAKER_EVIDENCE') {
        return {
          turns: [{ startTime: 0, endTime: 1, cluster: 'S1' }],
          energyWindows: [
            { startTime: 0, endTime: 0.1, micRms: 0.2, systemRms: 0 },
          ],
          provenance: finalMetadata.speakerEvidence.provenance,
          timings: finalMetadata.speakerEvidence.timings,
          windowSeconds: 0.1,
        };
      }
      return true;
    });
    mocks.runFinal.mockImplementation(async (input, dependencies) => {
      expect(input).toMatchObject({
        meetingId: 'meeting-1',
        captureEvidence: { sealed: true, generation: 'generation-1' },
        micAudioPath: '/approved/mic.wav',
        mixedAudioPath: '/approved/mixed.wav',
        systemAudioPath: '/approved/system.wav',
        language: 'en',
        vocabulary: ['Known Person'],
        vocabularyPolicyVersion: 'known-people-v1',
      });
      await dependencies.speakerEvidence({
        meetingId: 'meeting-1',
        mixedAudioPath: '/approved/mixed.wav',
        micAudioPath: '/approved/mic.wav',
        systemAudioPath: '/approved/system.wav',
      });
      const committed = await dependencies.commitCanonical({
        segments: [
          {
            text: 'canonical',
            startTime: 0,
            endTime: 1,
            speaker: 'Speaker',
          },
        ],
        integrity: {},
        metadata: finalMetadata,
      });
      await dependencies.startAnalysis({
        meetingId: 'meeting-1',
        transcript: committed.transcript,
      });
      return { status: 'validated' };
    });

    const outcome = await runPersistedMeetingFinalTranscription(
      meeting,
      invoke,
      { runId: 'run-1' },
    );

    expect(outcome).toEqual({ status: 'validated' });
    expect(invoke).not.toHaveBeenCalledWith(
      'GET_TRANSCRIPTION_VOCABULARY',
      expect.anything(),
    );
    expect(mocks.processDownstream).toHaveBeenCalledWith('meeting-1', invoke);
    const commitCall = invoke.mock.calls.find(
      ([channel]) => channel === 'COMMIT_FINAL_TRANSCRIPTION',
    );
    const persisted = JSON.parse(
      (commitCall?.[1] as { canonicalTranscriptJson: string })
        .canonicalTranscriptJson,
    );
    expect(persisted.liveSegments).toEqual([
      { text: 'preview', startTime: 0, endTime: 1, speaker: 'Me' },
    ]);
    expect(persisted.transcription.diarization).toBe(true);
    expect(persisted.speakerAttribution).toMatchObject({
      source: 'offline_diarization_acoustic_v1',
      mappingApplied: true,
    });
    expect(
      JSON.parse(
        (commitCall?.[1] as { transcriptIntegrityJson: string })
          .transcriptIntegrityJson,
      ),
    ).toMatchObject({ speakerAttributionVerified: true });
  });

  it('rejects invalid final metadata before canonical commit or downstream work', async () => {
    const meeting = {
      id: 'meeting-invalid-final',
      title: 'Meeting',
      created_at: '2026-08-15T00:00:00.000Z',
      started_at: '2026-08-15T00:00:00.000Z',
      duration_seconds: 60,
      audio_path: '/approved/mic.wav',
      mixed_audio_path: '/approved/mixed.wav',
      system_audio_path: '/approved/system.wav',
      capture_journal_generation: 'generation-1',
      transcript_status: 'provisional',
      transcript_json: JSON.stringify({ segments: [] }),
      transcript_integrity_json: JSON.stringify({
        evidenceProvenance: { kind: 'sealed_capture_activity_v2' },
        activityEvidence: { private: 'verified by parser' },
      }),
    } as Meeting;
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'GET_TRANSCRIPTION_VOCABULARY') return { terms: [] };
      throw new Error(`Unexpected channel: ${channel}`);
    });
    mocks.runFinal.mockImplementation(async (_input, dependencies) => {
      await dependencies.commitCanonical({
        meetingId: 'meeting-invalid-final',
        expectedCaptureGeneration: 'generation-1',
        segments: [
          { text: 'canonical', startTime: 0, endTime: 1, speaker: 'Speaker' },
        ],
        integrity: {},
        metadata: { ...finalMetadata, unexpectedProducerField: true },
      });
      return { status: 'validated' };
    });

    await expect(
      runPersistedMeetingFinalTranscription(meeting, invoke, {
        runId: 'run-invalid-final',
      }),
    ).rejects.toThrow(
      'invalid_transcript_trust_candidate:final_transcription_validated:invalid_shape',
    );
    expect(invoke).not.toHaveBeenCalledWith(
      'COMMIT_FINAL_TRANSCRIPTION',
      expect.anything(),
    );
    expect(mocks.processDownstream).not.toHaveBeenCalled();
  });
});
