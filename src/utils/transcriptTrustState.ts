import type { TranscriptLifecycleStatus } from './transcriptIntegrity.ts';

export const TRANSCRIPT_TRUST_SCHEMA_VERSION = 2;

export type TranscriptTrustCauseCode =
  | 'recovered_awaiting_validation'
  | 'capture_gap_detected'
  | 'local_transcript_coverage_low'
  | 'local_speech_unaccounted'
  | 'remote_speech_unaccounted'
  | 'deterministic_retry_evidence_missing'
  | 'deterministic_retry_evidence_corrupt'
  | 'capture_activity_missing'
  | 'capture_activity_corrupt'
  | 'capture_activity_unsupported'
  | 'capture_journal_write_failed'
  | 'required_source_failed'
  | 'channel_duration_mismatch'
  | 'ambiguous_pass_through'
  | 'validation_retry_timeout'
  | 'validation_retry_failed'
  | 'validation_retry_interrupted'
  | 'validation_state_corrupt'
  | 'processing_stage_failed';

type TranscriptTrustCause = {
  code: TranscriptTrustCauseCode;
  sourceScope?: 'mic' | 'system' | 'mix' | 'multiple' | 'unknown';
  stage?:
    | 'capture_seal'
    | 'audio_probe'
    | 'source_transcription'
    | 'reconciliation'
    | 'integrity_gate'
    | 'canonical_save';
};

export type TranscriptTrustEnvelopeV2 = {
  schemaVersion: typeof TRANSCRIPT_TRUST_SCHEMA_VERSION;
  state: TranscriptLifecycleStatus;
  causes: TranscriptTrustCause[];
  evidenceProvenance: Record<string, unknown> & { kind: string };
  activityEvidence?: unknown;
  evidence?: Record<string, number>;
  validationProof?: {
    gateVersion: 'canonical_integrity_v1';
    validatedAt: string;
  };
  retry?: {
    runId: string;
    startedAt: string;
    deadlineAt: string;
    stage: 'transcribing' | 'reviewing_evidence' | 'saving';
  };
  recovery?: {
    source: 'capture_journal';
    gapDetected: boolean;
    sourceScope: 'mic' | 'system' | 'multiple' | 'unknown';
    acknowledgedChunkCount: number;
    recoveredChunkCount: number;
  };
  restorationProof?: {
    kind: 'capture_journal_restoration_v1';
    restoredAt: string;
    sourceScope: 'mic' | 'system' | 'multiple';
    acknowledgedChunkCount: number;
    restoredChunkCount: number;
    manifestDigestSha256: string;
  };
};

export type TranscriptTrustProjections = {
  transcriptStatus?: TranscriptLifecycleStatus | null;
  transcriptValidatedAt?: string | null;
  payloadLifecycleStatus?: TranscriptLifecycleStatus | null;
};

export type ParseTranscriptTrustEnvelopeResult =
  | { ok: true; envelope: TranscriptTrustEnvelopeV2 }
  | {
      ok: false;
      failure:
        | 'legacy'
        | 'invalid_json'
        | 'unsupported_schema'
        | 'invalid_shape'
        | 'projection_conflict';
    };

export type TranscriptTrustMeetingFields = {
  transcript_status?: TranscriptLifecycleStatus | null;
  transcript_integrity_json?: string | null;
  transcript_validated_at?: string | null;
  transcript_json?: string | null;
  finalization_status?: 'finalized' | 'recovery_required' | null;
};

export type TranscriptTrustCapabilityInput = {
  hasUsableMicArtifact: boolean;
  hasUsableSystemArtifact: boolean;
  hasUsableMixArtifact: boolean;
  hasSupportedActivityEvidence: boolean;
  micActivitySeconds: number;
  systemActivitySeconds: number;
  recoverySource?: 'capture_journal' | null;
  hasCaptureRecoveryHandler: boolean;
  canRestoreCaptureGap: boolean;
  hasExistingTranscript: boolean;
  hasExistingDerivedArtifacts: boolean;
};

