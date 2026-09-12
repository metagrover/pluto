import { describe, expect, it, vi } from 'vitest';
import {
  MANUAL_PARTICIPANT_SINGLETON_ASSIGNMENT,
  buildMeetingNotesIdentityProjection,
  planSingletonManualParticipantBinding,
  reconcileSingletonManualParticipantIdentity,
} from '../../electron/meetingParticipantIdentity';
import type { IdentityBinding } from '../../src/types/identity';

const transcript = (remoteDiarization: Record<string, unknown>) =>
  JSON.stringify({
    segments: [
      { speaker: 'Me', text: 'I will send the draft.' },
      { speaker: 'Them', text: 'I will review it.' },
    ],
    speakerAttribution: { remoteDiarization },
  });

const singletonRemote = {
  attempted: true,
  input: 'system_audio',
  applied: false,
  confidence: 1,
  clusterCount: 1,
  labeledSegmentCount: 0,
  fallbackReason: 'not_enough_speakers',
};

const participant = {
  id: 'person-alex',
  name: 'Alex',
  type: 'person',
  context: 'Manual participant',
};

const plan = (
  overrides: Partial<
    Parameters<typeof planSingletonManualParticipantBinding>[0]
  > = {},
) =>
  planSingletonManualParticipantBinding({
    meeting: { transcript_json: transcript(singletonRemote) },
    captureOrigin: 'local',
    selfPersonId: 'person-me',
    manualParticipants: [participant],
    bindings: [],
    automaticBindingSuppressed: false,
    ...overrides,
  });

describe('singleton manual participant identity', () => {
  it('maps one explicit participant to one acoustically supported remote voice', () => {
    expect(plan()).toMatchObject({
      status: 'bind',
      speaker: 'Them',
      personId: 'person-alex',
      sourceRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it.each([
    ['calendar or imported context', { captureOrigin: 'imported' as const }],
    ['no participant', { manualParticipants: [] }],
    [
      'multiple participants',
      {
        manualParticipants: [
          participant,
          { ...participant, id: 'person-riley', name: 'Riley' },
        ],
      },
    ],
    ['self only', { selfPersonId: participant.id }],
    [
      'low coverage',
      {
        meeting: {
          transcript_json: transcript({
            ...singletonRemote,
            clusterCount: 2,
            fallbackReason: 'low_coverage',
          }),
        },
      },
    ],
    [
      'multiple labeled speakers',
      {
        meeting: {
          transcript_json: JSON.stringify({
            segments: [
              { speaker: 'Remote Speaker 1', text: 'First' },
              { speaker: 'Remote Speaker 2', text: 'Second' },
            ],
            speakerAttribution: {
              remoteDiarization: {
                ...singletonRemote,
                applied: true,
                clusterCount: 2,
              },
            },
          }),
        },
      },
    ],
    ['prior binding', { bindings: [{ speaker: 'Them' } as IdentityBinding] }],
    ['prior undo', { automaticBindingSuppressed: true }],
  ])('abstains for %s', (_label, overrides) => {
    expect(plan(overrides)).toMatchObject({ status: 'abstain' });
  });

  it('persists the singleton result as a reversible user binding', () => {
    const setBinding = vi.fn();
    const result = reconcileSingletonManualParticipantIdentity({
      meetingId: 'meeting-1',
      getMeeting: () => ({ transcript_json: transcript(singletonRemote) }),
      getMeetingEntities: () => [participant],
      getCapture: () => ({ origin: 'local', selfPersonId: 'person-me' }),
      getSelfPersonId: () => 'person-current-me',
      getBindings: () => [],
      isAutomaticBindingSuppressed: () => false,
      setBinding,
    });

    expect(result.status).toBe('bind');
    expect(setBinding).toHaveBeenCalledWith(
      'meeting-1',
      expect.objectContaining({
        speaker: 'Them',
        personId: 'person-alex',
        source: 'user',
        assignment: { kind: MANUAL_PARTICIPANT_SINGLETON_ASSIGNMENT },
      }),
    );
  });

  it('projects only current confirmed bindings into notes', () => {
    expect(
      buildMeetingNotesIdentityProjection({
        transcriptJson: transcript(singletonRemote),
        bindings: [
          {
            speaker: 'Them',
            personId: 'person-alex',
            individual: true,
            source: 'user',
            sourceRevision: 'stale-but-user-confirmed',
            evidence: [],
          },
          {
            speaker: 'Me',
            personId: 'person-me',
            individual: true,
            source: 'source',
            sourceRevision: 'stale',
            evidence: [],
          },
        ],
        people: [
          { id: 'person-alex', name: 'Alex' },
          { id: 'person-me', name: 'Me Person' },
        ],
      }),
    ).toEqual({
      speakerDisplayNames: { Them: 'Alex' },
      trustedUserTerms: ['Alex'],
    });
  });
});
