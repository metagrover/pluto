import { describe, expect, it } from 'vitest';

import {
  type TranscriptTrustMeetingFields,
  buildTranscriptTrustCapabilities,
  canUseTranscriptTrustState,
  parseMeetingDownstreamProcessing,
  parseTranscriptTrustEnvelope,
  resolveTranscriptTrustState,
} from '../../src/utils/transcriptTrustState';

const projections = {
  transcriptStatus: 'needs_attention' as const,
  transcriptValidatedAt: null,
  payloadLifecycleStatus: 'needs_attention' as const,
};

const meeting = (
  envelope: Record<string, unknown>,
  overrides: Partial<TranscriptTrustMeetingFields> = {},
): TranscriptTrustMeetingFields => ({
  transcript_status: 'needs_attention',
  transcript_integrity_json: JSON.stringify(envelope),
  transcript_validated_at: null,
  transcript_json: JSON.stringify({
    lifecycleStatus: 'needs_attention',
    segments: [],
  }),
  finalization_status: 'finalized',
  ...overrides,
});

const capabilities = buildTranscriptTrustCapabilities({
  hasUsableMicArtifact: true,
  hasUsableSystemArtifact: true,
  hasUsableMixArtifact: false,
  hasSupportedActivityEvidence: true,
  micActivitySeconds: 5,
  systemActivitySeconds: 5,
  recoverySource: 'capture_journal',
  hasCaptureRecoveryHandler: false,
  canRestoreCaptureGap: false,
  hasExistingTranscript: false,
  hasExistingDerivedArtifacts: false,
});