export type TranscriptTrustCapabilities = TranscriptTrustCapabilityInput & {
  validationMode: 'full_mix' | 'recovered_channels' | 'unavailable';
  canRunValidation: boolean;
};

export type TranscriptTrustCopyKey =
  | 'capture_recovery_required'
  | 'validation_state_corrupt'
  | 'validation_in_progress'
  | 'recovered_awaiting_validation'
  | 'capture_gap'
  | 'speech_unaccounted'
  | 'integrity_needs_attention'
  | 'validation_retry_failed'
  | 'validated'
  | 'legacy_complete'
  | 'legacy_needs_attention';

export type TranscriptTrustAction =
  | 'recover_capture'
  | 'start_validation'
  | 'retry_validation'
  | 'resume_validation'
  | 'none';

export type ResolvedTranscriptTrustState = {
  kind:
    | 'capture_recovery_required'
    | 'validation_state_corrupt'
    | 'validation_in_progress'
    | 'recovered_awaiting_validation'
    | 'capture_gap'
    | 'integrity_needs_attention'
    | 'validation_retry_failed'
    | 'validated'
    | 'legacy_complete'
    | 'legacy_needs_attention';
  copyKey: TranscriptTrustCopyKey;
  action: TranscriptTrustAction;
  permitsExistingRead: boolean;
  permitsDerivedGeneration: boolean;
  envelope: TranscriptTrustEnvelopeV2 | null;
};

const STATES = new Set<TranscriptLifecycleStatus>([
  'provisional',
  'validating',
  'validated',
  'needs_attention',
]);

const CAUSES = new Set<TranscriptTrustCauseCode>([
  'recovered_awaiting_validation',
  'capture_gap_detected',
  'local_transcript_coverage_low',
  'local_speech_unaccounted',
  'remote_speech_unaccounted',
  'deterministic_retry_evidence_missing',
  'deterministic_retry_evidence_corrupt',
  'capture_activity_missing',
  'capture_activity_corrupt',
  'capture_activity_unsupported',
  'capture_journal_write_failed',
  'required_source_failed',
  'channel_duration_mismatch',
  'ambiguous_pass_through',
  'validation_retry_timeout',
  'validation_retry_failed',
  'validation_retry_interrupted',
  'validation_state_corrupt',
  'processing_stage_failed',
]);

const isoTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

const exactKeys = (
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
) => {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
};

const parsePayloadLifecycleStatus = (
  transcriptJson: string | null | undefined,
): TranscriptLifecycleStatus | null => {
  try {
    const parsed = JSON.parse(transcriptJson || '{}') as {
      lifecycleStatus?: unknown;
    };
    return STATES.has(parsed.lifecycleStatus as TranscriptLifecycleStatus)
      ? (parsed.lifecycleStatus as TranscriptLifecycleStatus)
      : null;
  } catch {
    return null;
  }
};

const validCause = (value: unknown): value is TranscriptTrustCause => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const cause = value as Record<string, unknown>;
  if (typeof cause.code !== 'string' || !CAUSES.has(cause.code as never)) {
    return false;
  }
  if (
    cause.code === 'capture_gap_detected' &&
    !['mic', 'system', 'multiple', 'unknown'].includes(
      String(cause.sourceScope),
    )
  ) {
    return false;
  }
  return Object.keys(cause).every((key) =>
    ['code', 'sourceScope', 'stage'].includes(key),
  );
};

const validRetry = (
  value: unknown,
): value is NonNullable<TranscriptTrustEnvelopeV2['retry']> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const retry = value as Record<string, unknown>;
  return (
    exactKeys(retry, ['runId', 'startedAt', 'deadlineAt', 'stage']) &&
    typeof retry.runId === 'string' &&
    /^[A-Za-z0-9-]{1,128}$/.test(retry.runId) &&
    isoTimestamp(retry.startedAt) &&
    isoTimestamp(retry.deadlineAt) &&
    Date.parse(retry.deadlineAt) > Date.parse(retry.startedAt) &&
    ['transcribing', 'reviewing_evidence', 'saving'].includes(
      String(retry.stage),
    )
  );
};

