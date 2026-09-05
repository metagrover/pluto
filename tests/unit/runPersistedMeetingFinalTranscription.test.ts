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
    source: 'recovered_channel_acoustic_v2' as const,
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

  it.each([
    'available',
    'failed_during_capture',
    'unavailable_at_start',
    'stale',
    'missing',
  ])(
    'passes %s journal capture evidence through the persisted production boundary',
    async (status) => {
      const meeting = {
        id: 'source-check',
        capture_journal_generation: 'generation-1',
        transcript_json: '{}',
        transcript_integrity_json: JSON.stringify({
          evidenceProvenance: { kind: 'sealed_capture_activity_v2' },
        }),
      } as Meeting;
      const invoke = vi.fn(async (channel: string) => {
        if (channel === 'AUDIO_CAPTURE_JOURNAL_READ') {
          if (status === 'missing') throw new Error('missing');
          return {
            schemaVersion: 3,
            generation: status === 'stale' ? 'old' : 'generation-1',
            lifecycleState: 'sealed',
            sourceAvailability: {
              system: status === 'stale' ? 'available' : status,
            },
            intervals: [{ sources: { system: { disposition: 'captured' } } }],
          };
        }
        return null;
      });
      mocks.runFinal.mockImplementation(async (input) => {
        expect(input.captureEvidence.systemCaptureIncomplete).toBe(
          status !== 'available',
        );
        return { status: 'needs_attention' };
      });
      await runPersistedMeetingFinalTranscription(meeting, invoke);
      expect(invoke).toHaveBeenCalledWith('AUDIO_CAPTURE_JOURNAL_READ', {
        meetingId: 'source-check',
      });
    },
  );

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

    let releaseDownstream: (() => void) | undefined;
    mocks.processDownstream.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseDownstream = () => resolve({ status: 'published' });
      }),
    );
    const onTranscriptCommitted = vi.fn(async () => undefined);
    const attempt = runPersistedMeetingFinalTranscription(meeting, invoke, {
      runId: 'run-1',
      onTranscriptCommitted,
    });
    const outcome = await Promise.race([
      attempt,
      new Promise<'downstream-still-running'>((resolve) =>
        setTimeout(() => resolve('downstream-still-running'), 25),
      ),
    ]);
    releaseDownstream?.();

    expect(outcome).toEqual({ status: 'validated' });
    await attempt;
    expect(onTranscriptCommitted).toHaveBeenCalledOnce();
    expect(mocks.runFinal.mock.calls[0]?.[0]).toMatchObject({
      preserveProvisionalText: false,
    });
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
    expect(persisted.transcription.diarization).toBe(false);
    expect(persisted.speakerAttribution).toMatchObject({
      source: 'recovered_channel_acoustic_v2',
      mappingApplied: true,
    });
    expect(
      JSON.parse(
        (commitCall?.[1] as { transcriptIntegrityJson: string })
          .transcriptIntegrityJson,
      ),
    ).toMatchObject({ speakerAttributionVerified: true });
  });

  it.each([false, true])(
    'preserves saved text only for automatic label repair (manual retry: %s)',
    async (manualRetry) => {
      const meeting = {
        id: 'meeting-speaker-retry',
        title: 'Meeting',
        created_at: '2026-08-15T00:00:00.000Z',
        started_at: '2026-08-15T00:00:00.000Z',
        duration_seconds: 60,
        audio_path: '/approved/mic.wav',
        mixed_audio_path: '/approved/mixed.wav',
        system_audio_path: '/approved/system.wav',
        capture_journal_generation: 'generation-1',
        transcript_status: 'validated',
        transcript_json: JSON.stringify({
          segments: [
            { text: 'saved words', startTime: 0, endTime: 1, speaker: 'Them' },
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
      mocks.runFinal.mockResolvedValue({ status: 'cancelled' });
      const invoke = vi.fn(async (channel: string) =>
        channel === 'GET_TRANSCRIPTION_VOCABULARY' ? { terms: [] } : null,
      );

      await runPersistedMeetingFinalTranscription(meeting, invoke, {
        runId: 'run-speaker-retry',
        manualRetry,
      });

      expect(mocks.runFinal.mock.calls[0]?.[0]).toMatchObject({
        preserveProvisionalText: !manualRetry,
        provisionalSegments: [
          expect.objectContaining({ text: 'saved words', speaker: 'Them' }),
        ],
      });
    },
  );

  it('rebuilds sealed System audio and its mix before an explicit historical retry', async () => {
    const meeting = {
      id: 'meeting-mixed-rate-retry',
      title: 'Meeting',
      created_at: '2026-09-04T00:00:00.000Z',
      duration_seconds: 60,
      audio_path: '/approved/mic.wav',
      system_audio_path: '/damaged/system.wav',
      mixed_audio_path: '/damaged/mix.wav',
      capture_journal_generation: 'generation-1',
      transcript_status: 'needs_attention',
      transcript_validated_at: '2026-09-04T00:01:00.000Z',
      transcript_json: JSON.stringify({ segments: [] }),
      transcript_integrity_json: JSON.stringify({
        evidenceProvenance: { kind: 'sealed_capture_activity_v2' },
        activityEvidence: { private: 'verified by parser' },
      }),
    } as Meeting;
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'AUDIO_CAPTURE_JOURNAL_READ') {
        return {
          schemaVersion: 3,
          lifecycleState: 'sealed',
          generation: 'generation-1',
          sourceAvailability: { system: 'available' },
          intervals: [{ sources: { system: { disposition: 'captured' } } }],
        };
      }
      if (channel === 'AUDIO_CAPTURE_JOURNAL_STITCH_SOURCE') {
        expect(args[0]).toMatchObject({
          meetingId: 'meeting-mixed-rate-retry',
          source: 'system',
        });
        return '/repaired/system.wav';
      }
      if (channel === 'AUDIO_MIX_WAV') {
        expect(args[0]).toEqual({
          inputPaths: ['/approved/mic.wav', '/repaired/system.wav'],
          outputTag: 'meeting-mixed-rate-retry-repaired-mix',
        });
        return '/repaired/mix.wav';
      }
      if (channel === 'SAVE_MEETING') {
        expect(args[0]).toMatchObject({
          audio_path: '/approved/mic.wav',
          system_audio_path: '/repaired/system.wav',
          mixed_audio_path: '/repaired/mix.wav',
          transcript_validated_at: undefined,
        });
        return true;
      }
      if (channel === 'GET_TRANSCRIPTION_VOCABULARY') return { terms: [] };
      return null;
    });
    mocks.runFinal.mockImplementation(async (input) => {
      expect(input).toMatchObject({
        micAudioPath: '/approved/mic.wav',
        systemAudioPath: '/repaired/system.wav',
        mixedAudioPath: '/repaired/mix.wav',
      });
      return { status: 'cancelled' };
    });

    await runPersistedMeetingFinalTranscription(meeting, invoke, {
      manualRetry: true,
      rebuildSealedAudio: true,
    });

    expect(invoke).not.toHaveBeenCalledWith(
      'AUDIO_DELETE_FILES',
      expect.anything(),
    );
  });

  it('keeps the persisted meeting untouched when historical audio rebuilding fails', async () => {
    const meeting = {
      id: 'meeting-rebuild-failure',
      audio_path: '/approved/mic.wav',
      system_audio_path: '/damaged/system.wav',
      mixed_audio_path: '/damaged/mix.wav',
      capture_journal_generation: 'generation-1',
    } as Meeting;
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'AUDIO_CAPTURE_JOURNAL_READ') {
        return {
          schemaVersion: 3,
          lifecycleState: 'sealed',
          generation: 'generation-1',
        };
      }
      if (channel === 'AUDIO_CAPTURE_JOURNAL_STITCH_SOURCE') {
        return '/repaired/system.wav';
      }
      if (channel === 'AUDIO_MIX_WAV') return null;
      if (channel === 'AUDIO_DELETE_FILES') return { deleted: 1 };
      throw new Error(`Unexpected channel: ${channel}`);
    });

    await expect(
      runPersistedMeetingFinalTranscription(meeting, invoke, {
        manualRetry: true,
        rebuildSealedAudio: true,
      }),
    ).rejects.toThrow('sealed_capture_mix_rebuild_failed');

    expect(invoke).toHaveBeenCalledWith('AUDIO_DELETE_FILES', [
      '/repaired/system.wav',
    ]);
    expect(invoke).not.toHaveBeenCalledWith('SAVE_MEETING', expect.anything());
    expect(mocks.runFinal).not.toHaveBeenCalled();
  });

  it.each(['preserved', 'empty', 'missing', 'invalid'] as const)(
    'keeps %s live evidence separate from canonical text on a successful retry',
    async (kind) => {
      const canonical = [
        {
          text: 'saved canonical words',
          startTime: 0,
          endTime: 1,
          speaker: 'Them',
        },
      ];
      const originalLive = [
        {
          text: 'raw microphone echo',
          startTime: 0,
          endTime: 1,
          speaker: 'Me',
          source: 'mic',
          providerSegmentId: 'raw-mic-1',
        },
        {
          text: 'raw system speech',
          startTime: 0,
          endTime: 1,
          speaker: 'Them',
          source: 'system',
          providerSegmentId: 'raw-system-1',
        },
      ];
      const liveSegments =
        kind === 'preserved'
          ? originalLive
          : kind === 'empty'
            ? []
            : kind === 'invalid'
              ? [{ text: 'invalid timing', startTime: 'bad', endTime: 1 }]
              : undefined;
      const meeting = {
        id: 'retry-live-evidence',
        transcript_status: 'validated',
        capture_journal_generation: 'generation-1',
        transcript_json: JSON.stringify({ segments: canonical, liveSegments }),
        transcript_integrity_json: JSON.stringify({
          evidenceProvenance: {
            kind: 'sealed_capture_activity_v2',
            digestSha256: 'digest',
          },
          activityEvidence: { private: 'verified by parser' },
        }),
      } as Meeting;
      const before = meeting.transcript_json;
      const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
        if (channel === 'COMMIT_FINAL_TRANSCRIPTION') {
          return {
            committed: true,
            transcriptJson: (args[0] as { canonicalTranscriptJson: string })
              .canonicalTranscriptJson,
          };
        }
        return null;
      });
      mocks.runFinal.mockImplementation(async (input, dependencies) => {
        expect(input.provisionalSegments).toEqual(canonical);
        await dependencies.commitCanonical({
          segments: canonical.map((segment) => ({
            ...segment,
            speaker: 'Remote Speaker 1',
          })),
          integrity: {},
          metadata: finalMetadata,
        });
        return { status: 'validated' };
      });

      await runPersistedMeetingFinalTranscription(meeting, invoke, {
        manualRetry: true,
      });
      const commit = invoke.mock.calls.find(
        ([channel]) => channel === 'COMMIT_FINAL_TRANSCRIPTION',
      )?.[1] as { canonicalTranscriptJson: string };
      const saved = JSON.parse(commit.canonicalTranscriptJson);
      expect(saved.liveSegments).toEqual(
        kind === 'preserved' ? originalLive : kind === 'empty' ? [] : canonical,
      );
      expect(saved.segments[0].speaker).toBe('Remote Speaker 1');
      expect(meeting.transcript_json).toBe(before);
    },
  );

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