describe('transcriptTrustState', () => {
  const finalTranscriptionResult = {
    policy: 'parakeet_final_v1',
    engine: 'parakeet_coreml',
    model: 'parakeet-tdt-0.6b-v3',
    computeType: 'int8',
    computeUnits: 'cpu_and_neural_engine',
    language: 'en',
    elapsedMs: 1200,
    warnings: [],
    sources: { mic: 'speech', system: 'speech', mix: 'unknown' },
    sourceDetails: {
      mic: {
        outcome: 'speech',
        providerVersion: 'FluidAudio-0.15.5',
        elapsedMs: 500,
        vadStatus: 'speech',
        speechSeconds: 10,
        segmentCount: 2,
        wordCount: 20,
      },
      system: {
        outcome: 'speech',
        providerVersion: 'FluidAudio-0.15.5',
        elapsedMs: 700,
        vadStatus: 'speech',
        speechSeconds: 15,
        segmentCount: 3,
        wordCount: 30,
      },
    },
    providerVersions: ['FluidAudio-0.15.5'],
    modelBundleVersions: ['bundle-v1'],
    vocabularyCount: 2,
  };

  it('accepts content-free final provider evidence and rejects extra content', () => {
    const envelope = {
      schemaVersion: 2,
      state: 'validated',
      causes: [],
      evidenceProvenance: { kind: 'sealed_capture_activity_v2' },
      validationProof: {
        gateVersion: 'canonical_integrity_v1',
        validatedAt: '2026-08-15T00:00:00.000Z',
      },
      finalTranscription: {
        schemaVersion: 1,
        state: 'complete',
        policy: 'parakeet_final_v1',
        captureGeneration: 'generation-1',
      },
      finalTranscriptionResult,
    };
    const validatedProjections = {
      transcriptStatus: 'validated' as const,
      transcriptValidatedAt: '2026-08-15T00:00:00.000Z',
      payloadLifecycleStatus: 'validated' as const,
    };
    expect(
      parseTranscriptTrustEnvelope(
        JSON.stringify(envelope),
        validatedProjections,
      ),
    ).toMatchObject({ ok: true });
    expect(
      parseTranscriptTrustEnvelope(
        JSON.stringify({
          ...envelope,
          finalTranscriptionResult: {
            ...finalTranscriptionResult,
            reconciliation: {
              policyVersion: 'cross_channel_skew_v1',
              skewApplied: true,
              estimatedOffsetMs: 1200,
              anchorCount: 4,
              confidence: 0.8,
              droppedMicWordCount: 35,
              collapsedSequenceCount: 6,
              droppedExactDuplicateSegmentCount: 2,
              droppedEmbeddedMicFragmentCount: 3,
            },
          },
        }),
        validatedProjections,
      ),
    ).toMatchObject({ ok: true });
    expect(
      parseTranscriptTrustEnvelope(
        JSON.stringify({
          ...envelope,
          finalTranscriptionResult: {
            ...finalTranscriptionResult,
            reconciliation: {
              policyVersion: 'cross_channel_skew_v1',
              skewApplied: true,
              estimatedOffsetMs: 1200,
              anchorCount: 4,
              confidence: 2,
              droppedMicWordCount: 35,
              collapsedSequenceCount: 6,
            },
          },
        }),
        validatedProjections,
      ),
    ).toMatchObject({ ok: false, failure: 'invalid_shape' });
    expect(
      parseTranscriptTrustEnvelope(
        JSON.stringify({
          ...envelope,
          finalTranscriptionResult: {
            ...finalTranscriptionResult,
            transcript: 'private content',
          },
        }),
        validatedProjections,
      ),
    ).toMatchObject({ ok: false, failure: 'invalid_shape' });
    expect(
      parseTranscriptTrustEnvelope(
        JSON.stringify({
          ...envelope,
          finalTranscriptionResult: {
            ...finalTranscriptionResult,
            sourceDetails: {
              ...finalTranscriptionResult.sourceDetails,
              mic: {
                ...finalTranscriptionResult.sourceDetails.mic,
                transcript: 'private content',
              },
            },
          },
        }),
        validatedProjections,
      ),
    ).toMatchObject({ ok: false, failure: 'invalid_shape' });
  });

  it('accepts content-free integrity reasons and rejects non-string values', () => {
    const envelope = {
      schemaVersion: 2,
      state: 'needs_attention',
      causes: [{ code: 'recovered_awaiting_validation' }],
      evidenceProvenance: { kind: 'missing' },
      reasons: ['required_source_failed'],
    };

    expect(
      parseTranscriptTrustEnvelope(JSON.stringify(envelope), projections),
    ).toMatchObject({ ok: true });
    expect(
      parseTranscriptTrustEnvelope(
        JSON.stringify({ ...envelope, reasons: [{ transcript: 'private' }] }),
        projections,
      ),
    ).toMatchObject({ ok: false, failure: 'invalid_shape' });
  });

  it.each([
    [
      'validated without proof',
      {
        schemaVersion: 2,
        state: 'validated',
        causes: [],
        evidenceProvenance: { kind: 'missing' },
      },
    ],
    [
      'attention without cause',
      {
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [],
        evidenceProvenance: { kind: 'missing' },
      },
    ],
    [
      'validating without lease',
      {
        schemaVersion: 2,
        state: 'validating',
        causes: [],
        evidenceProvenance: { kind: 'missing' },
      },
    ],
    [
      'unknown cause',
      {
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [{ code: 'unknown_reason' }],
        evidenceProvenance: { kind: 'missing' },
      },
    ],
  ])('rejects %s', (_name, envelope) => {
    expect(
      parseTranscriptTrustEnvelope(JSON.stringify(envelope), projections),
    ).toMatchObject({ ok: false });
  });

  it('resolves gap-free recovery without claiming missing speech', () => {
    const resolved = resolveTranscriptTrustState(
      meeting({
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [{ code: 'recovered_awaiting_validation' }],
        evidenceProvenance: { kind: 'missing' },
        recovery: {
          source: 'capture_journal',
          gapDetected: false,
          sourceScope: 'multiple',
          acknowledgedChunkCount: 20,
          recoveredChunkCount: 20,
        },
      }),
      capabilities,
    );

    expect(resolved).toMatchObject({
      kind: 'recovered_awaiting_validation',
      copyKey: 'recovered_awaiting_validation',
      action: 'start_validation',
      permitsDerivedGeneration: false,
    });
  });

  it('lets capture gaps outrank transcript coverage causes', () => {
    const resolved = resolveTranscriptTrustState(
      meeting({
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [
          { code: 'local_speech_unaccounted' },
          { code: 'capture_gap_detected', sourceScope: 'system' },
        ],
        evidenceProvenance: { kind: 'missing' },
        recovery: {
          source: 'capture_journal',
          gapDetected: true,
          sourceScope: 'system',
          acknowledgedChunkCount: 20,
          recoveredChunkCount: 19,
        },
      }),
      capabilities,
    );

    expect(resolved).toMatchObject({
      kind: 'capture_gap',
      copyKey: 'capture_gap',
      action: 'none',
    });
  });

  it('uses speech-loss copy only for explicit unaccounted-speech causes', () => {
    const resolved = resolveTranscriptTrustState(
      meeting({
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [{ code: 'remote_speech_unaccounted' }],
        evidenceProvenance: { kind: 'stored_capture_activity_v1' },
      }),
      capabilities,
    );

    expect(resolved.copyKey).toBe('speech_unaccounted');
    expect(resolved.action).toBe('retry_validation');
  });

  it('surfaces the preferred final model being unavailable', () => {
    const resolved = resolveTranscriptTrustState(
      meeting({
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [
          { code: 'processing_stage_failed', stage: 'source_transcription' },
        ],
        evidenceProvenance: { kind: 'sealed_capture_activity_v2' },
        finalTranscription: {
          schemaVersion: 1,
          state: 'needs_attention',
          policy: 'parakeet_final_v1',
          captureGeneration: 'generation-1',
          failure: 'runtime_unavailable',
        },
      }),
      capabilities,
    );

    expect(resolved).toMatchObject({
      kind: 'final_transcription_unavailable',
      copyKey: 'final_transcription_unavailable',
      action: 'retry_validation',
      permitsExistingRead: false,
      permitsDerivedGeneration: false,
    });
  });

  it('surfaces resource pressure as a retryable finalization pause', () => {
    const resolved = resolveTranscriptTrustState(
      meeting({
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [
          { code: 'processing_stage_failed', stage: 'resource_admission' },
        ],
        evidenceProvenance: { kind: 'sealed_capture_activity_v2' },
        finalTranscription: {
          schemaVersion: 1,
          state: 'needs_attention',
          policy: 'parakeet_final_v1',
          captureGeneration: 'generation-1',
          failure: 'resource_policy_denied',
        },
      }),
      capabilities,
    );

    expect(resolved).toMatchObject({
      kind: 'final_transcription_resource_paused',
      copyKey: 'final_transcription_resource_paused',
      action: 'retry_validation',
      permitsDerivedGeneration: false,
    });
  });

  it('requires active-channel artifacts for recovered validation', () => {
    expect(capabilities.validationMode).toBe('recovered_channels');
    expect(capabilities.canRunValidation).toBe(true);

    const unavailable = buildTranscriptTrustCapabilities({
      hasUsableMicArtifact: true,
      hasUsableSystemArtifact: false,
      hasUsableMixArtifact: false,
      hasSupportedActivityEvidence: true,
      micActivitySeconds: 5,
      systemActivitySeconds: 5,
      recoverySource: 'capture_journal',
      hasCaptureRecoveryHandler: false,
      canRestoreCaptureGap: false,
      hasExistingTranscript: false,
      hasExistingDerivedArtifacts: false,
    });

    expect(unavailable.validationMode).toBe('unavailable');
    expect(unavailable.canRunValidation).toBe(false);
  });

  it('grandfathers legacy reads but blocks new derived generation', () => {
    const resolved = resolveTranscriptTrustState(
      {
        transcript_status: 'validated',
        transcript_integrity_json: null,
        transcript_validated_at: null,
        transcript_json: JSON.stringify({
          segments: [{ text: 'Synthetic', startTime: 0, endTime: 1 }],
        }),
        finalization_status: 'finalized',
      },
      {
        ...capabilities,
        hasExistingTranscript: true,
        hasExistingDerivedArtifacts: true,
      },
    );

    expect(resolved.kind).toBe('legacy_complete');
    expect(canUseTranscriptTrustState(resolved, 'read_existing')).toBe(true);
    expect(canUseTranscriptTrustState(resolved, 'generate_new')).toBe(false);
  });

  it('binds downstream state to the current validation proof', () => {
    const validatedAt = '2026-07-30T20:00:00.000Z';
    expect(
      parseMeetingDownstreamProcessing(
        JSON.stringify({
          schemaVersion: 1,
          state: 'processing',
          transcriptValidatedAt: validatedAt,
          runId: 'run-1',
          stage: 'analysis',
        }),
        validatedAt,
      ),
    ).toMatchObject({ ok: true });

    expect(
      parseMeetingDownstreamProcessing(
        JSON.stringify({
          schemaVersion: 1,
          state: 'complete',
          transcriptValidatedAt: '2026-07-30T19:00:00.000Z',
        }),
        validatedAt,
      ),
    ).toMatchObject({ ok: false, failure: 'proof_mismatch' });
  });
});
