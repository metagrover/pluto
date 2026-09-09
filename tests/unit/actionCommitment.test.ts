import {
  areActionsEquivalent,
  canonicalizeActionText,
  getCommitmentState,
  isThirdPartyAction,
  isThirdPartyAssignee,
  mergeCommitmentReview,
  parseActionMetadata,
} from '../../src/utils/actionCommitment';

describe('action commitment metadata', () => {
  it.each([null, '', 'not-json', '[]', '42'])(
    'treats legacy or malformed metadata %j as a possible commitment',
    (metadata) => {
      expect(parseActionMetadata(metadata)).toEqual({});
      expect(getCommitmentState(metadata)).toBe('possible');
    },
  );

  it.each([
    ['possible', 'possible'],
    ['confirmed', 'confirmed'],
    ['rejected', 'rejected'],
    ['unsupported', 'possible'],
  ] as const)(
    'resolves commitment state %s to %s',
    (commitmentState, expected) => {
      expect(
        getCommitmentState(
          JSON.stringify({ commitment_state: commitmentState }),
        ),
      ).toBe(expected);
    },
  );

  it.each(['confirmed', 'rejected'] as const)(
    'preserves action details when a review marks the commitment %s',
    (commitmentState) => {
      const reviewedAt = '2026-08-03T12:00:00.000Z';
      const metadata = JSON.stringify({
        full_description: 'Send the rollout note',
        assignee_name: 'Alex',
        commitment_state: 'possible',
        origin: 'extraction',
        source_meeting_id: 'meeting-1',
      });

      expect(
        mergeCommitmentReview(metadata, commitmentState, reviewedAt),
      ).toEqual({
        full_description: 'Send the rollout note',
        assignee_name: 'Alex',
        commitment_state: commitmentState,
        origin: 'extraction',
        source_meeting_id: 'meeting-1',
        reviewed_at: reviewedAt,
      });
    },
  );

  it('canonicalizes action text with speaker prefixes and infinitives', () => {
    expect(
      canonicalizeActionText(
        'Me will circle back with Arnold offline regarding the status of things and the timeline for tomorrow',
        'Me',
      ),
    ).toBe(
      'Circle back with Arnold offline regarding the status of things and the timeline for tomorrow',
    );

    expect(
      canonicalizeActionText(
        'Me to circle back with Arnold offline regarding the status of things and the timeline for tomorrow.',
        'Me',
      ),
    ).toBe(
      'Circle back with Arnold offline regarding the status of things and the timeline for tomorrow',
    );

    expect(
      canonicalizeActionText(
        'Them to collect data and share it with Me.',
        'Them',
      ),
    ).toBe('Collect data and share it with Me');

    expect(
      canonicalizeActionText(
        'Them will collect the data and share it.',
        'Them',
      ),
    ).toBe('Collect the data and share it');

    expect(
      canonicalizeActionText('The team will set up those filters', 'Ayush'),
    ).toBe('Set up those filters');

    expect(
      canonicalizeActionText('Nira will prepare the launch checklist', 'Nira'),
    ).toBe('Prepare the launch checklist');

    expect(canonicalizeActionText("I'll follow up on Monday.")).toBe(
      'Follow up on Monday',
    );
  });

  it('normalizes terminal punctuation without losing conditions or internal decimals', () => {
    expect(
      canonicalizeActionText('Send version 1.2 by Friday if legal approves.'),
    ).toBe('Send version 1.2 by Friday if legal approves');
    expect(
      canonicalizeActionText('Do not send version 1.2 until legal approves.'),
    ).toBe('Do not send version 1.2 until legal approves');
    expect(canonicalizeActionText('Send the outline?')).toBe(
      'Send the outline?',
    );
  });

  it('detects third-party assignees from name or text', () => {
    expect(isThirdPartyAssignee('Them')).toBe(true);
    expect(isThirdPartyAssignee('them')).toBe(true);
    expect(isThirdPartyAssignee('Remote Speaker 1')).toBe(true);
    expect(isThirdPartyAssignee('Arnold')).toBe(true);
    expect(isThirdPartyAssignee('Taylor')).toBe(true);
    expect(isThirdPartyAssignee('Sarah')).toBe(true);

    expect(isThirdPartyAssignee('Me')).toBe(false);
    expect(isThirdPartyAssignee('I')).toBe(false);
    expect(isThirdPartyAssignee('you')).toBe(false);
    expect(isThirdPartyAssignee('myself')).toBe(false);
    expect(isThirdPartyAssignee('(You)')).toBe(false);
    expect(isThirdPartyAssignee('team')).toBe(false);
    expect(isThirdPartyAssignee('the team')).toBe(false);
    expect(isThirdPartyAssignee('we')).toBe(false);
    expect(isThirdPartyAssignee(null)).toBe(false);
    expect(isThirdPartyAssignee(undefined)).toBe(false);

    // Recognizes workspace user's name when provided
    expect(
      isThirdPartyAssignee('Taylor', null, { selfNames: ['Taylor'] }),
    ).toBe(false);
    expect(
      isThirdPartyAssignee('Arnold', null, { selfNames: ['Taylor'] }),
    ).toBe(true);

    expect(
      isThirdPartyAssignee(
        undefined,
        'Them to collect data and share it with Me.',
      ),
    ).toBe(true);
    expect(isThirdPartyAssignee(undefined, 'They will collect the data.')).toBe(
      true,
    );
    expect(
      isThirdPartyAssignee(undefined, 'Remote speaker to provide updates.'),
    ).toBe(true);
    expect(
      isThirdPartyAssignee(
        undefined,
        'Taylor will send the benchmark numbers.',
      ),
    ).toBe(true);
    expect(
      isThirdPartyAssignee(undefined, 'Arnold needs to circle back with team.'),
    ).toBe(true);
    expect(isThirdPartyAssignee('Me', 'Me will circle back with Arnold.')).toBe(
      false,
    );
    expect(
      isThirdPartyAssignee(undefined, 'Circle back with Arnold offline.'),
    ).toBe(false);
    expect(
      isThirdPartyAssignee(undefined, 'Remember to send release notes.'),
    ).toBe(false);
  });

  it('determines whether an entity action item is assigned to a third party', () => {
    expect(
      isThirdPartyAction({
        assigned_to: 'person-arnold',
      }),
    ).toBe(true);

    expect(
      isThirdPartyAction(
        { assigned_to: 'person-me' },
        { selfPersonId: 'person-me' },
      ),
    ).toBe(false);

    expect(
      isThirdPartyAction(
        { assigned_to: 'person-arnold' },
        { selfPersonId: 'person-me' },
      ),
    ).toBe(true);

    expect(
      isThirdPartyAction({
        assigned_to: null,
        metadata: JSON.stringify({ assignee_name: 'Taylor' }),
        name: 'Send benchmark report',
      }),
    ).toBe(true);

    expect(
      isThirdPartyAction({
        assigned_to: null,
        metadata: JSON.stringify({ assignee_name: 'Me' }),
        name: 'Send benchmark report',
      }),
    ).toBe(false);

    expect(
      isThirdPartyAction({
        assigned_to: null,
        metadata: '{}',
        name: 'Send benchmark report',
      }),
    ).toBe(false);
  });

  it('recognizes equivalent action items from the same meeting', () => {
    const item1 = {
      title:
        'Me will circle back with Arnold offline regarding the status of things and the timeline for tomorrow',
      sourceMeetingId: 'meeting-1',
    };
    const item2 = {
      title:
        'Me to circle back with Arnold offline regarding the status of things and the timeline for tomorrow.',
      sourceMeetingId: 'meeting-1',
    };
    const item3 = {
      title:
        'Me will circle back with Arnold offline regarding his status and the update on the timeline for tomorrow',
      sourceMeetingId: 'meeting-1',
    };
    const itemDifferentMeeting = {
      title: 'Circle back with Arnold offline regarding something else',
      sourceMeetingId: 'meeting-2',
    };

    expect(areActionsEquivalent(item1, item2)).toBe(true);
    expect(areActionsEquivalent(item1, item3)).toBe(true);
    expect(areActionsEquivalent(item1, itemDifferentMeeting)).toBe(false);
  });

  it('handles strings, entity metadata, and distinguishes different assignees', () => {
    const actionEntity = {
      id: 'entity-1',
      name: 'Me will circle back with Arnold offline regarding the status of things and the timeline for tomo',
      metadata: JSON.stringify({
        source_meeting_id: 'meeting-1',
        assignee_name: 'Me',
      }),
    };
    const candidateItem = {
      title:
        'Circle back with Arnold offline regarding the status of things and the timeline for tomorrow',
      sourceMeetingId: 'meeting-1',
    };

    expect(areActionsEquivalent(actionEntity, candidateItem)).toBe(true);
    expect(
      areActionsEquivalent(
        'Circle back with Arnold offline regarding the status of things and the timeline for tomorrow',
        'Me will circle back with Arnold offline regarding the status of things and the timeline for tomorrow',
      ),
    ).toBe(true);

    // Different assignees are not equivalent
    const alexTask = {
      title: 'Publish the launch memo',
      assigneeName: 'Alex',
      sourceMeetingId: 'meeting-1',
    };
    const taylorTask = {
      title: 'Publish the launch memo',
      assigneeName: 'Taylor',
      sourceMeetingId: 'meeting-1',
    };
    expect(areActionsEquivalent(alexTask, taylorTask)).toBe(false);
  });
});