const validProof = (
  value: unknown,
): value is NonNullable<TranscriptTrustEnvelopeV2['validationProof']> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proof = value as Record<string, unknown>;
  return (
    exactKeys(proof, ['gateVersion', 'validatedAt']) &&
    proof.gateVersion === 'canonical_integrity_v1' &&
    isoTimestamp(proof.validatedAt)
  );
};

const validRecovery = (
  value: unknown,
): value is NonNullable<TranscriptTrustEnvelopeV2['recovery']> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const recovery = value as Record<string, unknown>;
  return (
    exactKeys(recovery, [
      'source',
      'gapDetected',
      'sourceScope',
      'acknowledgedChunkCount',
      'recoveredChunkCount',
    ]) &&
    recovery.source === 'capture_journal' &&
    typeof recovery.gapDetected === 'boolean' &&
    ['mic', 'system', 'multiple', 'unknown'].includes(
      String(recovery.sourceScope),
    ) &&
    Number.isInteger(recovery.acknowledgedChunkCount) &&
    Number(recovery.acknowledgedChunkCount) >= 0 &&
    Number.isInteger(recovery.recoveredChunkCount) &&
    Number(recovery.recoveredChunkCount) >= 0 &&
    Number(recovery.recoveredChunkCount) <=
      Number(recovery.acknowledgedChunkCount)
  );
};

export const parseTranscriptTrustEnvelope = (
  value: string | null | undefined,
  projections: TranscriptTrustProjections,
): ParseTranscriptTrustEnvelopeResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || '{}');
  } catch {
    return { ok: false, failure: 'invalid_json' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, failure: 'invalid_shape' };
  }
  const raw = parsed as Record<string, unknown>;
  if (!('schemaVersion' in raw)) return { ok: false, failure: 'legacy' };
  if (raw.schemaVersion !== TRANSCRIPT_TRUST_SCHEMA_VERSION) {
    return { ok: false, failure: 'unsupported_schema' };
  }
  if (
    !exactKeys(
      raw,
      ['schemaVersion', 'state', 'causes', 'evidenceProvenance'],
      [
        'activityEvidence',
        'evidence',
        'validationProof',
        'retry',
        'recovery',
        'restorationProof',
      ],
    ) ||
    !STATES.has(raw.state as TranscriptLifecycleStatus) ||
    !Array.isArray(raw.causes) ||
    !raw.causes.every(validCause) ||
    !raw.evidenceProvenance ||
    typeof raw.evidenceProvenance !== 'object'
  ) {
    return { ok: false, failure: 'invalid_shape' };
  }

  const state = raw.state as TranscriptLifecycleStatus;
  const causes = raw.causes as TranscriptTrustCause[];
  const retry = raw.retry;
  const proof = raw.validationProof;
  if (
    (state === 'provisional' &&
      (causes.length > 0 || retry !== undefined || proof !== undefined)) ||
    (state === 'validating' &&
      (causes.length > 0 || !validRetry(retry) || proof !== undefined)) ||
    (state === 'needs_attention' &&
      (causes.length === 0 || retry !== undefined || proof !== undefined)) ||
    (state === 'validated' &&
      (causes.length > 0 || retry !== undefined || !validProof(proof)))
  ) {
    return { ok: false, failure: 'invalid_shape' };
  }
  if (raw.recovery !== undefined && !validRecovery(raw.recovery)) {
    return { ok: false, failure: 'invalid_shape' };
  }
  const recovery = raw.recovery as TranscriptTrustEnvelopeV2['recovery'];
  const gapCause = causes.find((cause) => cause.code === 'capture_gap_detected');
  if (
    recovery?.gapDetected &&
    (!gapCause || gapCause.sourceScope !== recovery.sourceScope)
  ) {
    return { ok: false, failure: 'invalid_shape' };
  }
  if (
    projections.transcriptStatus != null &&
    projections.transcriptStatus !== state
  ) {
    return { ok: false, failure: 'projection_conflict' };
  }
  if (
    projections.payloadLifecycleStatus != null &&
    projections.payloadLifecycleStatus !== state
  ) {
    return { ok: false, failure: 'projection_conflict' };
  }
  if (
    state === 'validated' &&
    projections.transcriptValidatedAt !==
      (proof as TranscriptTrustEnvelopeV2['validationProof'])?.validatedAt
  ) {
    return { ok: false, failure: 'projection_conflict' };
  }
  if (state !== 'validated' && projections.transcriptValidatedAt != null) {
    return { ok: false, failure: 'projection_conflict' };
  }
  return { ok: true, envelope: raw as TranscriptTrustEnvelopeV2 };
};

