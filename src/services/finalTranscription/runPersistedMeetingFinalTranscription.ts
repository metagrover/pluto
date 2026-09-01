import type { Meeting } from '../../types.ts';
import type { AttributionSegment } from '../../utils/speakerAttribution.ts';
import {
  type CaptureActivityEvidence,
  parseCaptureActivityEvidence,
} from '../../utils/transcriptActivityEvidence.ts';
import type {
  StoredTranscriptSpeakerAttribution,
  StoredTranscriptV2,
} from '../../utils/transcriptSchema.ts';
import { buildTranscriptJsonPayload } from '../../utils/transcriptSchema.ts';
import { assertValidTranscriptTrustCandidate } from '../../utils/transcriptTrustState.ts';
import { processValidatedMeetingDownstream } from '../processValidatedMeetingDownstream.ts';
import {
  type FinalTranscriptionResourcePolicy,
  evaluateFinalTranscriptionAdmission,
} from './finalTranscriptionAdmission.ts';
import {
  clearFinalTranscriptionVocabulary,
  readFinalTranscriptionVocabulary,
} from './finalTranscriptionVocabularyRegistry.ts';
import {
  type FinalTranscriptionOutcome,
  runFinalTranscription,
} from './runFinalTranscription.ts';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

type StoredIntegrity = Record<string, unknown> & {
  activityEvidence?: unknown;
  evidenceProvenance?: { kind?: unknown; digestSha256?: unknown };
};

const parseObject = (
  value: string | null | undefined,
): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const parseProvisionalTranscript = (
  value: string | null | undefined,
): { payload: Partial<StoredTranscriptV2>; segments: AttributionSegment[] } => {
  const parsed = parseObject(value);
  const segments = Array.isArray(parsed.segments)
    ? parsed.segments.filter(
        (segment): segment is AttributionSegment =>
          Boolean(segment) &&
          typeof segment === 'object' &&
          typeof (segment as AttributionSegment).text === 'string' &&
          Number.isFinite((segment as AttributionSegment).startTime) &&
          Number.isFinite((segment as AttributionSegment).endTime),
      )
    : [];
  return { payload: parsed as Partial<StoredTranscriptV2>, segments };
};

const readSealedActivityEvidence = async (
  integrity: StoredIntegrity,
): Promise<CaptureActivityEvidence | null> => {
  if (integrity.evidenceProvenance?.kind !== 'sealed_capture_activity_v2') {
    return null;
  }
  const parsed = await parseCaptureActivityEvidence(integrity.activityEvidence);
  return parsed.ok ? parsed.evidence : null;
};

const sanitizeVocabularyTerms = (value: unknown): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((term): term is string => typeof term === 'string')
            .map((term) => term.trim())
            .filter(Boolean),
        ),
      ].slice(0, 12)
    : [];

