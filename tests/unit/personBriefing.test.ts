import { describe, expect, it } from 'vitest';

import {
  type PersonMeetingRecord,
  mergePersonMeetingEvidence,
  selectVerifiedPersonCommitments,
} from '../../src/utils/personBriefing';

const meeting = (id: string, startedAt: string): PersonMeetingRecord => ({
  id,
  title: `Meeting ${id}`,
  started_at: startedAt,
  created_at: startedAt,
  duration_seconds: 1_800,
  context: `Context for ${id}`,
});

describe('person meeting evidence', () => {
  it('keeps the strongest evidence for each meeting and sorts newest first', () => {
    const result = mergePersonMeetingEvidence({
      confirmed: [meeting('shared', '2026-08-01T10:00:00.000Z')],
      scheduled: [
        meeting('scheduled', '2026-08-03T10:00:00.000Z'),
        meeting('shared', '2026-08-01T10:00:00.000Z'),
      ],
      mentioned: [
        meeting('mentioned', '2026-08-02T10:00:00.000Z'),
        meeting('shared', '2026-08-01T10:00:00.000Z'),
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({ id: 'scheduled', evidence: 'scheduled' }),
      expect.objectContaining({ id: 'mentioned', evidence: 'mentioned' }),
      expect.objectContaining({ id: 'shared', evidence: 'confirmed' }),
    ]);
    expect(result.filter((item) => item.id === 'shared')).toHaveLength(1);
  });
});

describe('verified person commitments', () => {
  const now = Date.parse('2026-08-31T12:00:00.000Z');
  const base = {
    id: 'action-1',
    name: 'Send the final brief',
    status: 'active' as const,
    due_date: '2026-09-02',
    assigned_to: 'person-1',
    metadata: JSON.stringify({
      owner_source: 'user',
      commitment_state: 'confirmed',
      source_meeting_id: 'meeting-1',
      source_evidence: 'I will send the final brief on Wednesday.',
    }),
    updated_at: '2026-08-30T12:00:00.000Z',
    sourceMeetingTitle: 'Launch review',
  };

  it('returns only explicitly owned open expectations', () => {
    const result = selectVerifiedPersonCommitments({
      personId: 'person-1',
      actions: [
        base,
        { ...base, id: 'name-only', assigned_to: null },
        {
          ...base,
          id: 'pipeline-owner',
          metadata: JSON.stringify({
            owner_source: 'pipeline',
            commitment_state: 'confirmed',
          }),
        },
        { ...base, id: 'other-owner', assigned_to: 'person-2' },
      ],
      now,
    });

    expect(result.open).toEqual([
      expect.objectContaining({
        id: 'action-1',
        sourceMeetingId: 'meeting-1',
        evidence: 'I will send the final brief on Wednesday.',
      }),
    ]);
    expect(result.delivered).toEqual([]);
  });

  it('keeps only recently completed explicit deliveries', () => {
    const result = selectVerifiedPersonCommitments({
      personId: 'person-1',
      actions: [
        {
          ...base,
          id: 'recent',
          status: 'completed',
          updated_at: '2026-08-20T12:00:00.000Z',
        },
        {
          ...base,
          id: 'old',
          status: 'completed',
          updated_at: '2026-05-01T12:00:00.000Z',
        },
      ],
      now,
      deliveryWindowDays: 60,
    });

    expect(result.delivered.map((item) => item.id)).toEqual(['recent']);
  });
});
