import type {
  AttributionSegment,
  SpeakerActivityWindow,
} from '../../utils/speakerAttribution.ts';
import {
  type RecordingTranscriptValidationResult,
  runRecordingTranscriptValidation,
} from '../recordingTranscriptValidation.ts';
import type {
  TranscriptionRequest,
  TranscriptionResult,
} from '../transcription/contracts.ts';
import {
  type FinalTranscriptionFailure,
  type FinalTranscriptionLease,
  advanceFinalTranscriptionLease,
  buildFinalTranscriptionLease,
} from './finalTranscriptionLease.ts';

export type FinalTranscriptionInput = {
  meetingId: string;
  runId: string;
  captureEvidence: { sealed: boolean; generation: string };
  recordingDurationSeconds: number;
  micAudioPath: string;
  systemAudioPath: string;
  provisionalSegments: AttributionSegment[];
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
};

type FinalTranscriptionMetadata = {
  policy: 'parakeet_final_v1';
  model: 'parakeet-tdt-0.6b-v3';
  sources: RecordingTranscriptValidationResult['sourceOutcomes'];
  modelBundleVersions: string[];
  vocabularyPolicyVersion?: string;
  vocabularyCount: number;
};

export type FinalTranscriptionDependencies<TTranscript = unknown> = {
  claimLease: (lease: FinalTranscriptionLease) => Promise<boolean>;
  updateLease?: (lease: FinalTranscriptionLease) => Promise<unknown>;
  transcribe: (request: TranscriptionRequest) => Promise<TranscriptionResult>;
  probeDuration: (audioPath: string) => Promise<number | null>;
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
  if (!input.captureEvidence.sealed || !input.captureEvidence.generation) {
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

  const observedResults: TranscriptionResult[] = [];
  try {
    const validation = await runRecordingTranscriptValidation({
      meetingId: input.meetingId,
      recordingDurationSeconds: input.recordingDurationSeconds,
      micAudioPath: input.micAudioPath,
      mixAudioPath: '',
      systemAudioPath: input.systemAudioPath,
      provisionalSegments: input.provisionalSegments,
      activityWindows: input.activityWindows,
      canonicalMode: 'recovered_channels',
      transcriptionScheduling: 'sequential_channels',
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
      model: 'parakeet-tdt-0.6b-v3',
      sources: validation.sourceOutcomes,
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
    };
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

    lease = advanceFinalTranscriptionLease(lease, 'saving');
    await dependencies.updateLease?.(lease);
    const commit = await dependencies.commitCanonical({
      meetingId: input.meetingId,
      expectedCaptureGeneration: input.captureEvidence.generation,
      segments: validation.segments,
      integrity: validation.evidence,
      metadata,
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
      return { status: 'cancelled' };
    }
    await dependencies.markNeedsAttention({
      meetingId: input.meetingId,
      captureGeneration: input.captureEvidence.generation,
      failure: 'runtime_unavailable',
      lease,
    });
    return { status: 'needs_attention', reasons: ['runtime_unavailable'] };
  }
};
