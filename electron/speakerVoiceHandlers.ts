import type Database from 'better-sqlite3';
import {
  ENROLLMENT_EXTRACTION_VERSION,
  type SpeakerCandidateEvidence,
  isCandidateEligibleForEnrollment,
} from '../src/services/speakerCandidateEvidence';
import {
  DEFAULT_CALIBRATION_POLICY_V1,
  isProvenanceCompatible,
  matchSpeakerVoice,
} from '../src/services/speakerVoiceMatcher';
import * as db from './db';
import {
  getSpeakerEnrollmentAvailability,
  isSpeakerEnrollmentSourceCurrent,
} from './speakerEnrollmentCandidate';
import {
  deleteVoiceProfile,
  enrollSpeakerVoice,
  getCanonicalVoiceProfiles,
  getMeetingSpeakerCandidates,
  getVoiceCandidateAttempt,
  getVoiceProfileOptOuts,
  getVoiceRejections,
  isVoiceProfileOptedOut,
  recordVoiceCandidateAttempt,
  recordVoiceRejection,
  resolvePersonId,
  saveMeetingSpeakerCandidate,
  setVoiceProfileStatus,
} from './speakerVoiceStore';

export const SPEAKER_VOICE_CHANNELS = [
  'SPEAKER_VOICE_GET_SUGGESTIONS',
  'SPEAKER_VOICE_ENROLL',
  'SPEAKER_VOICE_REJECT',
  'SPEAKER_VOICE_GET_PROFILES',
  'SPEAKER_VOICE_SET_STATUS',
  'SPEAKER_VOICE_DELETE',
  'SPEAKER_VOICE_GET_REFERENCE_SAMPLE',
] as const;

export type SpeakerVoiceChannel = (typeof SPEAKER_VOICE_CHANNELS)[number];

export interface SpeakerVoiceDependencies {
  signal?: AbortSignal;
  awaitCandidateCleanup?: boolean;
  dbInstance?: Database.Database;
  isFeatureFlagEnabled?: () => boolean;
  getMeeting?: (meetingId: string) => db.PersistedMeeting | null;
  fileExists?: (path: string) => boolean;
  createTemporaryPath?: () => string;
  sliceWav?: (opts: {
    inputPath: string;
    outputPath: string;
    startSec: number;
    durationSec: number;
  }) => Promise<boolean>;
  readFile?: (path: string) => Promise<Buffer>;
  removeFile?: (path: string) => Promise<void>;
  readEncryptedSlice?: (input: {
    meetingId: string;
    inputPath: string;
    startSec: number;
    durationSec: number;
  }) => Promise<Buffer | null>;
  reconciliationTimeoutMs?: number;
  allowCandidateBuild?: boolean;
  scheduleCandidateBackfill?: (meetingId: string) => void;
  buildEnrollmentCandidate?: (input: {
    meetingId: string;
    speaker: string;
    signal?: AbortSignal;
  }) => Promise<{
    candidate: SpeakerCandidateEvidence;
    sourceRevision: string;
    timings?: {
      candidateConstructionMs: number;
      initialInferenceMs: number;
      representativeInferencesMs: number[];
    };
  } | null>;
}

type ConfirmedSpeakerBinding = {
  meetingId: string;
  speaker: string;
  sourceRevision: string;
};

const MAX_RECONCILIATION_SOURCES_PER_PERSON = 3;
const CANDIDATE_RETRY_DELAY_MS = 5 * 60 * 1000;

const candidateFailureReason = (error: unknown): string =>
  error instanceof Error && error.message === 'speaker_enrollment_timeout'
    ? 'timed_out'
    : 'native_runtime_failed';

const enrollmentSourceKey = (input: ConfirmedSpeakerBinding): string =>
  `${input.meetingId}\u0000${input.speaker}\u0000${input.sourceRevision}`;

const usesCurrentEnrollmentExtraction = (
  candidate: Pick<SpeakerCandidateEvidence, 'provenance'>,
): boolean =>
  candidate.provenance.enrollmentExtractionVersion ===
  ENROLLMENT_EXTRACTION_VERSION;

type ReconciliationOutcome =
  | 'enrolled'
  | 'already_enrolled'
  | 'queued'
  | 'evidence_unavailable'
  | 'failed'
  | 'opted_out'
  | 'self';

const reconciliationRuns = new WeakMap<
  Database.Database,
  Map<string, Promise<Map<string, ReconciliationOutcome>>>
>();

const getMeetingDependency = (
  deps: SpeakerVoiceDependencies | undefined,
  d: Database.Database,
  meetingId: string,
): db.PersistedMeeting | null => {
  if (deps?.getMeeting) return deps.getMeeting(meetingId);
  return (
    (d.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId) as
      | db.PersistedMeeting
      | undefined) ?? null
  );
};

const isCurrentEligibleCandidate = (
  meetingId: string,
  sourceRevision: string,
  candidate: SpeakerCandidateEvidence,
  deps: SpeakerVoiceDependencies | undefined,
  d: Database.Database,
): boolean =>
  candidate.isEligibleForEnrollment &&
  isCandidateEligibleForEnrollment(candidate) &&
  isProvenanceCompatible(
    candidate.provenance,
    DEFAULT_CALIBRATION_POLICY_V1.compatibilityKey,
  ) &&
  isSpeakerEnrollmentSourceCurrent(meetingId, sourceRevision, {
    getMeeting: (id) => getMeetingDependency(deps, d, id),
  });

