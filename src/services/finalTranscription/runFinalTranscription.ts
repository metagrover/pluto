import { deriveAttributionEvidence } from '../../utils/acousticSpeakerAttribution.ts';
import type {
  AttributionSegment,
  SpeakerActivityWindow,
} from '../../utils/speakerAttribution.ts';
import { SYSTEM_CAPTURE_INCOMPLETE_REASON } from '../../utils/transcriptIntegrity.ts';
import type { StoredTranscriptSpeakerAttribution } from '../../utils/transcriptSchema.ts';
import {
  type RecordingTranscriptValidationResult,
  runRecordingTranscriptValidation,
} from '../recordingTranscriptValidation.ts';
import type { SpeakerCandidateEvidence } from '../speakerCandidateEvidence.ts';
import type {
  TranscriptionRequest,
  TranscriptionResult,
} from '../transcription/contracts.ts';
import { applyRecoveredChannelEvidence } from './applyRecoveredChannelEvidence.ts';
import type { SpeakerAttributionDiagnostics } from './applyRecoveredChannelEvidence.ts';
import { applyRemoteSpeakerClusters } from './applyRemoteSpeakerClusters.ts';
import type { FinalSpeakerEvidence } from './applySpeakerEvidence.ts';
import type { CrossChannelReconciliationMetadata } from './crossChannelSkew.ts';
import type { FinalTranscriptionAdmission } from './finalTranscriptionAdmission.ts';
import {
  type FinalTranscriptionFailure,
  type FinalTranscriptionLease,
  advanceFinalTranscriptionLease,
  buildFinalTranscriptionLease,
} from './finalTranscriptionLease.ts';

export type FinalTranscriptionInput = {
  meetingId: string;
  runId: string;
  captureEvidence: {
    sealed: boolean;
    generation: string;
    systemCaptureIncomplete?: boolean;
  };
  recordingDurationSeconds: number;
  micAudioPath: string;
  mixedAudioPath: string;
  systemAudioPath: string;
  provisionalSegments: AttributionSegment[];
  preserveProvisionalText?: boolean;
  activityWindows: SpeakerActivityWindow[];
  language: string;
  vocabulary?: string[];
  vocabularyPolicyVersion?: string;
  signal?: AbortSignal;
};

type CanonicalCommit = {
  meetingId: string;
  expectedCaptureGeneration: string;
  segments: AttributionSegment[];
  integrity: RecordingTranscriptValidationResult['evidence'];
  metadata: FinalTranscriptionMetadata;
  speakerCandidates?: SpeakerCandidateEvidence[];
};

export type FinalTranscriptionMetadata = {
  policy: 'parakeet_final_v1';
  engine: 'parakeet_coreml';
  model: 'parakeet-tdt-0.6b-v3';
  computeType: 'int8';
  computeUnits: 'cpu_and_neural_engine';
  language: string;
  elapsedMs: number;
  warnings: string[];
  sources: RecordingTranscriptValidationResult['sourceOutcomes'];
  sourceDetails: Partial<
    Record<
      'mic' | 'system',
      {
        outcome: 'speech' | 'no_speech' | 'failed';
        providerVersion: string;
        modelBundleVersion?: string;
        elapsedMs: number;
        confidence?: number;
        vadStatus: 'speech' | 'no_speech' | 'failed';
        speechSeconds: number;
        segmentCount: number;
        wordCount: number;
      }
    >
  >;
  providerVersions: string[];
  modelBundleVersions: string[];
  vocabularyPolicyVersion?: string;
  vocabularyCount: number;
  reconciliation: CrossChannelReconciliationMetadata;
  speakerAttribution?: StoredTranscriptSpeakerAttribution;
  speakerEvidence?: {
    provenance: FinalSpeakerEvidence['provenance'];
    timings: FinalSpeakerEvidence['timings'];
  };
};

