import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const directory = vi.hoisted(() => {
  const filesystem = require('node:fs') as typeof import('node:fs');
  return filesystem.mkdtempSync('/tmp/pluto-voice-identity-');
});
vi.mock('electron', () => ({
  app: { getPath: () => directory, getAppPath: () => process.cwd() },
}));
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
import {
  VOICE_MATCH_STRONG_ASSIGNMENT,
  planVoiceMatchSpeakerAssignments,
  reconcileVoiceMatchSpeakerIdentity,
} from '../../electron/speakerVoiceIdentity';
import type {
  CanonicalVoiceProfile,
  SpeakerVoiceRejection,
} from '../../electron/speakerVoiceStore';
import type { SpeakerCandidateEvidence } from '../../src/services/speakerCandidateEvidence';
import { DEFAULT_CALIBRATION_POLICY_V1 } from '../../src/services/speakerVoiceMatcher';

describe('speakerVoiceIdentity - automatic assignment for strong voice matches', () => {
  const dummyProvenance = {
    ...DEFAULT_CALIBRATION_POLICY_V1.compatibilityKey,
    enrollmentExtractionVersion: 'single-pass-v2',
  };

  const createVector = (dominantIndex: number): number[] => {
    const v = new Array(256).fill(0);
    v[dominantIndex] = 1.0;
    return v;
  };

  const candidateSpeaker1: SpeakerCandidateEvidence & {
    sourceRevision: string;
  } = {
    speaker: 'Remote Speaker 1',
    nativeCluster: 'S1',
    candidateDigest: 'digest-speaker-1',
    sourceRevision: 'rev-1',
    embedding: createVector(0),
    representativeEmbeddings: [createVector(0), createVector(0)],
    cleanDurationSeconds: 5.0,
    cleanSegmentCount: 3,
    cleanChunkCount: 3,
    minimumChunkSimilarity: 0.85,
    meanChunkSimilarity: 0.9,
    referenceInterval: { startTime: 1.0, endTime: 4.0, excerpt: 'Hello Alex' },
    provenance: dummyProvenance,
    isEligibleForEnrollment: true,
  };

  const candidateSpeaker2: SpeakerCandidateEvidence & {
    sourceRevision: string;
  } = {
    speaker: 'Remote Speaker 2',
    nativeCluster: 'S2',
    candidateDigest: 'digest-speaker-2',
    sourceRevision: 'rev-1',
    embedding: createVector(1),
    representativeEmbeddings: [createVector(1), createVector(1)],
    cleanDurationSeconds: 6.0,
    cleanSegmentCount: 4,
    cleanChunkCount: 4,
    minimumChunkSimilarity: 0.88,
    meanChunkSimilarity: 0.92,
    referenceInterval: {
      startTime: 5.0,
      endTime: 9.0,
      excerpt: 'Hello Jordan',
    },
    provenance: dummyProvenance,
    isEligibleForEnrollment: true,
  };

  const profileAlex: CanonicalVoiceProfile = {
    canonicalPersonId: 'person-alex',
    personName: 'Alex',
    sampleCount: 3,
    cleanDurationSeconds: 15.0,
    isActive: true,
    embedding: createVector(0), // exact match with candidateSpeaker1
    representativeEmbeddings: [createVector(0), createVector(0)],
    referenceInterval: {
      startTime: 1.0,
      endTime: 4.0,
      excerpt: 'Alex reference',
      sourceMeetingId: 'meeting-prior-alex',
    },
    provenance: dummyProvenance,
  };

  const profileJordan: CanonicalVoiceProfile = {
    canonicalPersonId: 'person-jordan',
    personName: 'Jordan',
    sampleCount: 2,
    cleanDurationSeconds: 10.0,
    isActive: true,
    embedding: createVector(1), // exact match with candidateSpeaker2
    representativeEmbeddings: [createVector(1), createVector(1)],
    referenceInterval: {
      startTime: 2.0,
      endTime: 6.0,
      excerpt: 'Jordan reference',
      sourceMeetingId: 'meeting-prior-jordan',
    },
    provenance: dummyProvenance,
  };

  it('automatically plans assignment for a strong voice match', () => {
    const plan = planVoiceMatchSpeakerAssignments({
      meetingId: 'meeting-1',
      candidates: [candidateSpeaker1],
      profiles: [profileAlex, profileJordan],
      rejections: [],
      existingBindings: [],
      isAutomaticBindingSuppressed: () => false,
    });

    expect(plan.status).toBe('bind');
    if (plan.status === 'bind') {
      expect(plan.assignments).toHaveLength(1);
      expect(plan.assignments[0]).toMatchObject({
        speaker: 'Remote Speaker 1',
        personId: 'person-alex',
        candidateDigest: 'digest-speaker-1',
        sourceRevision: 'rev-1',
      });
      expect(plan.assignments[0].similarityScore).toBeCloseTo(1.0);
    }
  });

  it('automatically plans distinct assignments for multiple speakers without collisions', () => {
    const plan = planVoiceMatchSpeakerAssignments({
      meetingId: 'meeting-1',
      candidates: [candidateSpeaker1, candidateSpeaker2],
      profiles: [profileAlex, profileJordan],
      rejections: [],
      existingBindings: [],
      isAutomaticBindingSuppressed: () => false,
    });

    expect(plan.status).toBe('bind');
    if (plan.status === 'bind') {
      expect(plan.assignments).toHaveLength(2);
      expect(plan.assignments.map((a) => a.personId)).toEqual([
        'person-alex',
        'person-jordan',
      ]);
    }
  });

  it('abstains when two speakers in the same meeting match the same person (collision guardrail)', () => {
    // Both Speaker 1 and Speaker 2 have audio matching Alex
    const collidingSpeaker2 = {
      ...candidateSpeaker2,
      embedding: createVector(0),
      representativeEmbeddings: [createVector(0), createVector(0)],
    };

    const plan = planVoiceMatchSpeakerAssignments({
      meetingId: 'meeting-1',
      candidates: [candidateSpeaker1, collidingSpeaker2],
      profiles: [profileAlex],
      rejections: [],
      existingBindings: [],
      isAutomaticBindingSuppressed: () => false,
    });

    expect(plan.status).toBe('abstain');
    expect(plan.abstentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          speaker: 'Remote Speaker 1',
          reason: 'duplicate_person_match_in_meeting',
        }),
        expect.objectContaining({
          speaker: 'Remote Speaker 2',
          reason: 'duplicate_person_match_in_meeting',
        }),
      ]),
    );
  });

  it('abstains when the person is already bound to another speaker in the meeting', () => {
    const plan = planVoiceMatchSpeakerAssignments({
      meetingId: 'meeting-1',
      candidates: [candidateSpeaker1],
      profiles: [profileAlex],
      rejections: [],
      existingBindings: [
        {
          speaker: 'Them',
          personId: 'person-alex',
          individual: true,
          source: 'user',
          sourceRevision: 'rev-0',
          evidence: [],
        },
      ],
      isAutomaticBindingSuppressed: () => false,
    });

    expect(plan.status).toBe('abstain');
    expect(plan.abstentions).toContainEqual({
      speaker: 'Remote Speaker 1',
      reason: 'person_already_bound',
    });
  });

  it('skips candidates whose speaker is already bound in the meeting', () => {
    const plan = planVoiceMatchSpeakerAssignments({
      meetingId: 'meeting-1',
      candidates: [candidateSpeaker1],
      profiles: [profileAlex],
      rejections: [],
      existingBindings: [
        {
          speaker: 'Remote Speaker 1',
          personId: 'person-charlie',
          individual: true,
          source: 'user',
          sourceRevision: 'rev-0',
          evidence: [],
        },
      ],
      isAutomaticBindingSuppressed: () => false,
    });

    expect(plan.status).toBe('abstain');
    expect(plan.reason).toBe('no_strong_matches');
  });

  it('abstains when automatic binding is suppressed for that speaker', () => {
    const plan = planVoiceMatchSpeakerAssignments({
      meetingId: 'meeting-1',
      candidates: [candidateSpeaker1],
      profiles: [profileAlex],
      rejections: [],
      existingBindings: [],
      isAutomaticBindingSuppressed: (speaker, assignment) =>
        speaker === 'Remote Speaker 1' &&
        assignment === VOICE_MATCH_STRONG_ASSIGNMENT,
    });

    expect(plan.status).toBe('abstain');
    expect(plan.abstentions).toContainEqual({
      speaker: 'Remote Speaker 1',
      reason: 'suppressed',
    });
  });

  it('abstains when the candidate was previously rejected for this person', () => {
    const rejection: SpeakerVoiceRejection = {
      meetingId: 'meeting-1',
      speaker: 'Remote Speaker 1',
      sourceRevision: 'rev-1',
      candidateDigest: 'digest-speaker-1',
      personId: 'person-alex',
      rejectedAt: '2026-09-01T00:00:00Z',
    };

    const plan = planVoiceMatchSpeakerAssignments({
      meetingId: 'meeting-1',
      candidates: [candidateSpeaker1],
      profiles: [profileAlex],
      rejections: [rejection],
      existingBindings: [],
      isAutomaticBindingSuppressed: () => false,
    });

    expect(plan.status).toBe('abstain');
  });

  it('reconcileVoiceMatchSpeakerIdentity sets bindings with voice_match_strong_v1 kind and ensures meeting entity', () => {
    const setBinding = vi.fn();
    const ensureMeetingEntity = vi.fn();

    const plan = reconcileVoiceMatchSpeakerIdentity({
      meetingId: 'meeting-1',
      getCandidates: () => [candidateSpeaker1],
      getProfiles: () => [profileAlex],
      getRejections: () => [],
      getBindings: () => [],
      isAutomaticBindingSuppressed: () => false,
      setBinding,
      ensureMeetingEntity,
    });

    expect(plan.status).toBe('bind');
    expect(setBinding).toHaveBeenCalledWith('meeting-1', {
      speaker: 'Remote Speaker 1',
      personId: 'person-alex',
      individual: true,
      source: 'user',
      sourceRevision: 'rev-1',
      evidence: [],
      assignment: {
        kind: VOICE_MATCH_STRONG_ASSIGNMENT,
      },
    });
    expect(ensureMeetingEntity).toHaveBeenCalledWith({
      meeting_id: 'meeting-1',
      entity_id: 'person-alex',
      context: 'Recognized speaker in meeting',
    });
  });
});