const getCurrentConfirmedBinding = (
  meetingId: string,
  speaker: string,
  canonicalPersonId: string,
  d: Database.Database,
): { enrollmentPersonId: string; rawPayload: string } | null => {
  const row = d
    .prepare(
      'SELECT payload FROM identity_bindings WHERE meeting_id = ? AND speaker = ?',
    )
    .get(meetingId, speaker) as { payload: string } | undefined;
  if (!row) return null;
  const payload = JSON.parse(row.payload) as {
    source?: unknown;
    individual?: unknown;
    personId?: unknown;
  };
  if (
    payload.source !== 'user' ||
    payload.individual !== true ||
    typeof payload.personId !== 'string' ||
    resolvePersonId(payload.personId, d) !== canonicalPersonId
  ) {
    return null;
  }
  return { enrollmentPersonId: payload.personId, rawPayload: row.payload };
};

const isWorkspaceOwner = (
  canonicalPersonId: string,
  d: Database.Database,
): boolean => {
  const row = d
    .prepare(
      'SELECT self_person_id FROM identity_workspace WHERE singleton = 1',
    )
    .get() as { self_person_id: string | null } | undefined;
  return Boolean(
    row?.self_person_id &&
      resolvePersonId(row.self_person_id, d) === canonicalPersonId,
  );
};