export const buildTranscriptTrustCapabilities = (
  input: TranscriptTrustCapabilityInput,
): TranscriptTrustCapabilities => {
  const hasRequiredActiveChannels =
    (input.micActivitySeconds <= 0 || input.hasUsableMicArtifact) &&
    (input.systemActivitySeconds <= 0 || input.hasUsableSystemArtifact);
  const atLeastOneActiveArtifact =
    (input.micActivitySeconds > 0 && input.hasUsableMicArtifact) ||
    (input.systemActivitySeconds > 0 && input.hasUsableSystemArtifact);
  const fullMix =
    input.hasSupportedActivityEvidence &&
    input.hasUsableMicArtifact &&
    input.hasUsableSystemArtifact &&
    input.hasUsableMixArtifact;
  const recoveredChannels =
    input.recoverySource === 'capture_journal' &&
    input.hasSupportedActivityEvidence &&
    hasRequiredActiveChannels &&
    atLeastOneActiveArtifact;
  const validationMode = fullMix
    ? ('full_mix' as const)
    : recoveredChannels
      ? ('recovered_channels' as const)
      : ('unavailable' as const);
  return {
    ...input,
    validationMode,
    canRunValidation: validationMode !== 'unavailable',
  };
};

const resolved = (
  input: Omit<ResolvedTranscriptTrustState, 'envelope'> & {
    envelope?: TranscriptTrustEnvelopeV2 | null;
  },
): ResolvedTranscriptTrustState => ({ envelope: null, ...input });

