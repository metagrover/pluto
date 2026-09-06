import fs from 'node:fs';
import Database from 'better-sqlite3';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const directory = vi.hoisted(() => {
  const filesystem = require('node:fs') as typeof import('node:fs');
  return filesystem.mkdtempSync('/tmp/pluto-voice-handlers-');
});
vi.mock('electron', () => ({ app: { getPath: () => directory } }));

import * as db from '../../electron/db';
import {
  SPEAKER_VOICE_CHANNELS,
  handleSpeakerVoiceRequest,
} from '../../electron/speakerVoiceHandlers';
import { saveMeetingSpeakerCandidates } from '../../electron/speakerVoiceStore';
import type { SpeakerCandidateEvidence } from '../../src/services/speakerCandidateEvidence';

afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

describe('speaker voice IPC handlers', () => {
  const sourceRevision = '7591ab6e-da76-4c45-a04f-ab96b1a6f3bf';
  const transcriptValidatedAt = '2026-08-15T00:00:00.000Z';
  const validatedTranscriptTrust = {
    transcript_status: 'validated' as const,
    transcript_validated_at: transcriptValidatedAt,
    transcript_integrity_json: JSON.stringify({
      schemaVersion: 2,
      state: 'validated',
      causes: [],
      evidenceProvenance: { kind: 'sealed_capture_activity_v2' },
      validationProof: {
        gateVersion: 'canonical_integrity_v1',
        validatedAt: transcriptValidatedAt,
      },
    }),
  };
  let fixture = 0;
  let meetingId: string;
  let personId: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    fixture++;
    meetingId = `voice-handler-meeting-${fixture}`;
    personId = `voice-handler-person-${fixture}`;

    db.db.prepare('DELETE FROM speaker_voice_rejections').run();
    db.db.prepare('DELETE FROM speaker_voice_profile_settings').run();
    db.db.prepare('DELETE FROM speaker_voice_enrollments').run();
    db.db.prepare('DELETE FROM meeting_speaker_candidates').run();
    db.db.prepare('DELETE FROM identity_bindings').run();
    db.db.prepare('DELETE FROM person_aliases').run();
    db.db
      .prepare(
        'UPDATE identity_workspace SET self_person_id = NULL WHERE singleton = 1',
      )
      .run();

    db.saveMeeting({
      id: meetingId,
      title: 'Voice Test Meeting',
      capture_journal_generation: sourceRevision,
      ...validatedTranscriptTrust,
      transcript_json: JSON.stringify([
        { speaker: 'Remote Speaker 1', text: 'Hello, this is Robin speaking.' },
      ]),
    });

    db.upsertEntity({
      id: personId,
      type: 'person',
      name: 'Robin',
      dedupe_by_name: false,
    });
    db.identityStore.setBinding(meetingId, {
      speaker: 'Remote Speaker 1',
      personId,
      individual: true,
      source: 'user',
      sourceRevision,
      evidence: [],
    });
  });

  const dummyCandidate: SpeakerCandidateEvidence = {
    speaker: 'Remote Speaker 1',
    nativeCluster: 'S1',
    candidateDigest: 'cand-digest-abc',
    embedding: new Array(256).fill(0.1),
    cleanDurationSeconds: 4.5,
    cleanSegmentCount: 2,
    cleanChunkCount: 3,
    minimumChunkSimilarity: 0.85,
    meanChunkSimilarity: 0.9,
    referenceInterval: {
      startTime: 1.0,
      endTime: 3.5,
      excerpt: 'Hello, this is Robin speaking.',
    },
    provenance: {
      modelIdentifier: 'speaker-diarization-offline-v1',
      modelRevision: '27741ba0e8354c03b190f898327dcf61a3848148',
      artifactDigest:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      runtimeVersion: 'fluidaudio-v1',
      profileAlgorithmVersion: 'v1',
    },
    isEligibleForEnrollment: true,
  };

  it('does not enroll cached evidence after its source becomes stale', async () => {
    saveMeetingSpeakerCandidates(meetingId, sourceRevision, [dummyCandidate]);
    db.db
      .prepare(
        `UPDATE meetings
         SET capture_journal_generation = ?, transcript_status = ?
         WHERE id = ?`,
      )
      .run(`${sourceRevision}-new`, 'pending', meetingId);

    const result = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_PROFILES',
      {},
      { buildEnrollmentCandidate: async () => null },
    )) as { profiles: unknown[] };

    expect(result.profiles).toEqual([]);
    expect(
      db.db
        .prepare(
          'SELECT count(*) AS count FROM speaker_voice_enrollments WHERE person_id = ?',
        )
        .get(personId),
    ).toEqual({ count: 0 });
  });

  it('lets deletion win over an in-flight automatic enrollment', async () => {
    let releaseBuilder!: () => void;
    let markBuilderStarted!: () => void;
    const builderStarted = new Promise<void>((resolve) => {
      markBuilderStarted = resolve;
    });
    const builderGate = new Promise<void>((resolve) => {
      releaseBuilder = resolve;
    });
    const pendingReconciliation = handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_PROFILES',
      {},
      {
        buildEnrollmentCandidate: async () => {
          markBuilderStarted();
          await builderGate;
          return { candidate: dummyCandidate, sourceRevision };
        },
      },
    );
    await builderStarted;

    saveMeetingSpeakerCandidates(meetingId, sourceRevision, [dummyCandidate]);
    await handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', {
      personId,
      sourceMeetingId: meetingId,
      sourceRevision,
      speaker: dummyCandidate.speaker,
      candidateDigest: dummyCandidate.candidateDigest,
      expectedRevision: db.identityStore.getRevision(),
    });
    await handleSpeakerVoiceRequest('SPEAKER_VOICE_DELETE', { personId });
    releaseBuilder();
    await pendingReconciliation;

    expect(
      db.db
        .prepare(
          'SELECT count(*) AS count FROM speaker_voice_enrollments WHERE person_id = ?',
        )
        .get(personId),
    ).toEqual({ count: 0 });
    expect(
      db.db
        .prepare(
          'SELECT is_active FROM speaker_voice_profile_settings WHERE person_id = ?',
        )
        .get(personId),
    ).toEqual({ is_active: 0 });
  });

  it('does not treat ordinary confirmation as explicit re-enrollment after deletion', async () => {
    saveMeetingSpeakerCandidates(meetingId, sourceRevision, [dummyCandidate]);
    const enrollment = {
      personId,
      sourceMeetingId: meetingId,
      sourceRevision,
      speaker: dummyCandidate.speaker,
      candidateDigest: dummyCandidate.candidateDigest,
      expectedRevision: db.identityStore.getRevision(),
    };
    await handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', enrollment);
    await handleSpeakerVoiceRequest('SPEAKER_VOICE_DELETE', { personId });

    await expect(
      handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', enrollment),
    ).rejects.toThrow('speaker_voice_profile_opted_out');
    expect(
      db.db
        .prepare(
          'SELECT count(*) AS count FROM speaker_voice_enrollments WHERE person_id = ?',
        )
        .get(personId),
    ).toEqual({ count: 0 });
  });

  it.each([
    {
      label: 'withdrawn transcript trust',
      update: "transcript_status = 'pending'",
    },
    {
      label: 'changed capture generation',
      update: "capture_journal_generation = 'different-generation'",
    },
  ])('rejects direct enrollment for $label', async ({ update }) => {
    saveMeetingSpeakerCandidates(meetingId, sourceRevision, [dummyCandidate]);
    db.db.prepare(`UPDATE meetings SET ${update} WHERE id = ?`).run(meetingId);

    await expect(
      handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', {
        personId,
        sourceMeetingId: meetingId,
        sourceRevision,
        speaker: dummyCandidate.speaker,
        candidateDigest: dummyCandidate.candidateDigest,
        expectedRevision: db.identityStore.getRevision(),
      }),
    ).rejects.toThrow('speaker_enrollment_evidence_unavailable');
  });

  it('rejects direct enrollment for incompatible candidate provenance', async () => {
    const incompatible = {
      ...dummyCandidate,
      provenance: {
        ...dummyCandidate.provenance,
        runtimeVersion: 'other-runtime',
      },
    };
    saveMeetingSpeakerCandidates(meetingId, sourceRevision, [incompatible]);

    await expect(
      handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', {
        personId,
        sourceMeetingId: meetingId,
        sourceRevision,
        speaker: incompatible.speaker,
        candidateDigest: incompatible.candidateDigest,
        expectedRevision: db.identityStore.getRevision(),
      }),
    ).rejects.toThrow('speaker_enrollment_evidence_unavailable');
  });

  it('keeps enrollment evidence owned by the binding person across merge and restore', async () => {
    const survivorId = `${personId}-survivor`;
    db.upsertEntity({
      id: survivorId,
      type: 'person',
      name: 'Taylor',
      dedupe_by_name: false,
    });
    db.db
      .prepare(
        'INSERT INTO person_aliases (person_id, canonical_id, active) VALUES (?, ?, 1)',
      )
      .run(personId, survivorId);

    const merged = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_PROFILES',
      {},
      {
        buildEnrollmentCandidate: async () => ({
          candidate: dummyCandidate,
          sourceRevision,
        }),
      },
    )) as { profiles: Array<{ canonicalPersonId: string }> };

    expect(merged.profiles[0]?.canonicalPersonId).toBe(survivorId);
    expect(
      db.db.prepare('SELECT person_id FROM speaker_voice_enrollments').get(),
    ).toEqual({ person_id: personId });

    db.db
      .prepare(
        'UPDATE person_aliases SET active = 0 WHERE person_id = ? AND canonical_id = ?',
      )
      .run(personId, survivorId);
    const restored = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_PROFILES',
      {},
    )) as { profiles: Array<{ canonicalPersonId: string }> };
    expect(restored.profiles[0]?.canonicalPersonId).toBe(personId);
  });

  it('exposes exactly the seven supported voice channels', () => {
    expect(SPEAKER_VOICE_CHANNELS).toEqual([
      'SPEAKER_VOICE_GET_SUGGESTIONS',
      'SPEAKER_VOICE_ENROLL',
      'SPEAKER_VOICE_REJECT',
      'SPEAKER_VOICE_GET_PROFILES',
      'SPEAKER_VOICE_SET_STATUS',
      'SPEAKER_VOICE_DELETE',
      'SPEAKER_VOICE_GET_REFERENCE_SAMPLE',
    ]);
  });

  it('returns empty enrollment metadata when the meeting id is absent', async () => {
    await expect(
      handleSpeakerVoiceRequest('SPEAKER_VOICE_GET_SUGGESTIONS', {}),
    ).resolves.toEqual({
      suggestions: {},
      candidates: {},
      enrollmentAvailability: {},
    });
  });

  it('handles enrollment with revision and candidate validation', async () => {
    saveMeetingSpeakerCandidates(meetingId, sourceRevision, [dummyCandidate]);
    const rev = db.identityStore.getRevision();

    // Invalid revision throws
    await expect(
      handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', {
        personId,
        sourceMeetingId: meetingId,
        sourceRevision,
        speaker: 'Remote Speaker 1',
        candidateDigest: 'cand-digest-abc',
        expectedRevision: rev + 999,
      }),
    ).rejects.toThrow('identity_revision_stale');

    // Stale candidate digest throws
    await expect(
      handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', {
        personId,
        sourceMeetingId: meetingId,
        sourceRevision,
        speaker: 'Remote Speaker 1',
        candidateDigest: 'wrong-digest',
        expectedRevision: rev,
      }),
    ).rejects.toThrow('speaker_candidate_stale');

    // Valid enrollment succeeds
    const result = (await handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', {
      personId,
      sourceMeetingId: meetingId,
      sourceRevision,
      speaker: 'Remote Speaker 1',
      candidateDigest: 'cand-digest-abc',
      expectedRevision: rev,
    })) as { success: boolean; enrollmentId: string };

    expect(result.success).toBe(true);
    expect(result.enrollmentId).toBeDefined();
  });

  it('uses an explicitly enrolled profile for future suggestions without a hidden flag', async () => {
    saveMeetingSpeakerCandidates(meetingId, sourceRevision, [dummyCandidate]);
    const rev = db.identityStore.getRevision();
    await handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', {
      personId,
      sourceMeetingId: meetingId,
      sourceRevision,
      speaker: 'Remote Speaker 1',
      candidateDigest: 'cand-digest-abc',
      expectedRevision: rev,
    });

    const optedInResult = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_SUGGESTIONS',
      { meetingId },
      { isFeatureFlagEnabled: () => false },
    )) as {
      suggestions: Record<string, any>;
      candidates: Record<string, { sourceRevision: string }>;
    };
    expect(optedInResult.candidates['Remote Speaker 1']?.sourceRevision).toBe(
      sourceRevision,
    );
    expect(optedInResult.suggestions['Remote Speaker 1']).toBeDefined();
    const suggestion = optedInResult.suggestions['Remote Speaker 1'];
    expect(suggestion.suggestedPersonId).toBe(personId);
    expect(suggestion.suggestedPersonName).toBe('Robin');
    expect(suggestion.confidenceTier).toBe('strong');
    expect(suggestion.sourceRevision).toBe(sourceRevision);
    expect(suggestion.embedding).toBeUndefined(); // NEVER leaked to renderer!
  });

  it('loads profile reference audio from the same system channel as modal samples', async () => {
    const sliceWav = vi.fn(async () => true);

    const result = await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_REFERENCE_SAMPLE',
      { sourceMeetingId: meetingId, startTime: 2, endTime: 5 },
      {
        getMeeting: () => ({
          id: meetingId,
          audio_path: '/approved/mic.wav',
          system_audio_path: '/approved/system.wav',
        }),
        fileExists: () => true,
        createTemporaryPath: () => '/approved/sample.wav',
        sliceWav,
        readFile: async () => Buffer.from([1, 2, 3]),
        removeFile: async () => undefined,
      },
    );

    expect(result).toMatchObject({ mimeType: 'audio/wav', durationSeconds: 3 });
    expect(sliceWav).toHaveBeenCalledWith(
      expect.objectContaining({ inputPath: '/approved/system.wav' }),
    );
  });

  it('advertises reviewed-sample enrollment without a stored candidate', async () => {
    const result = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_SUGGESTIONS',
      { meetingId },
      {
        isFeatureFlagEnabled: () => false,
        fileExists: () => true,
        getMeeting: () => ({
          id: meetingId,
          ...validatedTranscriptTrust,
          capture_journal_generation: sourceRevision,
          system_audio_path: '/approved/system.wav',
          transcript_json: JSON.stringify([
            {
              speaker: 'Remote Speaker 1',
              text: 'First reviewed sample',
              start: 1,
              end: 6,
            },
            {
              speaker: 'Remote Speaker 1',
              text: 'Second reviewed sample',
              start: 10,
              end: 14,
            },
          ]),
        }),
      },
    )) as { enrollmentAvailability: Record<string, boolean> };

    expect(result.enrollmentAvailability).toEqual({
      'Remote Speaker 1': true,
    });
  });

  it.each([
    {
      label: 'unvalidated transcript',
      transcriptStatus: 'pending',
      captureGeneration: sourceRevision,
      fileExists: true,
    },
    {
      label: 'missing capture generation',
      transcriptStatus: 'validated',
      captureGeneration: null,
      fileExists: true,
    },
    {
      label: 'missing system audio',
      transcriptStatus: 'validated',
      captureGeneration: sourceRevision,
      fileExists: false,
    },
  ])(
    'does not advertise reviewed-sample enrollment for $label',
    async ({ transcriptStatus, captureGeneration, fileExists }) => {
      const result = (await handleSpeakerVoiceRequest(
        'SPEAKER_VOICE_GET_SUGGESTIONS',
        { meetingId },
        {
          isFeatureFlagEnabled: () => false,
          fileExists: () => fileExists,
          getMeeting: () => ({
            id: meetingId,
            ...validatedTranscriptTrust,
            transcript_status: transcriptStatus,
            capture_journal_generation: captureGeneration,
            system_audio_path: '/approved/system.wav',
            transcript_json: JSON.stringify([
              {
                speaker: 'Remote Speaker 1',
                text: 'First reviewed sample',
                start: 1,
                end: 6,
              },
              {
                speaker: 'Remote Speaker 1',
                text: 'Second reviewed sample',
                start: 10,
                end: 14,
              },
            ]),
          }),
        },
      )) as { enrollmentAvailability: Record<string, boolean> };

      expect(result.enrollmentAvailability).toEqual({
        'Remote Speaker 1': false,
      });
    },
  );

  it('enrolls with the exact candidate revision returned by discovery', async () => {
    saveMeetingSpeakerCandidates(meetingId, sourceRevision, [dummyCandidate]);

    const discovery = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_SUGGESTIONS',
      { meetingId },
      { isFeatureFlagEnabled: () => false },
    )) as {
      candidates: Record<
        string,
        { sourceRevision: string; candidateDigest: string }
      >;
    };
    const candidate = discovery.candidates['Remote Speaker 1'];

    await expect(
      handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', {
        personId,
        sourceMeetingId: meetingId,
        sourceRevision: candidate.sourceRevision,
        speaker: 'Remote Speaker 1',
        candidateDigest: candidate.candidateDigest,
        expectedRevision: db.identityStore.getRevision(),
      }),
    ).resolves.toMatchObject({ success: true });

    const profiles = (
      (await handleSpeakerVoiceRequest('SPEAKER_VOICE_GET_PROFILES', {})) as {
        profiles: Array<{ canonicalPersonId: string; sampleCount: number }>;
      }
    ).profiles;
    expect(profiles).toEqual([
      expect.objectContaining({ canonicalPersonId: personId, sampleCount: 1 }),
    ]);
  });

  it('builds an enrollment candidate from reviewed samples when finalization has none', async () => {
    const buildEnrollmentCandidate = vi.fn(async () => ({
      candidate: dummyCandidate,
      sourceRevision,
    }));

    await expect(
      handleSpeakerVoiceRequest(
        'SPEAKER_VOICE_ENROLL',
        {
          personId,
          sourceMeetingId: meetingId,
          speaker: 'Remote Speaker 1',
          expectedRevision: db.identityStore.getRevision(),
        },
        { buildEnrollmentCandidate },
      ),
    ).resolves.toMatchObject({ success: true });

    expect(buildEnrollmentCandidate).toHaveBeenCalledWith({
      meetingId,
      speaker: 'Remote Speaker 1',
    });
    expect(
      db.db
        .prepare(
          'SELECT candidate_digest FROM meeting_speaker_candidates WHERE meeting_id = ?',
        )
        .get(meetingId),
    ).toEqual({ candidate_digest: dummyCandidate.candidateDigest });
    const profiles = (
      (await handleSpeakerVoiceRequest('SPEAKER_VOICE_GET_PROFILES', {})) as {
        profiles: Array<{ canonicalPersonId: string; sampleCount: number }>;
      }
    ).profiles;
    expect(profiles).toEqual([
      expect.objectContaining({ canonicalPersonId: personId, sampleCount: 1 }),
    ]);
  });

  it('reconciles a confirmed speaker into a voice profile when profiles are read', async () => {
    const buildEnrollmentCandidate = vi.fn(async () => ({
      candidate: dummyCandidate,
      sourceRevision,
    }));

    const first = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_PROFILES',
      {},
      { buildEnrollmentCandidate },
    )) as {
      profiles: Array<{ canonicalPersonId: string; sampleCount: number }>;
    };

    expect(first.profiles).toEqual([
      expect.objectContaining({ canonicalPersonId: personId, sampleCount: 1 }),
    ]);
    expect(buildEnrollmentCandidate).toHaveBeenCalledTimes(1);

    await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_PROFILES',
      {},
      { buildEnrollmentCandidate },
    );
    expect(buildEnrollmentCandidate).toHaveBeenCalledTimes(1);
  });

  it('reconciles confirmed speakers before matching a future meeting', async () => {
    const historicalMeetingId = meetingId;
    const futureMeetingId = `${meetingId}-future`;
    db.saveMeeting({
      id: futureMeetingId,
      title: 'Future Voice Test Meeting',
      capture_journal_generation: sourceRevision,
      transcript_status: 'validated',
      transcript_json: JSON.stringify([
        { speaker: 'Remote Speaker 2', text: 'A future reviewed sample.' },
      ]),
    });
    saveMeetingSpeakerCandidates(futureMeetingId, sourceRevision, [
      { ...dummyCandidate, speaker: 'Remote Speaker 2' },
    ]);
    const buildEnrollmentCandidate = vi.fn(async (input) =>
      input.meetingId === historicalMeetingId
        ? { candidate: dummyCandidate, sourceRevision }
        : null,
    );

    const result = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_SUGGESTIONS',
      { meetingId: futureMeetingId },
      { buildEnrollmentCandidate, isFeatureFlagEnabled: () => false },
    )) as { suggestions: Record<string, { suggestedPersonId: string }> };

    expect(result.suggestions['Remote Speaker 2']?.suggestedPersonId).toBe(
      personId,
    );
  });

  it('does not recreate a voice profile after explicit deletion', async () => {
    const buildEnrollmentCandidate = vi.fn(async () => ({
      candidate: dummyCandidate,
      sourceRevision,
    }));
    await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_PROFILES',
      {},
      { buildEnrollmentCandidate },
    );
    await handleSpeakerVoiceRequest('SPEAKER_VOICE_DELETE', { personId });

    const result = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_PROFILES',
      {},
      { buildEnrollmentCandidate },
    )) as { profiles: unknown[] };

    expect(result.profiles).toEqual([]);
    expect(buildEnrollmentCandidate).toHaveBeenCalledTimes(1);
  });

  it('never reconciles the workspace owner as a remote voice profile', async () => {
    db.db
      .prepare(
        'UPDATE identity_workspace SET self_person_id = ? WHERE singleton = 1',
      )
      .run(personId);
    const buildEnrollmentCandidate = vi.fn(async () => ({
      candidate: dummyCandidate,
      sourceRevision,
    }));

    const result = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_PROFILES',
      {},
      { buildEnrollmentCandidate },
    )) as { profiles: unknown[] };

    expect(result.profiles).toEqual([]);
    expect(buildEnrollmentCandidate).not.toHaveBeenCalled();
    db.db
      .prepare(
        'UPDATE identity_workspace SET self_person_id = NULL WHERE singleton = 1',
      )
      .run();
  });

  it('rejects partially supplied candidate identity', async () => {
    await expect(
      handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', {
        personId,
        sourceMeetingId: meetingId,
        sourceRevision,
        speaker: 'Remote Speaker 1',
        expectedRevision: db.identityStore.getRevision(),
      }),
    ).rejects.toThrow('speaker_candidate_invalid');
  });

  it.each([
    { label: 'missing candidate', built: null },
    {
      label: 'ineligible candidate',
      built: {
        candidate: { ...dummyCandidate, isEligibleForEnrollment: false },
        sourceRevision,
      },
    },
    {
      label: 'candidate for a different speaker',
      built: {
        candidate: { ...dummyCandidate, speaker: 'Remote Speaker 2' },
        sourceRevision,
      },
    },
  ])('rejects $label from on-demand analysis', async ({ built }) => {
    await expect(
      handleSpeakerVoiceRequest(
        'SPEAKER_VOICE_ENROLL',
        {
          personId,
          sourceMeetingId: meetingId,
          speaker: 'Remote Speaker 1',
          expectedRevision: db.identityStore.getRevision(),
        },
        { buildEnrollmentCandidate: async () => built },
      ),
    ).rejects.toThrow('speaker_enrollment_evidence_unavailable');
  });

  it('requires the confirmed meeting binding to match the enrolled person', async () => {
    const otherPersonId = `${personId}-other`;
    db.upsertEntity({
      id: otherPersonId,
      type: 'person',
      name: 'Other Person',
      dedupe_by_name: false,
    });
    db.identityStore.setBinding(meetingId, {
      speaker: 'Remote Speaker 1',
      personId: otherPersonId,
      individual: true,
      source: 'user',
      sourceRevision,
      evidence: [],
    });
    saveMeetingSpeakerCandidates(meetingId, sourceRevision, [dummyCandidate]);

    await expect(
      handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', {
        personId,
        sourceMeetingId: meetingId,
        sourceRevision,
        speaker: 'Remote Speaker 1',
        candidateDigest: dummyCandidate.candidateDigest,
        expectedRevision: db.identityStore.getRevision(),
      }),
    ).rejects.toThrow('speaker_enrollment_unconfirmed');
  });

  it('returns profiles stripped of raw biometric embeddings', async () => {
    saveMeetingSpeakerCandidates(meetingId, sourceRevision, [dummyCandidate]);
    const rev = db.identityStore.getRevision();
    await handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', {
      personId,
      sourceMeetingId: meetingId,
      sourceRevision,
      speaker: 'Remote Speaker 1',
      candidateDigest: 'cand-digest-abc',
      expectedRevision: rev,
    });

    const profilesResult = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_PROFILES',
      {},
    )) as { profiles: Array<Record<string, unknown>> };

    expect(profilesResult.profiles).toHaveLength(1);
    const profile = profilesResult.profiles[0];
    expect(profile.canonicalPersonId).toBe(personId);
    expect(profile.personName).toBe('Robin');
    expect(profile.sampleCount).toBe(1);
    expect(profile.embedding).toBeUndefined(); // NEVER leaked to renderer!
  });

  it('rejects candidate and suppresses suggestion', async () => {
    saveMeetingSpeakerCandidates(meetingId, sourceRevision, [dummyCandidate]);
    const rev = db.identityStore.getRevision();
    await handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', {
      personId,
      sourceMeetingId: meetingId,
      sourceRevision,
      speaker: 'Remote Speaker 1',
      candidateDigest: 'cand-digest-abc',
      expectedRevision: rev,
    });

    // Record rejection
    await handleSpeakerVoiceRequest('SPEAKER_VOICE_REJECT', {
      meetingId,
      speaker: 'Remote Speaker 1',
      sourceRevision,
      candidateDigest: 'cand-digest-abc',
      personId,
    });

    // Suggestion is now suppressed
    const result = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_SUGGESTIONS',
      { meetingId },
      { isFeatureFlagEnabled: () => true },
    )) as { suggestions: Record<string, unknown> };

    expect(result.suggestions['Remote Speaker 1']).toBeUndefined();
  });

  it('updates profile active status and deletes voice profile', async () => {
    saveMeetingSpeakerCandidates(meetingId, sourceRevision, [dummyCandidate]);
    const rev = db.identityStore.getRevision();
    await handleSpeakerVoiceRequest('SPEAKER_VOICE_ENROLL', {
      personId,
      sourceMeetingId: meetingId,
      sourceRevision,
      speaker: 'Remote Speaker 1',
      candidateDigest: 'cand-digest-abc',
      expectedRevision: rev,
    });

    // Toggle status to inactive
    await handleSpeakerVoiceRequest('SPEAKER_VOICE_SET_STATUS', {
      personId,
      isActive: false,
    });

    let profiles = (
      (await handleSpeakerVoiceRequest('SPEAKER_VOICE_GET_PROFILES', {})) as {
        profiles: any[];
      }
    ).profiles;
    expect(profiles[0].isActive).toBe(false);

    const inactiveResult = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_SUGGESTIONS',
      { meetingId },
      { isFeatureFlagEnabled: () => false },
    )) as { suggestions: Record<string, unknown> };
    expect(inactiveResult.suggestions).toEqual({});

    // Delete profile
    await handleSpeakerVoiceRequest('SPEAKER_VOICE_DELETE', { personId });
    profiles = (
      (await handleSpeakerVoiceRequest('SPEAKER_VOICE_GET_PROFILES', {})) as {
        profiles: any[];
      }
    ).profiles;
    expect(profiles).toHaveLength(0);
  });
});