const buildCandidateWithTimeout = async (
  deps: SpeakerVoiceDependencies | undefined,
  input: {
    meetingId: string;
    speaker: string;
  },
  timeoutMs = 30000,
): Promise<{
  candidate: SpeakerCandidateEvidence;
  sourceRevision: string;
  timings?: {
    candidateConstructionMs: number;
    initialInferenceMs: number;
    representativeInferencesMs: number[];
  };
} | null> => {
  if (!deps?.buildEnrollmentCandidate) return null;
  deps.signal?.throwIfAborted();
  const abortController = new AbortController();
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      abortController.abort();
      reject(new Error('speaker_enrollment_timeout'));
    }, timeoutMs);
  });
  const build = deps.buildEnrollmentCandidate({
    meetingId: input.meetingId,
    speaker: input.speaker,
    signal: deps.signal
      ? AbortSignal.any([deps.signal, abortController.signal])
      : abortController.signal,
  });
  try {
    const result = await Promise.race([build, timeoutPromise]);
    deps.signal?.throwIfAborted();
    return result;
  } catch (err) {
    if (deps.awaitCandidateCleanup) await build.catch(() => undefined);
    deps.signal?.throwIfAborted();
    if (abortController.signal.aborted) {
      throw new Error('speaker_enrollment_timeout');
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const candidateBuildRuns = new WeakMap<
  Database.Database,
  Map<string, ReturnType<typeof buildCandidateWithTimeout>>
>();

const buildCandidateOnce = async (
  deps: SpeakerVoiceDependencies | undefined,
  d: Database.Database,
  input: { meetingId: string; speaker: string },
  timeoutMs: number,
): ReturnType<typeof buildCandidateWithTimeout> => {
  let runs = candidateBuildRuns.get(d);
  if (!runs) {
    runs = new Map();
    candidateBuildRuns.set(d, runs);
  }
  const key = `${input.meetingId}\u0000${input.speaker}`;
  const existing = runs.get(key);
  if (existing) return await existing;
  const run = buildCandidateWithTimeout(deps, input, timeoutMs);
  runs.set(key, run);
  try {
    return await run;
  } finally {
    if (runs.get(key) === run) runs.delete(key);
    if (runs.size === 0) candidateBuildRuns.delete(d);
  }
};

const scheduledReconciliations = new WeakMap<
  Database.Database,
  NodeJS.Timeout
>();

export function cancelScheduledVoiceProfileReconciliation(
  d: Database.Database = db.db,
): void {
  const existing = scheduledReconciliations.get(d);
  if (existing) {
    clearTimeout(existing);
    scheduledReconciliations.delete(d);
  }
}

export function scheduleBackgroundVoiceProfileReconciliation(
  deps?: SpeakerVoiceDependencies,
  d: Database.Database = db.db,
  delayMs = 1000,
): void {
  const existing = scheduledReconciliations.get(d);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    scheduledReconciliations.delete(d);
    void reconcileConfirmedSpeakerVoiceProfiles(deps, d).catch((err) => {
      console.warn(
        '[Pluto][SpeakerVoice] background reconciliation failed',
        err,
      );
    });
  }, delayMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  scheduledReconciliations.set(d, timer);
}

export async function reconcileConfirmedSpeakerVoiceProfiles(
  deps: SpeakerVoiceDependencies | undefined,
  d: Database.Database,
  targetPersonId?: string,
): Promise<Map<string, ReconciliationOutcome>> {
  const buildEnrollmentCandidate = deps?.buildEnrollmentCandidate;
  if (!buildEnrollmentCandidate) return new Map();

  const runKey = targetPersonId ? resolvePersonId(targetPersonId, d) : '*';
  let runs = reconciliationRuns.get(d);
  if (!runs) {
    runs = new Map();
    reconciliationRuns.set(d, runs);
  }
  const existingRun = runs.get(runKey);
  if (existingRun) return await existingRun;

  const run = (async () => {
    const outcomes = new Map<string, ReconciliationOutcome>();
    const profiledPeople = new Set(
      getCanonicalVoiceProfiles({ dbInstance: d }).map(
        (profile) => profile.canonicalPersonId,
      ),
    );
    const currentSourcesByPerson = new Map<string, Set<string>>();
    const enrollmentRows = d
      .prepare(
        `SELECT person_id, source_meeting_id, source_revision, speaker, provenance_json
         FROM speaker_voice_enrollments`,
      )
      .all() as Array<{
      person_id: string;
      source_meeting_id: string;
      source_revision: string;
      speaker: string;
      provenance_json: string;
    }>;
    for (const enrollment of enrollmentRows) {
      let provenance: SpeakerCandidateEvidence['provenance'];
      try {
        provenance = JSON.parse(enrollment.provenance_json);
      } catch {
        continue;
      }
      if (
        provenance.enrollmentExtractionVersion !== ENROLLMENT_EXTRACTION_VERSION
      ) {
        continue;
      }
      const canonicalPersonId = resolvePersonId(enrollment.person_id, d);
      const sources =
        currentSourcesByPerson.get(canonicalPersonId) ?? new Set();
      sources.add(
        enrollmentSourceKey({
          meetingId: enrollment.source_meeting_id,
          speaker: enrollment.speaker,
          sourceRevision: enrollment.source_revision,
        }),
      );
      currentSourcesByPerson.set(canonicalPersonId, sources);
    }
    const disabledPeople = new Set(
      (
        d
          .prepare(
            'SELECT person_id FROM speaker_voice_profile_settings WHERE is_active = 0',
          )
          .all() as Array<{ person_id: string }>
      ).map((row) => resolvePersonId(row.person_id, d)),
    );
    const selfRow = d
      .prepare(
        'SELECT self_person_id FROM identity_workspace WHERE singleton = 1',
      )
      .get() as { self_person_id: string | null } | undefined;
    const selfPersonId = selfRow?.self_person_id
      ? resolvePersonId(selfRow.self_person_id, d)
      : null;

    const rows = d
      .prepare(
        `SELECT binding.meeting_id, binding.speaker, binding.payload,
                meeting.capture_journal_generation AS source_revision
         FROM identity_bindings binding
         LEFT JOIN meetings meeting ON meeting.id = binding.meeting_id
         WHERE json_valid(binding.payload)
           AND json_extract(binding.payload, '$.source') = 'user'
           AND json_extract(binding.payload, '$.individual') = 1
           AND json_type(binding.payload, '$.personId') = 'text'
         ORDER BY datetime(COALESCE(meeting.started_at, meeting.created_at)) DESC,
                  binding.meeting_id DESC`,
      )
      .all() as Array<{
      meeting_id: string;
      speaker: string;
      payload: string;
      source_revision: string | null;
    }>;

    const bindingsByPerson = new Map<string, ConfirmedSpeakerBinding[]>();
    for (const row of rows) {
      const payload = JSON.parse(row.payload) as { personId?: unknown };
      if (typeof payload.personId !== 'string') continue;
      const personId = resolvePersonId(payload.personId, d);
      if (runKey !== '*' && personId !== runKey) continue;
      if (personId === selfPersonId) {
        outcomes.set(personId, 'self');
        continue;
      }
      if (disabledPeople.has(personId)) {
        outcomes.set(personId, 'opted_out');
        continue;
      }
      if (!row.source_revision) continue;
      const binding = {
        meetingId: row.meeting_id,
        speaker: row.speaker,
        sourceRevision: row.source_revision,
      };
      if (
        currentSourcesByPerson.get(personId)?.has(enrollmentSourceKey(binding))
      ) {
        if (profiledPeople.has(personId)) {
          outcomes.set(personId, 'already_enrolled');
        }
        continue;
      }
      const bindings = bindingsByPerson.get(personId) ?? [];
      if (
        !bindings.some(
          (existing) =>
            enrollmentSourceKey(existing) === enrollmentSourceKey(binding),
        )
      ) {
        bindings.push(binding);
      }
      bindingsByPerson.set(personId, bindings);
    }

    for (const [personId, bindings] of bindingsByPerson) {
      let sawFailure = false;
      let enrolledSources = 0;
      for (const binding of bindings.slice(
        0,
        MAX_RECONCILIATION_SOURCES_PER_PERSON,
      )) {
        try {
          const storedCandidate = getMeetingSpeakerCandidates(
            binding.meetingId,
            d,
          ).find((candidate) => candidate.speaker === binding.speaker);
          const usesStoredCandidate = Boolean(
            storedCandidate &&
              usesCurrentEnrollmentExtraction(storedCandidate) &&
              storedCandidate.sourceRevision === binding.sourceRevision,
          );
          const previousAttempt = getVoiceCandidateAttempt(
            {
              meetingId: binding.meetingId,
              speaker: binding.speaker,
              sourceRevision: binding.sourceRevision,
              extractionVersion: ENROLLMENT_EXTRACTION_VERSION,
            },
            d,
          );
          if (
            !usesStoredCandidate &&
            (previousAttempt?.status === 'abstained' ||
              (previousAttempt?.status === 'retryable_failure' &&
                (previousAttempt.retryAfter ?? 0) > Date.now()))
          ) {
            continue;
          }
          let built: {
            candidate: SpeakerCandidateEvidence;
            sourceRevision: string;
            timings?: {
              candidateConstructionMs: number;
              initialInferenceMs: number;
              representativeInferencesMs: number[];
            };
          } | null;
          if (storedCandidate && usesStoredCandidate) {
            built = {
              candidate: storedCandidate,
              sourceRevision: storedCandidate.sourceRevision,
            };
          } else {
            try {
              built = await buildCandidateOnce(
                deps,
                d,
                {
                  meetingId: binding.meetingId,
                  speaker: binding.speaker,
                },
                deps?.reconciliationTimeoutMs ?? 15000,
              );
            } catch (error) {
              deps?.signal?.throwIfAborted();
              sawFailure = true;
              recordVoiceCandidateAttempt(
                {
                  meetingId: binding.meetingId,
                  speaker: binding.speaker,
                  sourceRevision: binding.sourceRevision,
                  extractionVersion: ENROLLMENT_EXTRACTION_VERSION,
                  status: 'retryable_failure',
                  reason: candidateFailureReason(error),
                  retryAfter: Date.now() + CANDIDATE_RETRY_DELAY_MS,
                },
                d,
              );
              continue;
            }
          }
          if (
            !built ||
            built.candidate.speaker !== binding.speaker ||
            !built.sourceRevision ||
            !usesCurrentEnrollmentExtraction(built.candidate)
          ) {
            recordVoiceCandidateAttempt(
              {
                meetingId: binding.meetingId,
                speaker: binding.speaker,
                sourceRevision: binding.sourceRevision,
                extractionVersion: ENROLLMENT_EXTRACTION_VERSION,
                status: 'abstained',
                reason: 'evidence_unavailable',
                retryAfter: null,
              },
              d,
            );
            continue;
          }

          if (!usesStoredCandidate) {
            saveMeetingSpeakerCandidate(
              binding.meetingId,
              built.sourceRevision,
              built.candidate,
              d,
            );
            recordVoiceCandidateAttempt(
              {
                meetingId: binding.meetingId,
                speaker: binding.speaker,
                sourceRevision: built.sourceRevision,
                extractionVersion: ENROLLMENT_EXTRACTION_VERSION,
                status: 'eligible',
                reason: null,
                retryAfter: null,
              },
              d,
            );
          }

          if (
            !isCurrentEligibleCandidate(
              binding.meetingId,
              built.sourceRevision,
              built.candidate,
              deps,
              d,
            )
          ) {
            recordVoiceCandidateAttempt(
              {
                meetingId: binding.meetingId,
                speaker: binding.speaker,
                sourceRevision: built.sourceRevision,
                extractionVersion: ENROLLMENT_EXTRACTION_VERSION,
                status: 'abstained',
                reason: 'insufficient_clean_speech',
                retryAfter: null,
              },
              d,
            );
            continue;
          }

          d.transaction(() => {
            const currentBinding = getCurrentConfirmedBinding(
              binding.meetingId,
              binding.speaker,
              personId,
              d,
            );
            if (
              !currentBinding ||
              isWorkspaceOwner(personId, d) ||
              isVoiceProfileOptedOut(personId, d) ||
              !isCurrentEligibleCandidate(
                binding.meetingId,
                built.sourceRevision,
                built.candidate,
                deps,
                d,
              )
            ) {
              throw new Error('speaker_enrollment_no_longer_allowed');
            }
            enrollSpeakerVoice(
              {
                personId: currentBinding.enrollmentPersonId,
                sourceMeetingId: binding.meetingId,
                sourceRevision: built.sourceRevision,
                speaker: binding.speaker,
                candidateDigest: built.candidate.candidateDigest,
              },
              d,
            );
          })();
          profiledPeople.add(personId);
          enrolledSources += 1;
        } catch (error) {
          deps?.signal?.throwIfAborted();
          sawFailure = true;
          console.warn(
            '[Pluto][SpeakerVoice] confirmed profile reconciliation failed',
            error,
          );
        }
      }
      if (enrolledSources > 0) {
        outcomes.set(personId, 'enrolled');
      } else if (!outcomes.has(personId)) {
        outcomes.set(
          personId,
          isVoiceProfileOptedOut(personId, d)
            ? 'opted_out'
            : sawFailure
              ? 'failed'
              : 'evidence_unavailable',
        );
      }
    }
    return outcomes;
  })();

  runs.set(runKey, run);
  try {
    return await run;
  } finally {
    if (runs.get(runKey) === run) runs.delete(runKey);
    if (runs.size === 0) reconciliationRuns.delete(d);
  }
}

export async function handleSpeakerVoiceRequest(
  channel: SpeakerVoiceChannel,
  payload: any,
  deps?: SpeakerVoiceDependencies,
): Promise<unknown> {
  const d = deps?.dbInstance ?? db.db;

  switch (channel) {
    case 'SPEAKER_VOICE_GET_SUGGESTIONS': {
      const meetingId = String(payload?.meetingId ?? '');
      if (!meetingId) {
        return {
          suggestions: {},
          candidates: {},
          enrollmentAvailability: {},
        };
      }

      if (deps?.allowCandidateBuild !== false && payload?.syncReconciliation) {
        await reconcileConfirmedSpeakerVoiceProfiles(deps, d);
      }

      const getMeeting =
        deps?.getMeeting ??
        ((id: string) =>
          (db.getMeeting(id) as db.PersistedMeeting | undefined) ?? null);
      const meeting = getMeeting(meetingId);
      const fileExists = deps?.fileExists ?? require('node:fs').existsSync;
      const enrollmentAvailability = getSpeakerEnrollmentAvailability(
        meetingId,
        {
          getMeeting: () => meeting,
          fileExists,
        },
      );

      let candidates = getMeetingSpeakerCandidates(meetingId, d);
      const candidateAttempts: Record<
        string,
        {
          status: 'eligible' | 'queued' | 'abstained' | 'retryable_failure';
          reason?: string;
          retryAfter?: number;
        }
      > = {};
      const candidatesBySpeaker = new Map(
        candidates.map((candidate) => [candidate.speaker, candidate]),
      );
      const speakers = new Set([
        ...candidatesBySpeaker.keys(),
        ...Object.keys(enrollmentAvailability),
      ]);
      if (
        deps?.buildEnrollmentCandidate &&
        deps.allowCandidateBuild === false
      ) {
        let needsBackfill = false;
        for (const speaker of speakers) {
          const candidate = candidatesBySpeaker.get(speaker);
          const sourceRevision =
            candidate?.sourceRevision ?? meeting?.capture_journal_generation;
          if (!candidate && !enrollmentAvailability[speaker]) {
            candidateAttempts[speaker] = {
              status: 'abstained',
              reason: 'insufficient_clean_speech',
            };
            continue;
          }
          if (!sourceRevision) {
            candidateAttempts[speaker] = {
              status: 'abstained',
              reason: 'evidence_unavailable',
            };
            continue;
          }
          if (candidate && usesCurrentEnrollmentExtraction(candidate)) {
            candidateAttempts[speaker] = candidate.isEligibleForEnrollment
              ? { status: 'eligible' }
              : {
                  status: 'abstained',
                  reason: 'insufficient_clean_speech',
                };
            continue;
          }
          const previousAttempt = getVoiceCandidateAttempt(
            {
              meetingId,
              speaker,
              sourceRevision,
              extractionVersion: ENROLLMENT_EXTRACTION_VERSION,
            },
            d,
          );
          if (
            previousAttempt?.status === 'abstained' ||
            (previousAttempt?.status === 'retryable_failure' &&
              (previousAttempt.retryAfter ?? 0) > Date.now())
          ) {
            candidateAttempts[speaker] = {
              status: previousAttempt.status,
              ...(previousAttempt.reason
                ? { reason: previousAttempt.reason }
                : {}),
              ...(previousAttempt.retryAfter
                ? { retryAfter: previousAttempt.retryAfter }
                : {}),
            };
            continue;
          }
          candidateAttempts[speaker] = { status: 'queued' };
          needsBackfill = true;
        }
        if (needsBackfill) deps.scheduleCandidateBackfill?.(meetingId);
      }
      if (
        deps?.buildEnrollmentCandidate &&
        deps.allowCandidateBuild !== false
      ) {
        for (const speaker of speakers) {
          const candidate = candidatesBySpeaker.get(speaker);
          const sourceRevision =
            candidate?.sourceRevision ?? meeting?.capture_journal_generation;
          if (!candidate && !enrollmentAvailability[speaker]) {
            candidateAttempts[speaker] = {
              status: 'abstained',
              reason: 'insufficient_clean_speech',
            };
            continue;
          }
          if (!sourceRevision) {
            candidateAttempts[speaker] = {
              status: 'abstained',
              reason: 'evidence_unavailable',
            };
            continue;
          }
          if (candidate && usesCurrentEnrollmentExtraction(candidate)) {
            candidateAttempts[speaker] = candidate.isEligibleForEnrollment
              ? { status: 'eligible' }
              : {
                  status: 'abstained',
                  reason: 'insufficient_clean_speech',
                };
            continue;
          }
          const previousAttempt = getVoiceCandidateAttempt(
            {
              meetingId,
              speaker,
              sourceRevision,
              extractionVersion: ENROLLMENT_EXTRACTION_VERSION,
            },
            d,
          );
          if (
            previousAttempt?.status === 'abstained' ||
            (previousAttempt?.status === 'retryable_failure' &&
              (previousAttempt.retryAfter ?? 0) > Date.now())
          ) {
            candidateAttempts[speaker] = {
              status: previousAttempt.status,
              ...(previousAttempt.reason
                ? { reason: previousAttempt.reason }
                : {}),
              ...(previousAttempt.retryAfter
                ? { retryAfter: previousAttempt.retryAfter }
                : {}),
            };
            continue;
          }
          try {
            const built = await buildCandidateOnce(
              deps,
              d,
              {
                meetingId,
                speaker,
              },
              deps?.reconciliationTimeoutMs ?? 15000,
            );
            if (
              built &&
              built.candidate.speaker === speaker &&
              usesCurrentEnrollmentExtraction(built.candidate) &&
              built.sourceRevision
            ) {
              saveMeetingSpeakerCandidate(
                meetingId,
                built.sourceRevision,
                built.candidate,
                d,
              );
              recordVoiceCandidateAttempt(
                {
                  meetingId,
                  speaker,
                  sourceRevision: built.sourceRevision,
                  extractionVersion: ENROLLMENT_EXTRACTION_VERSION,
                  status: 'eligible',
                  reason: null,
                  retryAfter: null,
                },
                d,
              );
              candidateAttempts[speaker] = { status: 'eligible' };
            } else {
              recordVoiceCandidateAttempt(
                {
                  meetingId,
                  speaker,
                  sourceRevision,
                  extractionVersion: ENROLLMENT_EXTRACTION_VERSION,
                  status: 'abstained',
                  reason: 'evidence_unavailable',
                  retryAfter: null,
                },
                d,
              );
              candidateAttempts[speaker] = {
                status: 'abstained',
                reason: 'evidence_unavailable',
              };
            }
          } catch (error) {
            deps?.signal?.throwIfAborted();
            const reason = candidateFailureReason(error);
            const retryAfter = Date.now() + CANDIDATE_RETRY_DELAY_MS;
            recordVoiceCandidateAttempt(
              {
                meetingId,
                speaker,
                sourceRevision,
                extractionVersion: ENROLLMENT_EXTRACTION_VERSION,
                status: 'retryable_failure',
                reason,
                retryAfter,
              },
              d,
            );
            candidateAttempts[speaker] = {
              status: 'retryable_failure',
              reason,
              retryAfter,
            };
          }
        }
        candidates = getMeetingSpeakerCandidates(meetingId, d);
      }
      const clientCandidates: Record<string, unknown> = {};
      for (const candidate of candidates) {
        const current = usesCurrentEnrollmentExtraction(candidate);
        const attempt = candidateAttempts[candidate.speaker];
        clientCandidates[candidate.speaker] = {
          candidateDigest: candidate.candidateDigest,
          sourceRevision: candidate.sourceRevision,
          isEligibleForEnrollment: current && candidate.isEligibleForEnrollment,
          cleanDurationSeconds: current ? candidate.cleanDurationSeconds : 0,
          analysisStatus:
            attempt?.status ??
            (current && candidate.isEligibleForEnrollment
              ? 'eligible'
              : 'abstained'),
          ...(attempt?.reason ? { analysisReason: attempt.reason } : {}),
          ...(attempt?.retryAfter ? { retryAfter: attempt.retryAfter } : {}),
        };
      }
      for (const [speaker, attempt] of Object.entries(candidateAttempts)) {
        if (clientCandidates[speaker]) continue;
        clientCandidates[speaker] = {
          sourceRevision: meeting?.capture_journal_generation ?? '',
          isEligibleForEnrollment: false,
          cleanDurationSeconds: 0,
          analysisStatus: attempt.status,
          ...(attempt.reason ? { analysisReason: attempt.reason } : {}),
          ...(attempt.retryAfter ? { retryAfter: attempt.retryAfter } : {}),
        };
      }

      const profiles = getCanonicalVoiceProfiles({
        dbInstance: d,
        activeOnly: true,
      });
      const calibrationFlagEnabled =
        deps?.isFeatureFlagEnabled?.() ??
        (db.getSetting('voice_profile_suggestions_v1') === 'true' ||
          process.env.VOICE_PROFILE_SUGGESTIONS_V1 === 'true');

      // Explicitly enrolling an active profile is the user's opt-in to future
      // recognition. The flag remains available for calibration before any
      // real profile exists, but must not make an enrolled profile inert.
      if (!calibrationFlagEnabled && profiles.length === 0) {
        return {
          suggestions: {},
          candidates: clientCandidates,
          enrollmentAvailability,
        };
      }
      const rejections = getVoiceRejections(meetingId, d);

      const suggestions: Record<string, unknown> = {};

      for (const candidate of candidates) {
        if (!usesCurrentEnrollmentExtraction(candidate)) continue;
        const match = matchSpeakerVoice({
          meetingId,
          sourceRevision: candidate.sourceRevision,
          candidate,
          profiles,
          rejections,
          calendarAttendeePersonIds: payload?.calendarAttendeePersonIds,
          options: { featureFlagEnabled: true },
        });

        if (match) {
          // Exclude raw embeddings completely
          suggestions[candidate.speaker] = {
            speaker: match.speaker,
            suggestedPersonId: match.suggestedPersonId,
            suggestedPersonName: match.suggestedPersonName,
            similarityScore: match.similarityScore,
            confidenceTier: match.confidenceTier,
            isCalendarAttendee: match.isCalendarAttendee,
            candidateDigest: match.candidateDigest,
            sourceRevision: match.sourceRevision,
            referenceInterval: match.referenceInterval,
          };
        }
      }

      return {
        suggestions,
        candidates: clientCandidates,
        enrollmentAvailability,
      };
    }

    case 'SPEAKER_VOICE_ENROLL': {
      const {
        personId,
        sourceMeetingId,
        sourceRevision,
        speaker,
        candidateDigest,
        expectedRevision,
        timeoutMs = 30000,
      } = payload ?? {};

      if (
        typeof expectedRevision !== 'number' ||
        expectedRevision > db.identityStore.getRevision()
      ) {
        throw new Error('identity_revision_stale');
      }

      const canonicalPersonId = resolvePersonId(String(personId ?? ''), d);
      const bindingMatches = () =>
        getCurrentConfirmedBinding(
          String(sourceMeetingId ?? ''),
          String(speaker ?? ''),
          canonicalPersonId,
          d,
        );
      const initialBinding = bindingMatches();
      if (!initialBinding) throw new Error('speaker_enrollment_unconfirmed');
      if (isWorkspaceOwner(canonicalPersonId, d)) {
        throw new Error('speaker_enrollment_self_disallowed');
      }
      if (isVoiceProfileOptedOut(canonicalPersonId, d)) {
        throw new Error('speaker_voice_profile_opted_out');
      }

      const suppliedCandidateIdentity =
        typeof sourceRevision === 'string' &&
        sourceRevision.length > 0 &&
        typeof candidateDigest === 'string' &&
        candidateDigest.length > 0;
      if (
        (sourceRevision !== undefined || candidateDigest !== undefined) &&
        !suppliedCandidateIdentity
      ) {
        throw new Error('speaker_candidate_invalid');
      }

      let enrollmentSourceRevision = sourceRevision as string | undefined;
      let enrollmentCandidateDigest = candidateDigest as string | undefined;
      let builtCandidate: SpeakerCandidateEvidence | null = null;
      let candidateTimings:
        | {
            candidateConstructionMs: number;
            initialInferenceMs: number;
            representativeInferencesMs: number[];
          }
        | undefined = undefined;

      if (suppliedCandidateIdentity) {
        const candidate = getMeetingSpeakerCandidates(
          String(sourceMeetingId),
          d,
        ).find(
          (entry) =>
            entry.speaker === speaker &&
            entry.sourceRevision === sourceRevision &&
            entry.candidateDigest === candidateDigest,
        );

        if (!candidate) {
          throw new Error('speaker_candidate_stale');
        }
        if (
          !isCurrentEligibleCandidate(
            String(sourceMeetingId),
            sourceRevision,
            candidate,
            deps,
            d,
          )
        ) {
          throw new Error('speaker_enrollment_evidence_unavailable');
        }
      } else {
        if (deps?.allowCandidateBuild === false) {
          deps.scheduleCandidateBackfill?.(String(sourceMeetingId));
          return { success: true, queued: true };
        }
        let built:
          | Awaited<ReturnType<typeof buildCandidateWithTimeout>>
          | undefined;
        try {
          built = await buildCandidateOnce(
            deps,
            d,
            {
              meetingId: String(sourceMeetingId ?? ''),
              speaker: String(speaker ?? ''),
            },
            timeoutMs,
          );
        } catch (error) {
          deps?.signal?.throwIfAborted();
          const meetingGen = getMeetingDependency(
            deps,
            d,
            String(sourceMeetingId),
          )?.capture_journal_generation;
          if (meetingGen) {
            recordVoiceCandidateAttempt(
              {
                meetingId: String(sourceMeetingId),
                speaker: String(speaker),
                sourceRevision: meetingGen,
                extractionVersion: ENROLLMENT_EXTRACTION_VERSION,
                status: 'retryable_failure',
                reason: candidateFailureReason(error),
                retryAfter: Date.now() + CANDIDATE_RETRY_DELAY_MS,
              },
              d,
            );
          }
          throw error;
        }

        if (
          !built ||
          !isCurrentEligibleCandidate(
            String(sourceMeetingId),
            built.sourceRevision,
            built.candidate,
            deps,
            d,
          ) ||
          built.candidate.speaker !== speaker ||
          !built.sourceRevision
        ) {
          const meetingGen = getMeetingDependency(
            deps,
            d,
            String(sourceMeetingId),
          )?.capture_journal_generation;
          if (meetingGen) {
            recordVoiceCandidateAttempt(
              {
                meetingId: String(sourceMeetingId),
                speaker: String(speaker),
                sourceRevision: meetingGen,
                extractionVersion: ENROLLMENT_EXTRACTION_VERSION,
                status: 'abstained',
                reason: 'evidence_unavailable',
                retryAfter: null,
              },
              d,
            );
          }
          throw new Error('speaker_enrollment_evidence_unavailable');
        }
        const currentBinding = bindingMatches();
        if (
          !currentBinding ||
          currentBinding.rawPayload !== initialBinding.rawPayload
        ) {
          throw new Error('identity_revision_stale');
        }
        builtCandidate = built.candidate;
        enrollmentSourceRevision = built.sourceRevision;
        enrollmentCandidateDigest = built.candidate.candidateDigest;
        candidateTimings = built.timings;
      }

      if (!enrollmentSourceRevision || !enrollmentCandidateDigest) {
        throw new Error('speaker_enrollment_evidence_unavailable');
      }

      const enrollment = d.transaction(() => {
        const currentBinding = bindingMatches();
        if (
          !currentBinding ||
          currentBinding.rawPayload !== initialBinding.rawPayload
        ) {
          throw new Error('identity_revision_stale');
        }
        if (isWorkspaceOwner(canonicalPersonId, d)) {
          throw new Error('speaker_enrollment_self_disallowed');
        }
        if (isVoiceProfileOptedOut(canonicalPersonId, d)) {
          throw new Error('speaker_voice_profile_opted_out');
        }
        const currentCandidate =
          builtCandidate ??
          getMeetingSpeakerCandidates(String(sourceMeetingId), d).find(
            (entry) =>
              entry.speaker === speaker &&
              entry.sourceRevision === enrollmentSourceRevision &&
              entry.candidateDigest === enrollmentCandidateDigest,
          );
        if (
          !currentCandidate ||
          !isCurrentEligibleCandidate(
            String(sourceMeetingId),
            enrollmentSourceRevision,
            currentCandidate,
            deps,
            d,
          )
        ) {
          throw new Error('speaker_enrollment_evidence_unavailable');
        }
        if (builtCandidate) {
          saveMeetingSpeakerCandidate(
            String(sourceMeetingId),
            enrollmentSourceRevision,
            builtCandidate,
            d,
          );
        }
        return enrollSpeakerVoice(
          {
            personId: currentBinding.enrollmentPersonId,
            sourceMeetingId,
            sourceRevision: enrollmentSourceRevision,
            speaker,
            candidateDigest: enrollmentCandidateDigest,
          },
          d,
        );
      })();

      console.log('[Pluto][SpeakerVoice] speaker voice enrolled', {
        meetingId: String(sourceMeetingId),
        speaker: String(speaker),
        personId: canonicalPersonId,
        isFastPath: suppliedCandidateIdentity,
        timings: candidateTimings,
      });

      return {
        success: true,
        enrollmentId: enrollment.id,
        ...(candidateTimings ? { timings: candidateTimings } : {}),
      };
    }

    case 'SPEAKER_VOICE_REJECT': {
      const { meetingId, speaker, sourceRevision, candidateDigest, personId } =
        payload ?? {};
      recordVoiceRejection(
        {
          meetingId,
          speaker,
          sourceRevision,
          candidateDigest,
          personId,
        },
        d,
      );
      return { success: true };
    }

    case 'SPEAKER_VOICE_GET_PROFILES': {
      const requestedPersonId =
        typeof payload?.personId === 'string' && payload.personId
          ? payload.personId
          : undefined;
      let reconciliation: Map<string, ReconciliationOutcome>;
      if (deps?.allowCandidateBuild === false) {
        reconciliation = new Map();
        if (requestedPersonId) {
          const canonicalPersonId = resolvePersonId(requestedPersonId, d);
          const hasProfile = getCanonicalVoiceProfiles({ dbInstance: d }).some(
            (profile) => profile.canonicalPersonId === canonicalPersonId,
          );
          if (
            !hasProfile &&
            !isWorkspaceOwner(canonicalPersonId, d) &&
            !isVoiceProfileOptedOut(canonicalPersonId, d)
          ) {
            const bindingRows = d
              .prepare(
                `SELECT binding.meeting_id, binding.speaker, binding.payload,
                        meeting.capture_journal_generation AS source_revision
                 FROM identity_bindings binding
                 LEFT JOIN meetings meeting ON meeting.id = binding.meeting_id
                 WHERE json_valid(binding.payload)
                   AND json_extract(binding.payload, '$.source') = 'user'
                   AND json_extract(binding.payload, '$.individual') = 1
                   AND json_type(binding.payload, '$.personId') = 'text'
                 ORDER BY datetime(COALESCE(meeting.started_at, meeting.created_at)) DESC`,
              )
              .all() as Array<{
              meeting_id: string;
              speaker: string;
              payload: string;
              source_revision: string | null;
            }>;
            const pendingBinding = bindingRows.find((row) => {
              const binding = JSON.parse(row.payload) as { personId?: unknown };
              return (
                typeof binding.personId === 'string' &&
                resolvePersonId(binding.personId, d) === canonicalPersonId
              );
            });
            if (pendingBinding?.source_revision) {
              const previousAttempt = getVoiceCandidateAttempt(
                {
                  meetingId: pendingBinding.meeting_id,
                  speaker: pendingBinding.speaker,
                  sourceRevision: pendingBinding.source_revision,
                  extractionVersion: ENROLLMENT_EXTRACTION_VERSION,
                },
                d,
              );
              if (previousAttempt?.status === 'abstained') {
                reconciliation.set(canonicalPersonId, 'evidence_unavailable');
              } else if (deps.scheduleCandidateBackfill) {
                deps.scheduleCandidateBackfill(pendingBinding.meeting_id);
                reconciliation.set(canonicalPersonId, 'queued');
              } else if (previousAttempt?.status === 'retryable_failure') {
                reconciliation.set(canonicalPersonId, 'failed');
              }
            }
          }
        }
      } else {
        reconciliation = await reconcileConfirmedSpeakerVoiceProfiles(
          deps,
          d,
          requestedPersonId,
        );
      }
      const profiles = getCanonicalVoiceProfiles({ dbInstance: d });
      // Strip raw embeddings so biometric data never enters renderer IPC
      const sanitized = profiles.map((p) => ({
        canonicalPersonId: p.canonicalPersonId,
        personName: p.personName,
        sampleCount: p.sampleCount,
        cleanDurationSeconds: p.cleanDurationSeconds,
        isActive: p.isActive,
        referenceInterval: p.referenceInterval,
      }));
      return {
        profiles: sanitized,
        optedOutPersonIds: getVoiceProfileOptOuts(d),
        reconciliation: Object.fromEntries(reconciliation),
      };
    }

    case 'SPEAKER_VOICE_SET_STATUS': {
      const { personId, isActive } = payload ?? {};
      setVoiceProfileStatus(personId, Boolean(isActive), d);
      return { success: true };
    }

    case 'SPEAKER_VOICE_DELETE': {
      const { personId } = payload ?? {};
      deleteVoiceProfile(personId, d);
      return { success: true };
    }

    case 'SPEAKER_VOICE_GET_REFERENCE_SAMPLE': {
      const { sourceMeetingId, startTime, endTime } = payload ?? {};
      const getMeeting =
        deps?.getMeeting ??
        ((id: string) =>
          (db.getMeeting(id) as db.PersistedMeeting | undefined) ?? null);

      const meeting = getMeeting(sourceMeetingId);
      if (!meeting?.system_audio_path) {
        return null;
      }

      const fileExists = deps?.fileExists ?? require('node:fs').existsSync;
      if (!fileExists(meeting.system_audio_path)) {
        return null;
      }

      const durationSec = Math.max(
        0.5,
        Math.min(Number(endTime) - Number(startTime), 10),
      );

      if (meeting.system_audio_path.endsWith('.enc')) {
        const buffer = await deps?.readEncryptedSlice?.({
          meetingId: sourceMeetingId,
          inputPath: meeting.system_audio_path,
          startSec: Math.max(0, Number(startTime)),
          durationSec,
        });
        if (!buffer) return null;
        return {
          bytes: new Uint8Array(buffer),
          mimeType: 'audio/wav',
          durationSeconds: durationSec,
        };
      }

      if (!deps?.sliceWav || !deps?.readFile || !deps?.createTemporaryPath) {
        return null;
      }

      const tempPath = deps.createTemporaryPath();

      const ok = await deps.sliceWav({
        inputPath: meeting.system_audio_path,
        outputPath: tempPath,
        startSec: Math.max(0, Number(startTime)),
        durationSec,
      });

      if (!ok) {
        return null;
      }

      try {
        const buffer = await deps.readFile(tempPath);
        return {
          bytes: new Uint8Array(buffer),
          mimeType: 'audio/wav',
          durationSeconds: durationSec,
        };
      } finally {
        if (deps.removeFile) {
          await deps.removeFile(tempPath).catch(() => {});
        }
      }
    }

    default:
      throw new Error(`unsupported_speaker_voice_channel: ${channel}`);
  }
}