export const resolveTranscriptTrustState = (
  meeting: TranscriptTrustMeetingFields,
  capabilities: TranscriptTrustCapabilities,
  nowMs = Date.now(),
): ResolvedTranscriptTrustState => {
  if (meeting.finalization_status === 'recovery_required') {
    return resolved({
      kind: 'capture_recovery_required',
      copyKey: 'capture_recovery_required',
      action: capabilities.hasCaptureRecoveryHandler
        ? 'recover_capture'
        : 'none',
      permitsExistingRead: true,
      permitsDerivedGeneration: false,
    });
  }

  const payloadLifecycleStatus = parsePayloadLifecycleStatus(
    meeting.transcript_json,
  );
  const parsed = parseTranscriptTrustEnvelope(
    meeting.transcript_integrity_json,
    {
      transcriptStatus: meeting.transcript_status,
      transcriptValidatedAt: meeting.transcript_validated_at,
      payloadLifecycleStatus,
    },
  );
  if (!parsed.ok && parsed.failure === 'legacy') {
    const complete =
      (meeting.transcript_status == null ||
        meeting.transcript_status === 'validated') &&
      capabilities.hasExistingTranscript;
    return resolved({
      kind: complete ? 'legacy_complete' : 'legacy_needs_attention',
      copyKey: complete ? 'legacy_complete' : 'legacy_needs_attention',
      action: capabilities.canRunValidation ? 'start_validation' : 'none',
      permitsExistingRead: complete,
      permitsDerivedGeneration: false,
    });
  }
  if (!parsed.ok) {
    return resolved({
      kind: 'validation_state_corrupt',
      copyKey: 'validation_state_corrupt',
      action: capabilities.canRunValidation ? 'retry_validation' : 'none',
      permitsExistingRead: capabilities.hasExistingTranscript,
      permitsDerivedGeneration: false,
    });
  }

  const envelope = parsed.envelope;
  if (envelope.state === 'validating') {
    const interrupted = Date.parse(envelope.retry?.deadlineAt || '') <= nowMs;
    return resolved({
      kind: interrupted
        ? 'validation_retry_failed'
        : 'validation_in_progress',
      copyKey: interrupted
        ? 'validation_retry_failed'
        : 'validation_in_progress',
      action:
        interrupted && capabilities.canRunValidation
          ? 'retry_validation'
          : 'none',
      permitsExistingRead: capabilities.hasExistingTranscript,
      permitsDerivedGeneration: false,
      envelope,
    });
  }
  if (envelope.state === 'validated') {
    return resolved({
      kind: 'validated',
      copyKey: 'validated',
      action: 'none',
      permitsExistingRead: true,
      permitsDerivedGeneration: true,
      envelope,
    });
  }
  if (envelope.state === 'provisional') {
    return resolved({
      kind: 'legacy_needs_attention',
      copyKey: 'legacy_needs_attention',
      action: 'none',
      permitsExistingRead: capabilities.hasExistingTranscript,
      permitsDerivedGeneration: false,
      envelope,
    });
  }

  const causeCodes = new Set(envelope.causes.map((cause) => cause.code));
  if (causeCodes.has('capture_gap_detected')) {
    const canRestore =
      capabilities.hasCaptureRecoveryHandler &&
      capabilities.canRestoreCaptureGap;
    return resolved({
      kind: 'capture_gap',
      copyKey: 'capture_gap',
      action: canRestore ? 'recover_capture' : 'none',
      permitsExistingRead: capabilities.hasExistingTranscript,
      permitsDerivedGeneration: false,
      envelope,
    });
  }
  if (causeCodes.has('recovered_awaiting_validation')) {
    return resolved({
      kind: 'recovered_awaiting_validation',
      copyKey: 'recovered_awaiting_validation',
      action: capabilities.canRunValidation ? 'start_validation' : 'none',
      permitsExistingRead: capabilities.hasExistingTranscript,
      permitsDerivedGeneration: false,
      envelope,
    });
  }
  if (
    causeCodes.has('validation_retry_timeout') ||
    causeCodes.has('validation_retry_failed') ||
    causeCodes.has('validation_retry_interrupted')
  ) {
    return resolved({
      kind: 'validation_retry_failed',
      copyKey: 'validation_retry_failed',
      action: capabilities.canRunValidation ? 'retry_validation' : 'none',
      permitsExistingRead: capabilities.hasExistingTranscript,
      permitsDerivedGeneration: false,
      envelope,
    });
  }
  const speechUnaccounted =
    causeCodes.has('local_speech_unaccounted') ||
    causeCodes.has('remote_speech_unaccounted');
  return resolved({
    kind: 'integrity_needs_attention',
    copyKey: speechUnaccounted
      ? 'speech_unaccounted'
      : 'integrity_needs_attention',
    action: capabilities.canRunValidation ? 'retry_validation' : 'none',
    permitsExistingRead: capabilities.hasExistingTranscript,
    permitsDerivedGeneration: false,
    envelope,
  });
};

export const canUseTranscriptTrustState = (
  state: ResolvedTranscriptTrustState,
  operation: 'read_existing' | 'generate_new',
) =>
  operation === 'read_existing'
    ? state.permitsExistingRead
    : state.permitsDerivedGeneration;