export const runPersistedMeetingFinalTranscription = async (
  meeting: Meeting,
  invoke: Invoke,
  options: { signal?: AbortSignal; runId?: string } = {},
): Promise<FinalTranscriptionOutcome> => {
  const captureGeneration = meeting.capture_journal_generation || '';
  const integrity = parseObject(
    meeting.transcript_integrity_json,
  ) as StoredIntegrity;
  const activityEvidence = await readSealedActivityEvidence(integrity);
  const provisional = parseProvisionalTranscript(meeting.transcript_json);
  const runId = options.runId ?? crypto.randomUUID();
  const meetingId = String(meeting.id);
  const language = provisional.payload.transcription?.language || 'en';
  const speakerAttribution = provisional.payload.speakerAttribution as
    | StoredTranscriptSpeakerAttribution
    | undefined;
  let vocabulary = readFinalTranscriptionVocabulary(meetingId);
  if (!vocabulary) {
    vocabulary = sanitizeVocabularyTerms(
      provisional.payload.transcription?.vocabularyTerms,
    );
  }
  if (vocabulary.length === 0) {
    try {
      const selection = (await invoke('GET_TRANSCRIPTION_VOCABULARY', {
        participants: [],
      })) as { terms?: unknown };
      vocabulary = sanitizeVocabularyTerms(selection?.terms);
    } catch {
      vocabulary = [];
    }
  }
  let committedSegments: AttributionSegment[] = [];

  const outcome = await runFinalTranscription(
    {
      meetingId,
      runId,
      captureEvidence: {
        sealed: Boolean(activityEvidence && captureGeneration),
        generation: captureGeneration,
      },
      recordingDurationSeconds: meeting.duration_seconds || 0,
      micAudioPath: meeting.audio_path || '',
      systemAudioPath: meeting.system_audio_path || '',
      provisionalSegments: provisional.segments,
      activityWindows: activityEvidence?.windows || [],
      language,
      vocabulary,
      vocabularyPolicyVersion:
        provisional.payload.transcription?.vocabularyHintPolicyVersion,
      signal: options.signal,
    },
    {
      claimLease: async (lease) =>
        (await invoke('CLAIM_FINAL_TRANSCRIPTION', meetingId, lease)) === true,
      admit: async () =>
        evaluateFinalTranscriptionAdmission(
          (await invoke(
            'GET_CAPTURE_COMPUTE_POLICY',
          )) as FinalTranscriptionResourcePolicy,
        ),
      updateLease: async (lease) =>
        await invoke(
          'UPDATE_FINAL_TRANSCRIPTION_STAGE',
          meetingId,
          lease.runId,
          lease.stage,
        ),
      transcribe: async (request) =>
        (await invoke('TRANSCRIPTION_TRANSCRIBE_FINAL', request)) as never,
      probeDuration: async (audioPath) =>
        (await invoke('AUDIO_PROBE_DURATION', audioPath)) as number | null,
      commitCanonical: async (commit) => {
        committedSegments = commit.segments;
        const transcriptValidatedAt = new Date().toISOString();
        const canonicalTranscriptJson = JSON.stringify(
          buildTranscriptJsonPayload(commit.segments, {
            pipelineMode: 'parakeet_final_v1',
            canonicalSource: 'recovered_channels',
            postHydrationBleedPass: false,
            transcription: {
              backend: commit.metadata.engine,
              preset: 'accuracy_first',
              model: commit.metadata.model,
              device: commit.metadata.computeUnits,
              computeType: commit.metadata.computeType,
              language: commit.metadata.language,
              canonicalSource: 'recovered_channels',
              diarization: false,
              elapsedMs: commit.metadata.elapsedMs,
              providerLabel: commit.metadata.providerVersions.join(','),
              warnings: commit.metadata.warnings,
              vocabularyHintPolicyVersion:
                commit.metadata.vocabularyPolicyVersion,
              vocabularyHintCount: commit.metadata.vocabularyCount,
              vocabularyTerms: vocabulary,
            },
            speakerAttribution,
            liveTranscriptResponsiveness:
              provisional.payload.liveTranscriptResponsiveness,
            stopToValidatedLatency: provisional.payload.stopToValidatedLatency,
            lifecycleStatus: 'validated',
            integrity: { ...commit.integrity, reasons: [] },
            liveSegments: provisional.segments,
          }),
        );
        const transcriptIntegrityJson = JSON.stringify({
          schemaVersion: 2,
          state: 'validated',
          causes: [],
          evidenceProvenance: integrity.evidenceProvenance,
          activityEvidence: integrity.activityEvidence,
          evidence: commit.integrity,
          validationProof: {
            gateVersion: 'canonical_integrity_v1',
            validatedAt: transcriptValidatedAt,
          },
          finalTranscriptionResult: commit.metadata,
        });
        assertValidTranscriptTrustCandidate(
          {
            transcript_status: 'validated',
            transcript_validated_at: transcriptValidatedAt,
            transcript_integrity_json: transcriptIntegrityJson,
            transcript_json: canonicalTranscriptJson,
          },
          'final_transcription_validated',
          { requireV2: true },
        );
        const outcome = (await invoke('COMMIT_FINAL_TRANSCRIPTION', {
          meetingId,
          runId,
          captureGeneration,
          canonicalTranscriptJson,
          transcriptIntegrityJson,
          transcriptValidatedAt,
        })) as { committed?: boolean; transcriptJson?: string } | false;
        return outcome && outcome.committed === true
          ? {
              committed: true,
              transcript: JSON.parse(
                outcome.transcriptJson || canonicalTranscriptJson,
              ),
            }
          : { committed: false };
      },
      markNeedsAttention: async ({ failure, lease }) => {
        if (lease) {
          await invoke(
            'FAIL_FINAL_TRANSCRIPTION',
            meetingId,
            lease.runId,
            failure,
          );
        }
      },
      startAnalysis: async () => {
        await processValidatedMeetingDownstream(meetingId, invoke);
        return committedSegments.length;
      },
    },
  );
  if (outcome.status === 'validated' || outcome.status === 'superseded') {
    clearFinalTranscriptionVocabulary(meetingId);
  }
  return outcome;
};
