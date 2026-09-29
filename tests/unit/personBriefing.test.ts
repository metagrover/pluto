import { describe, expect, it } from 'vitest';

import {
  type PersonMeetingRecord,
  isUsablePersonName,
  mergePersonMeetingEvidence,
  selectCandidatePersonCommitments,
  selectPersonActivity,
  selectPersonCommitments,
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

it('shows recent named work without treating nearby people or generic discussion as their activity', () => {
  const meetings = mergePersonMeetingEvidence({
    confirmed: [meeting('new', '2026-09-20T10:00:00.000Z')],
    scheduled: [],
    mentioned: [meeting('old', '2026-08-01T10:00:00.000Z')],
  });
  const analyses = new Map<string, unknown>([
    [
      'new',
      {
        topics: [
          {
            key_points: [
              {
                text: 'Avery Chen revised the launch handoff after the product review.',
              },
              { text: 'Jordan asked Avery Chen to review the release plan.' },
              { text: 'The team discussed the launch handoff.' },
            ],
          },
        ],
      },
    ],
    [
      'old',
      {
        topics: [
          {
            key_points: [
              {
                text: 'Avery Chen proposed an earlier review of the launch materials.',
              },
            ],
          },
        ],
      },
    ],
  ]);

  expect(selectPersonActivity(meetings, ['Avery Chen'], analyses)).toEqual([
    expect.objectContaining({
      meetingId: 'new',
      text: 'Avery Chen revised the launch handoff after the product review.',
      evidence: 'confirmed',
    }),
    expect.objectContaining({
      meetingId: 'old',
      text: 'Avery Chen proposed an earlier review of the launch materials.',
      evidence: 'mentioned',
    }),
  ]);
});

it('includes accepted focus updates with a linked source among recent activity', () => {
  const meetings = mergePersonMeetingEvidence({
    confirmed: [meeting('recent', '2026-09-20T10:00:00.000Z')],
    scheduled: [],
    mentioned: [meeting('older', '2026-09-10T10:00:00.000Z')],
  });
  const activity = selectPersonActivity(
    meetings,
    ['Avery Chen'],
    new Map([
      [
        'older',
        {
          topics: [
            {
              key_points: [{ text: 'Avery Chen prepared the launch handoff.' }],
            },
          ],
        },
      ],
    ]),
    5,
    [
      {
        value: 'Coordinating the product review',
        sourceMeetingIds: ['recent'],
      },
      { value: 'Unsupported claim', sourceMeetingIds: ['missing'] },
    ],
  );

  expect(activity).toEqual([
    expect.objectContaining({
      text: 'Coordinating the product review',
      meetingId: 'recent',
      source: 'accepted_focus',
    }),
    expect.objectContaining({
      text: 'Avery Chen prepared the launch handoff.',
      meetingId: 'older',
    }),
  ]);
});

it('uses an unambiguous first name only in a confirmed conversation', () => {
  const meetings = mergePersonMeetingEvidence({
    confirmed: [meeting('confirmed', '2026-09-20T10:00:00.000Z')],
    scheduled: [],
    mentioned: [meeting('mentioned', '2026-09-19T10:00:00.000Z')],
  });
  const analyses = new Map<string, unknown>([
    [
      'confirmed',
      {
        topics: [
          {
            key_points: [
              { text: 'Avery prepared the launch handoff for review.' },
            ],
          },
        ],
      },
    ],
    [
      'mentioned',
      {
        topics: [
          {
            key_points: [{ text: 'Avery discussed a separate launch idea.' }],
          },
        ],
      },
    ],
  ]);

  expect(
    selectPersonActivity(meetings, ['Avery Chen'], analyses, 5, [], 'Avery'),
  ).toEqual([expect.objectContaining({ meetingId: 'confirmed' })]);
  expect(selectPersonActivity(meetings, ['Avery Chen'], analyses)).toEqual([]);
});

describe('person identity hygiene', () => {
  it.each([
    'None',
    'unknown',
    'speaker',
    'Speaker 3',
    'Remote Speaker 2',
    'Local Speaker 4',
    'Participant 2',
    'Voice 5',
    'Unknown Speaker 6',
    'Me again',
    'Them (again)',
    'none specified',
  ])('rejects non-person label %s', (name) => {
    expect(isUsablePersonName(name)).toBe(false);
  });

  it('keeps ordinary names', () => {
    expect(isUsablePersonName('Avery Chen')).toBe(true);
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

describe('candidate person commitments', () => {
  const base = {
    id: 'candidate-action',
    name: 'Send the final brief',
    status: 'active' as const,
    due_date: null,
    assigned_to: null,
    metadata: JSON.stringify({
      assignee_name: 'Avery Chen',
      commitment_state: 'possible',
      source_meeting_id: 'meeting-1',
      source_evidence: 'Avery can send the final brief.',
    }),
    updated_at: '2026-08-30T12:00:00.000Z',
    sourceMeetingTitle: 'Launch review',
  };

  it('returns source-backed owner candidates without promoting authority', () => {
    const result = selectCandidatePersonCommitments({
      personNames: ['Avery Chen'],
      actions: [
        base,
        {
          ...base,
          id: 'different-person',
          metadata: JSON.stringify({
            assignee_name: 'Jordan Vale',
            commitment_state: 'possible',
            source_meeting_id: 'meeting-1',
          }),
        },
        { ...base, id: 'already-owned', assigned_to: 'person-1' },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: 'candidate-action',
        suggestedOwnerName: 'Avery Chen',
        sourceMeetingId: 'meeting-1',
      }),
    ]);
  });

  it('does not resurface a user-rejected owner candidate', () => {
    expect(
      selectCandidatePersonCommitments({
        personNames: ['Avery Chen'],
        actions: [
          {
            ...base,
            metadata: JSON.stringify({
              assignee_name: 'Avery Chen',
              owner_source: 'user',
              commitment_state: 'possible',
              source_meeting_id: 'meeting-1',
            }),
          },
        ],
      }),
    ).toEqual([]);
  });

  it('accepts candidate actions when suggested_owner_name matches personNames even if assignee_name was generic', () => {
    const result = selectCandidatePersonCommitments({
      personNames: ['Ayush Grover'],
      actions: [
        {
          ...base,
          id: 'bound-speaker-action',
          suggested_owner_name: 'Ayush Grover',
          metadata: JSON.stringify({
            assignee_name: 'Speaker 1',
            commitment_state: 'possible',
            source_meeting_id: 'meeting-1',
          }),
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: 'bound-speaker-action',
        suggestedOwnerName: 'Ayush Grover',
        sourceMeetingId: 'meeting-1',
      }),
    ]);
  });
});

describe('selectPersonCommitments', () => {
  const verifiedAction = {
    id: 'verified-1',
    name: 'Verified task',
    status: 'active' as const,
    due_date: '2026-09-02',
    assigned_to: 'person-1',
    metadata: JSON.stringify({
      owner_source: 'user',
      commitment_state: 'confirmed',
      source_meeting_id: 'meeting-1',
      source_evidence: 'Confirmed task evidence.',
    }),
    updated_at: '2026-08-30T12:00:00.000Z',
    sourceMeetingTitle: 'Launch review',
  };

  const extractedAction = {
    id: 'extracted-1',
    name: 'Extracted task from notes',
    status: 'active' as const,
    due_date: '2026-09-05',
    assigned_to: null,
    metadata: JSON.stringify({
      assignee_name: 'Jordan Vale',
      commitment_state: 'possible',
      source_meeting_id: 'meeting-1',
      source_evidence: 'Jordan will handle the extracted task.',
    }),
    updated_at: '2026-08-31T12:00:00.000Z',
    sourceMeetingTitle: 'Launch review',
  };

  it('keeps candidate friction for the workspace user (isSelf === true)', () => {
    const result = selectPersonCommitments({
      personId: 'person-1',
      personNames: ['Jordan Vale'],
      actions: [verifiedAction],
      candidateActions: [extractedAction],
      isSelf: true,
    });

    expect(result.open.map((item) => item.id)).toEqual(['verified-1']);
    expect(result.candidates.map((item) => item.id)).toEqual(['extracted-1']);
    expect(result.delivered).toEqual([]);
  });

  it('removes friction for others (isSelf === false), promoting extracted commitments directly to open', () => {
    const result = selectPersonCommitments({
      personId: 'person-1',
      personNames: ['Jordan Vale'],
      actions: [verifiedAction],
      candidateActions: [extractedAction],
      isSelf: false,
    });

    expect(result.open.map((item) => item.id)).toEqual([
      'verified-1',
      'extracted-1',
    ]);
    expect(result.candidates).toEqual([]);
    expect(result.delivered).toEqual([]);
  });

  it('promotes completed candidate actions to delivered for non-self individuals', () => {
    const now = Date.parse('2026-08-31T12:00:00.000Z');
    const completedExtractedAction = {
      ...extractedAction,
      id: 'completed-extracted-1',
      status: 'completed' as const,
      updated_at: '2026-08-25T12:00:00.000Z',
    };

    const result = selectPersonCommitments({
      personId: 'person-1',
      personNames: ['Jordan Vale'],
      actions: [],
      candidateActions: [completedExtractedAction],
      isSelf: false,
      now,
    });

    expect(result.open).toEqual([]);
    expect(result.delivered.map((item) => item.id)).toEqual([
      'completed-extracted-1',
    ]);
    expect(result.candidates).toEqual([]);
  });
});