export type FinalTranscriptionDependencies<TTranscript = unknown> = {
  claimLease: (lease: FinalTranscriptionLease) => Promise<boolean>;
  admit?: () => Promise<FinalTranscriptionAdmission>;
  updateLease?: (lease: FinalTranscriptionLease) => Promise<unknown>;
  transcribe: (request: TranscriptionRequest) => Promise<TranscriptionResult>;
  probeDuration: (audioPath: string) => Promise<number | null>;
  speakerEvidence: (request: {
    meetingId: string;
    mixedAudioPath: string;
    micAudioPath: string;
    systemAudioPath: string;
    signal?: AbortSignal;
  }) => Promise<FinalSpeakerEvidence>;
  commitCanonical: (
    commit: CanonicalCommit,
  ) => Promise<{ committed: boolean; transcript?: TTranscript }>;
  markNeedsAttention: (input: {
    meetingId: string;
    captureGeneration: string;
    failure: FinalTranscriptionFailure;
    lease?: FinalTranscriptionLease;
    reasons?: string[];
    metadata?: FinalTranscriptionMetadata;
    attributionDiagnostics?: SpeakerAttributionDiagnostics;
  }) => Promise<void>;
  startAnalysis: (input: {
    meetingId: string;
    transcript: TTranscript;
  }) => Promise<unknown>;
};

export type FinalTranscriptionOutcome = {
  status: 'validated' | 'needs_attention' | 'superseded' | 'cancelled';
  reasons?: string[];
};

const isCancellation = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'AbortError' || error.message === 'parakeet_cancelled');

