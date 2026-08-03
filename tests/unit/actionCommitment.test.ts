import {
  getCommitmentState,
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
      });

      expect(
        mergeCommitmentReview(metadata, commitmentState, reviewedAt),
      ).toEqual({
        full_description: 'Send the rollout note',
        assignee_name: 'Alex',
        commitment_state: commitmentState,
        origin: 'extraction',
        reviewed_at: reviewedAt,
      });
    },
  );
});
