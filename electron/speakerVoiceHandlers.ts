import type Database from 'better-sqlite3';
import {
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
  getVoiceProfileOptOuts,
  getVoiceRejections,
  isVoiceProfileOptedOut,
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
  buildEnrollmentCandidate?: (input: {
    meetingId: string;
    speaker: string;
  }) => Promise<{
    candidate: SpeakerCandidateEvidence;
    sourceRevision: string;
  } | null>;
}

type ConfirmedSpeakerBinding = {
  meetingId: string;
  speaker: string;
};

type ReconciliationOutcome =
  | 'enrolled'
  | 'already_enrolled'
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
): { enrollmentPersonId: string } | null => {
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
  return { enrollmentPersonId: payload.personId };
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

async function reconcileConfirmedSpeakerVoiceProfiles(
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
        `SELECT binding.meeting_id, binding.speaker, binding.payload
         FROM identity_bindings binding
         LEFT JOIN meetings meeting ON meeting.id = binding.meeting_id
         WHERE json_valid(binding.payload)
           AND json_extract(binding.payload, '$.source') = 'user'
           AND json_extract(binding.payload, '$.individual') = 1
           AND json_type(binding.payload, '$.personId') = 'text'
         ORDER BY datetime(COALESCE(meeting.started_at, meeting.created_at)) DESC,
                  binding.meeting_id DESC`,
      )
      .all() as Array<{ meeting_id: string; speaker: string; payload: string }>;

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
      if (profiledPeople.has(personId)) {
        outcomes.set(personId, 'already_enrolled');
        continue;
      }
      if (disabledPeople.has(personId)) {
        outcomes.set(personId, 'opted_out');
        continue;
      }
      const bindings = bindingsByPerson.get(personId) ?? [];
      bindings.push({
        meetingId: row.meeting_id,
        speaker: row.speaker,
      });
      bindingsByPerson.set(personId, bindings);
    }

    for (const [personId, bindings] of bindingsByPerson) {
      let sawFailure = false;
      for (const binding of bindings) {
        try {
          const storedCandidate = getMeetingSpeakerCandidates(
            binding.meetingId,
            d,
          ).find((candidate) => candidate.speaker === binding.speaker);
          const usesStoredCandidate = Boolean(
            storedCandidate &&
              isCurrentEligibleCandidate(
                binding.meetingId,
                storedCandidate.sourceRevision,
                storedCandidate,
                deps,
                d,
              ),
          );
          const built =
            storedCandidate && usesStoredCandidate
              ? {
                  candidate: storedCandidate,
                  sourceRevision: storedCandidate.sourceRevision,
                }
              : await buildEnrollmentCandidate({
                  meetingId: binding.meetingId,
                  speaker: binding.speaker,
                });
          if (
            !built ||
            !isCurrentEligibleCandidate(
              binding.meetingId,
              built.sourceRevision,
              built.candidate,
              deps,
              d,
            ) ||
            built.candidate.speaker !== binding.speaker ||
            !built.sourceRevision
          ) {
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
            if (!usesStoredCandidate) {
              saveMeetingSpeakerCandidate(
                binding.meetingId,
                built.sourceRevision,
                built.candidate,
                d,
              );
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
          outcomes.set(personId, 'enrolled');
          break;
        } catch {
          sawFailure = true;
        }
      }
      if (!outcomes.has(personId)) {
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

      await reconcileConfirmedSpeakerVoiceProfiles(deps, d);

      const candidates = getMeetingSpeakerCandidates(meetingId, d);
      const clientCandidates: Record<string, unknown> = {};
      for (const candidate of candidates) {
        clientCandidates[candidate.speaker] = {
          candidateDigest: candidate.candidateDigest,
          sourceRevision: candidate.sourceRevision,
          isEligibleForEnrollment: candidate.isEligibleForEnrollment,
          cleanDurationSeconds: candidate.cleanDurationSeconds,
        };
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
      } = payload ?? {};

      if (
        typeof expectedRevision !== 'number' ||
        db.identityStore.getRevision() !== expectedRevision
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
      if (!bindingMatches()) throw new Error('speaker_enrollment_unconfirmed');
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
        const built = await deps?.buildEnrollmentCandidate?.({
          meetingId: String(sourceMeetingId ?? ''),
          speaker: String(speaker ?? ''),
        });
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
          throw new Error('speaker_enrollment_evidence_unavailable');
        }
        if (
          db.identityStore.getRevision() !== expectedRevision ||
          !bindingMatches()
        ) {
          throw new Error('identity_revision_stale');
        }
        builtCandidate = built.candidate;
        enrollmentSourceRevision = built.sourceRevision;
        enrollmentCandidateDigest = built.candidate.candidateDigest;
      }

      if (!enrollmentSourceRevision || !enrollmentCandidateDigest) {
        throw new Error('speaker_enrollment_evidence_unavailable');
      }

      const enrollment = d.transaction(() => {
        const currentBinding = bindingMatches();
        if (
          db.identityStore.getRevision() !== expectedRevision ||
          !currentBinding
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

      return { success: true, enrollmentId: enrollment.id };
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
      const reconciliation = await reconcileConfirmedSpeakerVoiceProfiles(
        deps,
        d,
        requestedPersonId,
      );
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

      if (!deps?.sliceWav || !deps?.readFile || !deps?.createTemporaryPath) {
        return null;
      }

      const tempPath = deps.createTemporaryPath();
      const durationSec = Math.max(
        0.5,
        Math.min(Number(endTime) - Number(startTime), 10),
      );

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