export const runFinalTranscription = async <TTranscript>(
  input: FinalTranscriptionInput,
  dependencies: FinalTranscriptionDependencies<TTranscript>,
): Promise<FinalTranscriptionOutcome> => {
  if (!input.captureEvidence.generation) {
    await dependencies.markNeedsAttention({
      meetingId: input.meetingId,
      captureGeneration: input.captureEvidence.generation,
      failure: 'evidence_unsealed',
    });
    return { status: 'needs_attention', reasons: ['evidence_unsealed'] };
  }
  if (input.signal?.aborted) return { status: 'cancelled' };

  let lease = buildFinalTranscriptionLease({
    runId: input.runId,
    captureGeneration: input.captureEvidence.generation,
    recordingDurationSeconds: input.recordingDurationSeconds,
  });
  if (!(await dependencies.claimLease(lease))) return { status: 'superseded' };
  if (!input.captureEvidence.sealed) {
    await dependencies.markNeedsAttention({
      meetingId: input.meetingId,
      captureGeneration: input.captureEvidence.generation,
      failure: 'evidence_unsealed',
      lease,
    });
    return { status: 'needs_attention', reasons: ['evidence_unsealed'] };
  }
  if (input.captureEvidence.systemCaptureIncomplete) {
    await dependencies.markNeedsAttention({
      meetingId: input.meetingId,
      captureGeneration: input.captureEvidence.generation,
      failure: 'required_source_failed',
      lease,
      reasons: [SYSTEM_CAPTURE_INCOMPLETE_REASON],
    });
    return {
      status: 'needs_attention',
      reasons: [SYSTEM_CAPTURE_INCOMPLETE_REASON],
    };
  }
  const admission = await dependencies.admit?.();
  if (admission && !admission.admitted) {
    await dependencies.markNeedsAttention({
      meetingId: input.meetingId,
      captureGeneration: input.captureEvidence.generation,
      failure: 'resource_policy_denied',
      lease,
      reasons: [admission.reason],
    });
    return { status: 'needs_attention', reasons: [admission.reason] };
  }
  const observedResults: TranscriptionResult[] = [];
  let speakerEvidence: FinalSpeakerEvidence | undefined;
  let speakerActivityWindows: SpeakerActivityWindow[] = [];
  try {
    const validation = await runRecordingTranscriptValidation({
      meetingId: input.meetingId,
      recordingDurationSeconds: input.recordingDurationSeconds,
      micAudioPath: input.micAudioPath,
      mixAudioPath: '',
      systemAudioPath: input.systemAudioPath,
      provisionalSegments: input.provisionalSegments,
      preserveProvisionalText: input.preserveProvisionalText,
      activityWindows: input.activityWindows,
      canonicalMode: 'recovered_channels',
      transcriptionScheduling: 'sequential_channels',
      resolveAttributionWindows: async () => {
        lease = advanceFinalTranscriptionLease(lease, 'attributing_speakers');
        await dependencies.updateLease?.(lease);
        speakerEvidence = await dependencies.speakerEvidence({
          meetingId: input.meetingId,
          mixedAudioPath: input.mixedAudioPath,
          micAudioPath: input.micAudioPath,
          systemAudioPath: input.systemAudioPath,
          signal: input.signal,
        });
        const windows = deriveAttributionEvidence(
          speakerEvidence.energyWindows,
        ).flatMap<SpeakerActivityWindow>((window) => {
          if (window.evidence === 'mic_exclusive') {
            return [{ ...window, speaker: 'Me' }];
          }
          if (window.evidence === 'system_correlated') {
            return [{ ...window, speaker: 'Them' }];
          }
          return [];
        });
        if (windows.length === 0) {
          throw new Error('speaker_acoustic_evidence_missing');
        }
        speakerActivityWindows = windows;
        return windows;
      },
      probeDuration: dependencies.probeDuration,
      transcribe: async (audioPath, options) => {
        if (input.signal?.aborted) throw new Error('parakeet_cancelled');
        if (options.canonicalSource === 'mix') {
          throw new Error('parakeet_request_invalid');
        }
        lease = advanceFinalTranscriptionLease(
          lease,
          options.canonicalSource === 'mic'
            ? 'transcribing_mic'
            : 'transcribing_system',
        );
        await dependencies.updateLease?.(lease);
        const result = await dependencies.transcribe({
          meetingId: input.meetingId,
          role: 'final_validation',
          source: options.canonicalSource,
          audioPath,
          language: input.language,
          vocabulary: input.vocabulary,
          vocabularyPolicyVersion: input.vocabularyPolicyVersion,
          signal: input.signal,
        });
        if (
          result.vad.status === 'failed' ||
          (result.vad.status === 'speech' && result.segments.length === 0) ||
          (result.vad.status === 'no_speech' && result.segments.length > 0)
        ) {
          throw new Error('parakeet_transcription_failed');
        }
        observedResults.push(result);
        return result;
      },
    });
    if (input.signal?.aborted) return { status: 'cancelled' };

    const metadata: FinalTranscriptionMetadata = {
      policy: 'parakeet_final_v1',
      engine: 'parakeet_coreml',
      model: 'parakeet-tdt-0.6b-v3',
      computeType: 'int8',
      computeUnits: 'cpu_and_neural_engine',
      language: input.language,
      elapsedMs: observedResults.reduce(
        (total, result) => total + result.meta.elapsedMs,
        0,
      ),
      warnings: [],
      sources: validation.sourceOutcomes,
      sourceDetails: Object.fromEntries(
        observedResults.map((result) => [
          result.meta.source,
          {
            outcome: result.vad.status,
            providerVersion: result.meta.providerVersion,
            modelBundleVersion: result.meta.modelBundleVersion,
            elapsedMs: result.meta.elapsedMs,
            confidence: result.meta.confidence,
            vadStatus: result.vad.status,
            speechSeconds: result.vad.speechSeconds,
            segmentCount: result.segments.length,
            wordCount: result.segments.reduce(
              (total, segment) =>
                total +
                (segment.words?.length ??
                  segment.text.split(/\s+/).filter(Boolean).length),
              0,
            ),
          },
        ]),
      ) as FinalTranscriptionMetadata['sourceDetails'],
      providerVersions: [
        ...new Set(
          observedResults.map((result) => result.meta.providerVersion),
        ),
      ],
      modelBundleVersions: [
        ...new Set(
          observedResults
            .map((result) => result.meta.modelBundleVersion)
            .filter((version): version is string => Boolean(version)),
        ),
      ],
      vocabularyPolicyVersion: input.vocabularyPolicyVersion,
      vocabularyCount: Math.max(
        0,
        ...observedResults.map((result) => result.meta.vocabularyCount ?? 0),
      ),
      reconciliation: validation.reconciliation,
      speakerEvidence: speakerEvidence
        ? {
            provenance: speakerEvidence.provenance,
            timings: speakerEvidence.timings,
          }
        : undefined,
    };
    metadata.elapsedMs += speakerEvidence?.timings.totalMs ?? 0;
    lease = advanceFinalTranscriptionLease(lease, 'reviewing_integrity');
    await dependencies.updateLease?.(lease);
    if (validation.status !== 'validated') {
      const failure: FinalTranscriptionFailure = validation.reasons.includes(
        'required_source_failed',
      )
        ? 'required_source_failed'
        : 'integrity_rejected';
      await dependencies.markNeedsAttention({
        meetingId: input.meetingId,
        captureGeneration: input.captureEvidence.generation,
        failure,
        lease,
        reasons: validation.reasons,
        metadata,
      });
      return { status: 'needs_attention', reasons: validation.reasons };
    }

    if (!speakerEvidence) {
      throw new Error('speaker_acoustic_evidence_missing');
    }
    const attribution = applyRecoveredChannelEvidence({
      segments: validation.segments,
      activityWindows: speakerActivityWindows,
      provenance: speakerEvidence.provenance,
    });
    metadata.speakerAttribution = attribution.attribution;
    if (!attribution.accepted) {
      await dependencies.markNeedsAttention({
        meetingId: input.meetingId,
        captureGeneration: input.captureEvidence.generation,
        failure: 'speaker_attribution_rejected',
        lease,
        reasons: attribution.reasons,
        metadata,
        attributionDiagnostics: attribution.diagnostics,
      });
      return { status: 'needs_attention', reasons: attribution.reasons };
    }

    const remoteSpeakers = applyRemoteSpeakerClusters({
      segments: attribution.segments,
      turns: speakerEvidence.turns,
      systemEnergyWindows: speakerEvidence.energyWindows,
      clusterEvidence: speakerEvidence.clusterEvidence,
      provenance: speakerEvidence.provenance,
    });
    metadata.speakerAttribution = {
      ...attribution.attribution,
      remoteDiarization: remoteSpeakers.metadata,
    };

    lease = advanceFinalTranscriptionLease(lease, 'saving');
    await dependencies.updateLease?.(lease);
    const commit = await dependencies.commitCanonical({
      meetingId: input.meetingId,
      expectedCaptureGeneration: input.captureEvidence.generation,
      segments: remoteSpeakers.segments,
      integrity: validation.evidence,
      metadata,
      speakerCandidates: remoteSpeakers.candidateEvidence,
    });
    if (!commit.committed || commit.transcript === undefined) {
      return { status: 'superseded' };
    }
    await dependencies.startAnalysis({
      meetingId: input.meetingId,
      transcript: commit.transcript,
    });
    return { status: 'validated' };
  } catch (error) {
    if (isCancellation(error) || input.signal?.aborted) {
      await dependencies.markNeedsAttention({
        meetingId: input.meetingId,
        captureGeneration: input.captureEvidence.generation,
        failure: 'cancelled',
        lease,
      });
      return { status: 'cancelled' };
    }
    const failure: FinalTranscriptionFailure =
      error instanceof Error &&
      error.message.startsWith('invalid_transcript_trust_candidate:')
        ? 'integrity_rejected'
        : 'runtime_unavailable';
    await dependencies.markNeedsAttention({
      meetingId: input.meetingId,
      captureGeneration: input.captureEvidence.generation,
      failure,
      lease,
    });
    return { status: 'needs_attention', reasons: [failure] };
  }
};