import * as db from '../../electron/db';
import { handleIdentityRequest } from '../../electron/identityHandlers';
import { handleSpeakerVoiceRequest } from '../../electron/speakerVoiceHandlers';
import {
  enrollSpeakerVoice,
  getCanonicalVoiceProfiles,
  getMeetingSpeakerCandidates,
  getVoiceRejections,
  saveMeetingSpeakerCandidates,
} from '../../electron/speakerVoiceStore';

describe('speakerVoiceIdentity - database and handler integration', () => {
  let fixture = 100;
  let meetingId: string;
  let personId: string;
  const sourceRevision = 'rev-integration-1';

  const dummyProvenance = {
    ...DEFAULT_CALIBRATION_POLICY_V1.compatibilityKey,
    enrollmentExtractionVersion: 'single-pass-v2',
  };

  const createVector = (dominantIndex: number): number[] => {
    const v = new Array(256).fill(0);
    v[dominantIndex] = 1.0;
    return v;
  };

  const candidateSpeaker1: SpeakerCandidateEvidence & {
    sourceRevision: string;
  } = {
    speaker: 'Remote Speaker 1',
    nativeCluster: 'S1',
    candidateDigest: 'digest-speaker-1',
    sourceRevision,
    embedding: createVector(0),
    representativeEmbeddings: [createVector(0), createVector(0)],
    cleanDurationSeconds: 5.0,
    cleanSegmentCount: 3,
    cleanChunkCount: 3,
    minimumChunkSimilarity: 0.85,
    meanChunkSimilarity: 0.9,
    referenceInterval: { startTime: 1.0, endTime: 4.0, excerpt: 'Hello Alex' },
    provenance: dummyProvenance,
    isEligibleForEnrollment: true,
  };

  it('SPEAKER_VOICE_GET_SUGGESTIONS automatically binds unassigned strong matches and fires onBindingChange', async () => {
    fixture++;
    meetingId = `voice-auto-meeting-${fixture}`;
    personId = `voice-auto-person-${fixture}`;

    db.db.prepare('DELETE FROM speaker_voice_rejections').run();
    db.db.prepare('DELETE FROM speaker_voice_enrollments').run();
    db.db.prepare('DELETE FROM meeting_speaker_candidates').run();
    db.db.prepare('DELETE FROM identity_bindings').run();
    db.db.prepare('DELETE FROM identity_binding_suppressions').run();

    db.saveMeeting({
      id: meetingId,
      title: 'Auto Voice Test Meeting',
      capture_journal_generation: sourceRevision,
      transcript_status: 'validated',
      transcript_validated_at: '2026-08-15T00:00:00.000Z',
      transcript_json: JSON.stringify([
        { speaker: 'Remote Speaker 1', text: 'Hello Alex speaking.' },
      ]),
    });

    db.upsertEntity({
      id: personId,
      type: 'person',
      name: 'Alex',
      dedupe_by_name: false,
    });

    db.saveMeeting({
      id: 'prior-meeting',
      title: 'Prior Meeting',
      capture_journal_generation: 'prior-rev',
      transcript_status: 'validated',
      transcript_validated_at: '2026-08-10T00:00:00.000Z',
    });

    // Save prior candidate and enroll Alex
    saveMeetingSpeakerCandidates(
      'prior-meeting',
      'prior-rev',
      [
        {
          ...candidateSpeaker1,
          candidateDigest: 'prior-digest',
        },
      ],
      db.db,
    );
    enrollSpeakerVoice(
      {
        personId,
        sourceMeetingId: 'prior-meeting',
        sourceRevision: 'prior-rev',
        speaker: 'Remote Speaker 1',
        candidateDigest: 'prior-digest',
      },
      db.db,
    );

    // Save candidate for the new meeting
    saveMeetingSpeakerCandidates(
      meetingId,
      sourceRevision,
      [candidateSpeaker1],
      db.db,
    );

    const onBindingChange = vi.fn();

    // Call SPEAKER_VOICE_GET_SUGGESTIONS
    const res = await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_SUGGESTIONS',
      { meetingId },
      {
        onBindingChange,
        allowAutoAssign: true,
      },
    );

    expect(res).toBeDefined();
    // Verify onBindingChange was called
    expect(onBindingChange).toHaveBeenCalledWith({
      meetingId,
      personIds: [personId],
    });

    // Verify identity binding was persisted with voice_match_strong_v1 kind
    const bindings = db.identityStore.getBindings(meetingId);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      speaker: 'Remote Speaker 1',
      personId,
      assignment: {
        kind: VOICE_MATCH_STRONG_ASSIGNMENT,
      },
    });

    // Verify entity was linked to meeting
    const entities = db.getMeetingEntities(meetingId);
    expect(entities.some((e) => e.id === personId)).toBe(true);

    // Now verify reversibility / suppression:
    // Clearing the binding suppresses future auto-assignment for this meeting
    const latestIdentity = handleIdentityRequest('GET_MEETING_IDENTITY', {
      meetingId,
    }) as any;
    handleIdentityRequest('CLEAR_MEETING_IDENTITY_BINDING', {
      meetingId,
      speaker: 'Remote Speaker 1',
      expectedRevision: latestIdentity.revision,
    });

    // Verify binding is now cleared
    const clearedBindings = db.identityStore.getBindings(meetingId);
    expect(clearedBindings).toHaveLength(0);

    // Verify suppression was recorded
    expect(
      db.identityStore.isAutomaticBindingSuppressed(
        meetingId,
        'Remote Speaker 1',
        VOICE_MATCH_STRONG_ASSIGNMENT,
      ),
    ).toBe(true);

    // Calling SPEAKER_VOICE_GET_SUGGESTIONS again does NOT re-bind the speaker!
    onBindingChange.mockClear();
    await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_SUGGESTIONS',
      { meetingId },
      {
        onBindingChange,
        allowAutoAssign: true,
      },
    );

    expect(onBindingChange).not.toHaveBeenCalled();
    expect(db.identityStore.getBindings(meetingId)).toHaveLength(0);
  });

  it('reconciles voice matches at recording finalization, persists bindings, and updates notes projection', () => {
    fixture++;
    const finalMeetingId = `voice-commit-meeting-${fixture}`;
    const alexPersonId = `voice-commit-person-${fixture}`;
    const finalRevision = 'rev-final-1';

    db.db.prepare('DELETE FROM speaker_voice_rejections').run();
    db.db.prepare('DELETE FROM speaker_voice_enrollments').run();
    db.db.prepare('DELETE FROM meeting_speaker_candidates').run();
    db.db.prepare('DELETE FROM identity_bindings').run();
    db.db.prepare('DELETE FROM identity_binding_suppressions').run();

    // Set up person Alex
    db.upsertEntity({
      id: alexPersonId,
      type: 'person',
      name: 'Alex Developer',
      dedupe_by_name: false,
    });

    // Set up prior meeting & enroll Alex's voice profile
    db.saveMeeting({
      id: 'prior-meeting-2',
      title: 'Prior Meeting',
      capture_journal_generation: 'prior-rev-2',
      transcript_status: 'validated',
      transcript_validated_at: '2026-08-10T00:00:00.000Z',
    });

    saveMeetingSpeakerCandidates(
      'prior-meeting-2',
      'prior-rev-2',
      [
        {
          ...candidateSpeaker1,
          candidateDigest: 'prior-digest-2',
        },
      ],
      db.db,
    );
    enrollSpeakerVoice(
      {
        personId: alexPersonId,
        sourceMeetingId: 'prior-meeting-2',
        sourceRevision: 'prior-rev-2',
        speaker: 'Remote Speaker 1',
        candidateDigest: 'prior-digest-2',
      },
      db.db,
    );

    // Save finalized meeting with transcript
    db.saveMeeting({
      id: finalMeetingId,
      title: 'Finalized Meeting',
      capture_journal_generation: finalRevision,
      transcript_status: 'validated',
      transcript_validated_at: '2026-09-17T00:00:00.000Z',
      transcript_json: JSON.stringify([
        { speaker: 'Remote Speaker 1', text: 'Let us deploy the service.' },
      ]),
    });

    // Save candidate evidence produced during finalization
    saveMeetingSpeakerCandidates(
      finalMeetingId,
      finalRevision,
      [
        {
          ...candidateSpeaker1,
          sourceRevision: finalRevision,
          candidateDigest: 'final-digest-1',
        },
      ],
      db.db,
    );

    // Run reconciliation as done in COMMIT_FINAL_TRANSCRIPTION
    const voiceReconciliation = reconcileVoiceMatchSpeakerIdentity({
      meetingId: finalMeetingId,
      getCandidates: (id) => getMeetingSpeakerCandidates(id, db.db),
      getProfiles: () =>
        getCanonicalVoiceProfiles({
          dbInstance: db.db,
          activeOnly: true,
        }),
      getRejections: (id) => getVoiceRejections(id, db.db),
      getBindings: db.identityStore.getBindings,
      isAutomaticBindingSuppressed:
        db.identityStore.isAutomaticBindingSuppressed,
      setBinding: db.identityStore.setBinding,
      ensureMeetingEntity: db.ensureMeetingEntity,
    });

    expect(voiceReconciliation.status).toBe('bind');
    if (voiceReconciliation.status === 'bind') {
      expect(voiceReconciliation.assignments).toHaveLength(1);
      expect(voiceReconciliation.assignments[0]).toEqual({
        speaker: 'Remote Speaker 1',
        personId: alexPersonId,
        sourceRevision: finalRevision,
        candidateDigest: 'final-digest-1',
        similarityScore: 1.0,
      });

      // Projection refresh
      const refreshed = db.refreshMeetingIdentityProjection(finalMeetingId);
      expect(refreshed).toBe(true);
    }

    // Verify bindings were written to database with voice_match_strong_v1 kind
    const bindings = db.identityStore.getBindings(finalMeetingId);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      speaker: 'Remote Speaker 1',
      personId: alexPersonId,
      assignment: {
        kind: VOICE_MATCH_STRONG_ASSIGNMENT,
      },
    });

    // Verify entity was linked to meeting
    const entities = db.getMeetingEntities(finalMeetingId);
    expect(entities.some((e) => e.id === alexPersonId)).toBe(true);

    // Verify notes identity projection maps 'Remote Speaker 1' to 'Alex Developer'
    const projection = db.getMeetingNotesIdentityProjection(finalMeetingId);
    expect(projection.speakerDisplayNames['Remote Speaker 1']).toBe(
      'Alex Developer',
    );

    // Verify identity state shape for GET_MEETING pre-hydration
    const identityState = handleIdentityRequest('GET_MEETING_IDENTITY', {
      meetingId: finalMeetingId,
    }) as any;
    expect(identityState.meetingId).toBe(finalMeetingId);
    expect(identityState.speakerDisplayNames['Remote Speaker 1']).toBe(
      'Alex Developer',
    );
    expect(identityState.bindings[0].personId).toBe(alexPersonId);
  });
});
