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

    db.saveMeeting({
      id: meetingId,
      title: 'Voice Test Meeting',
      capture_journal_generation: sourceRevision,
      transcript_status: 'validated',
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

  it('returns suggestions when enabled and strips biometric embeddings', async () => {
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

    // Default disabled -> empty suggestions
    const disabledResult = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_SUGGESTIONS',
      { meetingId },
      { isFeatureFlagEnabled: () => false },
    )) as {
      suggestions: Record<string, unknown>;
      candidates: Record<string, { sourceRevision: string }>;
    };
    expect(disabledResult.suggestions).toEqual({});
    expect(disabledResult.candidates['Remote Speaker 1']?.sourceRevision).toBe(
      sourceRevision,
    );

    // Enabled -> returns suggestion without raw embedding
    const enabledResult = (await handleSpeakerVoiceRequest(
      'SPEAKER_VOICE_GET_SUGGESTIONS',
      { meetingId },
      { isFeatureFlagEnabled: () => true },
    )) as { suggestions: Record<string, any> };

    expect(enabledResult.suggestions['Remote Speaker 1']).toBeDefined();
    const suggestion = enabledResult.suggestions['Remote Speaker 1'];
    expect(suggestion.suggestedPersonId).toBe(personId);
    expect(suggestion.suggestedPersonName).toBe('Robin');
    expect(suggestion.confidenceTier).toBe('strong');
    expect(suggestion.sourceRevision).toBe(sourceRevision);
    expect(suggestion.embedding).toBeUndefined(); // NEVER leaked to renderer!
  });

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
