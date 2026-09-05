import type { Meeting } from '../../types.ts';
import type { AttributionSegment } from '../../utils/speakerAttribution.ts';
import { isVerifiedSpeakerAttribution } from '../../utils/speakerAttributionTrust.ts';
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
import { hasCompleteSystemCapture } from './systemCaptureEvidence.ts';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

const rebuildSealedAudioForRetry = async (
  meeting: Meeting,
  invoke: Invoke,
): Promise<Meeting> => {
  const meetingId = String(meeting.id);
  const journal = (await invoke('AUDIO_CAPTURE_JOURNAL_READ', {
    meetingId,
  })) as {
    schemaVersion?: unknown;
    lifecycleState?: unknown;
    generation?: unknown;
    intervals?: Array<{ sources?: { system?: { disposition?: unknown } } }>;
  } | null;
  if (
    journal?.schemaVersion !== 3 ||
    journal.lifecycleState !== 'sealed' ||
    journal.generation !== meeting.capture_journal_generation
  ) {
    throw new Error('sealed_capture_generation_unavailable');
  }
  const intervals = journal.intervals;
  if (
    !Array.isArray(intervals) ||
    intervals.length === 0 ||
    !intervals.every((interval) =>
      ['captured', 'verified_silence'].includes(
        String(interval.sources?.system?.disposition),
      ),
    )
  ) {
    throw new Error('sealed_capture_system_incomplete');
  }
  if (!meeting.audio_path) throw new Error('sealed_capture_mic_unavailable');

  const createdPaths: string[] = [];
  try {
    const systemAudioPath = await invoke(
      'AUDIO_CAPTURE_JOURNAL_STITCH_SOURCE',
      {
        meetingId,
        source: 'system',
        outputTag: `${meetingId}-repaired-system`,
      },
    );
    if (typeof systemAudioPath !== 'string' || systemAudioPath.length === 0) {
      throw new Error('sealed_capture_system_rebuild_failed');
    }
    createdPaths.push(systemAudioPath);

    const mixedAudioPath = await invoke('AUDIO_MIX_WAV', {
      inputPaths: [meeting.audio_path, systemAudioPath],
      outputTag: `${meetingId}-repaired-mix`,
    });
    if (typeof mixedAudioPath !== 'string' || mixedAudioPath.length === 0) {
      throw new Error('sealed_capture_mix_rebuild_failed');
    }
    createdPaths.push(mixedAudioPath);

    const rebuiltMeeting = {
      ...meeting,
      system_audio_path: systemAudioPath,
      mixed_audio_path: mixedAudioPath,
      transcript_validated_at:
        meeting.transcript_status === 'validated'
          ? meeting.transcript_validated_at
          : undefined,
    };
    if ((await invoke('SAVE_MEETING', rebuiltMeeting)) === false) {
      throw new Error('sealed_capture_audio_save_superseded');
    }
    return rebuiltMeeting;
  } catch (error) {
    if (createdPaths.length > 0) {
      await invoke('AUDIO_DELETE_FILES', createdPaths).catch(() => null);
    }
    throw error;
  }
};

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
  inputMeeting: Meeting,
  invoke: Invoke,
  options: {
    signal?: AbortSignal;
    runId?: string;
    manualRetry?: boolean;
    rebuildSealedAudio?: boolean;
    onTranscriptCommitted?: () => Promise<void> | void;
  } = {},
): Promise<FinalTranscriptionOutcome> => {
  const meeting = options.rebuildSealedAudio
    ? await rebuildSealedAudioForRetry(inputMeeting, invoke)
    : inputMeeting;
  const captureGeneration = meeting.capture_journal_generation || '';
  const integrity = parseObject(
    meeting.transcript_integrity_json,
  ) as StoredIntegrity;
  const activityEvidence = await readSealedActivityEvidence(integrity);
  const provisional = parseProvisionalTranscript(meeting.transcript_json);
  // A retry changes canonical attribution, not the original live evidence.
  const savedLiveSegments = provisional.payload.liveSegments;
  const liveSegments =
    Array.isArray(savedLiveSegments) &&
    savedLiveSegments.every((segment) => {
      if (!segment || typeof segment !== 'object') return false;
      const row = segment as Partial<AttributionSegment>;
      return (
        typeof row.text === 'string' &&
        typeof row.speaker === 'string' &&
        typeof row.startTime === 'number' &&
        typeof row.endTime === 'number' &&
        Number.isFinite(row.startTime) &&
        Number.isFinite(row.endTime) &&
        row.startTime >= 0 &&
        row.endTime >= row.startTime
      );
    })
      ? savedLiveSegments
      : provisional.segments;
  const runId = options.runId ?? crypto.randomUUID();
  const meetingId = String(meeting.id);
  const language = provisional.payload.transcription?.language || 'en';
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
  let systemCaptureComplete = false;
  try {
    systemCaptureComplete =
      options.rebuildSealedAudio === true ||
      hasCompleteSystemCapture(
        await invoke('AUDIO_CAPTURE_JOURNAL_READ', { meetingId }),
        captureGeneration,
      );
  } catch {
    // A missing journal cannot establish that a quiet System WAV is complete.
  }

  const outcome = await runFinalTranscription(
    {
      meetingId,
      runId,
      captureEvidence: {
        sealed: Boolean(activityEvidence && captureGeneration),
        generation: captureGeneration,
        systemCaptureIncomplete: !systemCaptureComplete,
      },
      recordingDurationSeconds: meeting.duration_seconds || 0,
      micAudioPath: meeting.audio_path || '',
      mixedAudioPath: meeting.mixed_audio_path || '',
      systemAudioPath: meeting.system_audio_path || '',
      provisionalSegments: provisional.segments,
      // An explicit retranscription must rebuild machine text too, otherwise
      // echo fragments retained by a previous validated run survive forever.
      preserveProvisionalText:
        meeting.transcript_status === 'validated' && !options.manualRetry,
      activityWindows: activityEvidence?.windows || [],
      language,
      vocabulary,
      vocabularyPolicyVersion:
        provisional.payload.transcription?.vocabularyHintPolicyVersion,
      signal: options.signal,
    },
    {
      claimLease: async (lease) =>
        (await invoke('CLAIM_FINAL_TRANSCRIPTION', meetingId, lease, {
          manualRetry: options.manualRetry === true,
        })) === true,
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
      speakerEvidence: async (request) =>
        (await invoke('TRANSCRIPTION_SPEAKER_EVIDENCE', request)) as never,
      probeDuration: async (audioPath) =>
        (await invoke('AUDIO_PROBE_DURATION', audioPath)) as number | null,
      commitCanonical: async (commit) => {
        const speakerAttribution = commit.metadata.speakerAttribution as
          | StoredTranscriptSpeakerAttribution
          | undefined;
        const {
          speakerAttribution: _speakerAttribution,
          speakerEvidence: _speakerEvidence,
          ...finalTranscriptionResult
        } = commit.metadata;
        if (
          !speakerAttribution ||
          !isVerifiedSpeakerAttribution(speakerAttribution)
        ) {
          throw new Error(
            'invalid_transcript_trust_candidate:final_transcription_validated:speaker_attribution_unverified',
          );
        }
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
              diarization:
                speakerAttribution.source !== 'recovered_channel_acoustic_v1' &&
                speakerAttribution.source !== 'recovered_channel_acoustic_v2' &&
                speakerAttribution.diarizationAttempted,
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
            liveSegments,
          }),
        );
        const transcriptIntegrityJson = JSON.stringify({
          schemaVersion: 2,
          state: 'validated',
          causes: [],
          speakerAttributionVerified: true,
          evidenceProvenance: integrity.evidenceProvenance,
          activityEvidence: integrity.activityEvidence,
          evidence: commit.integrity,
          validationProof: {
            gateVersion: 'canonical_integrity_v1',
            validatedAt: transcriptValidatedAt,
          },
          finalTranscriptionResult,
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
          speakerCandidates: commit.speakerCandidates,
        })) as { committed?: boolean; transcriptJson?: string } | false;
        if (outcome && outcome.committed === true) {
          await options.onTranscriptCommitted?.();
          return {
            committed: true,
            transcript: JSON.parse(
              outcome.transcriptJson || canonicalTranscriptJson,
            ),
          };
        }
        return { committed: false };
      },
      markNeedsAttention: async ({ failure, lease, reasons }) => {
        if (lease) {
          await invoke(
            'FAIL_FINAL_TRANSCRIPTION',
            meetingId,
            lease.runId,
            failure,
            reasons ?? [],
          );
        }
      },
      startAnalysis: async () => {
        void processValidatedMeetingDownstream(meetingId, invoke).catch(
          (error) => {
            console.error(
              '[Pluto] Post-transcription notes processing failed',
              error,
            );
          },
        );
        return committedSegments.length;
      },
    },
  );
  if (outcome.status === 'validated' || outcome.status === 'superseded') {
    clearFinalTranscriptionVocabulary(meetingId);
  }
  return outcome;
};
