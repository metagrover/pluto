import { describe, expect, it } from 'vitest';

import {
  buildTranscriptTrustCapabilities,
  canUseTranscriptTrustState,
  parseTranscriptTrustEnvelope,
  resolveTranscriptTrustState,
  type TranscriptTrustMeetingFields,
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
});
