import { describe, expect, it } from 'vitest';
import {
  buildProjectHealth,
  buildProjectMeetingStats,
  buildProjectMilestones,
  buildProjectMomentum,
  buildUserProjectMilestones,
  cleanPersonRole,
  readProjectDisplayTitle,
  sortProjectMilestones,
  withProjectDisplayTitle,
} from '../../src/utils/projectBriefing';

describe('project briefing identity', () => {
  it('compacts an untouched detected title without changing its identity record', () => {
    expect(
      readProjectDisplayTitle(
        null,
        'Build the searchable historical archive modernization initiative',
      ),
    ).toBe('Searchable historical archive modernization');
  });

  it('keeps a user display title separate from detected identity', () => {
    const metadata = withProjectDisplayTitle(
      JSON.stringify({ context: 'Detected context' }),
      'Aurora launch',
    );

    expect(
      readProjectDisplayTitle(metadata, 'Long detected project name'),
    ).toBe('Aurora launch');
    expect(JSON.parse(metadata)).toMatchObject({
      context: 'Detected context',
      projectDisplayTitle: 'Aurora launch',
    });
  });

  it('falls back safely when metadata is malformed', () => {
    expect(readProjectDisplayTitle('{', 'Detected title')).toBe(
      'Detected title',
    );
  });
});

describe('project meeting analytics', () => {
  it('uses trusted participant coverage, median room size and recurring cadence', () => {
    const meetings = [0, 7, 14, 21].map((days, index) => ({
      id: `m${index}`,
      title: 'Aurora weekly review',
      started_at: new Date(Date.UTC(2026, 7, 1 + days)).toISOString(),
      created_at: null,
      participants: [
        { entity_id: 'person:alex', name: 'Alex' },
        { entity_id: 'person:sam', name: 'Sam' },
        ...(index % 2 ? [{ entity_id: 'person:jo', name: 'Jo' }] : []),
        { entity_id: 'speaker:unknown', name: 'Speaker 1' },
      ],
    }));

    const result = buildProjectMeetingStats(meetings);

    expect(result.meetingCount).toBe(4);
    expect(result.participantCoverage).toBe(4);
    expect(result.typicalParticipantCount).toBe(3);
    expect(result.frequentParticipants).toEqual(['Alex', 'Sam', 'Jo']);
    expect(result.recurringSeries).toMatchObject([
      { meetingCount: 4, cadence: 'Weekly pattern' },
    ]);
  });

  it('does not claim recurrence or attendance without enough evidence', () => {
    const result = buildProjectMeetingStats([
      {
        id: 'm1',
        title: 'Kickoff',
        started_at: '2026-08-01T10:00:00Z',
        created_at: null,
        participants: [{ entity_id: 'speaker:one', name: 'Speaker 1' }],
      },
    ]);

    expect(result.participantCoverage).toBe(0);
    expect(result.typicalParticipantCount).toBeNull();
    expect(result.recurringSeries).toEqual([]);
  });

  it('deduplicates participants across meetings with different entity IDs and prevents within-meeting inflation', () => {
    const meetings = [
      {
        id: 'm1',
        title: 'Weekly sync 1',
        started_at: '2026-08-01T10:00:00Z',
        created_at: null,
        participants: [
          { entity_id: 'uuid-1', name: 'Adam' },
          { entity_id: 'uuid-1-dup', name: 'Adam' }, // duplicate in same meeting
          { entity_id: 'r-1', name: 'Rachel Owen' },
        ],
      },
      {
        id: 'm2',
        title: 'Weekly sync 2',
        started_at: '2026-08-08T10:00:00Z',
        created_at: null,
        participants: [
          { entity_id: 'uuid-2', name: 'Adam' },
          { entity_id: 'r-2', name: 'Rachel Owen' },
        ],
      },
      {
        id: 'm3',
        title: 'Weekly sync 3',
        started_at: '2026-08-15T10:00:00Z',
        created_at: null,
        participants: [
          { entity_id: 'uuid-3', name: 'Adam' },
          { entity_id: 'h-1', name: 'Hema' },
        ],
      },
    ];

    const result = buildProjectMeetingStats(meetings);
    expect(result.typicalParticipantCount).toBe(2);
    expect(result.frequentParticipants).toEqual([
      'Adam',
      'Rachel Owen',
      'Hema',
    ]);
  });

  it('sanitizes placeholder roles with cleanPersonRole', () => {
    expect(cleanPersonRole('undefined')).toBeUndefined();
    expect(cleanPersonRole('null')).toBeUndefined();
    expect(cleanPersonRole('n/a')).toBeUndefined();
    expect(cleanPersonRole('unknown')).toBeUndefined();
    expect(cleanPersonRole('none')).toBeUndefined();
    expect(cleanPersonRole('')).toBeUndefined();
    expect(cleanPersonRole(null)).toBeUndefined();
    expect(cleanPersonRole(undefined)).toBeUndefined();
    expect(cleanPersonRole('Client Advisor')).toBe('Client Advisor');
    expect(cleanPersonRole('Colleague')).toBe('Colleague');
  });
});

describe('project milestones and health', () => {
  const now = new Date('2026-08-29T12:00:00Z').getTime();

  it('calls a project behind only from an overdue confirmed commitment', () => {
    const tasks = [
      {
        id: 't1',
        name: 'Complete reliability benchmark',
        status: 'active' as const,
        due_date: '2026-08-20T12:00:00Z',
        updated_at: '2026-08-10T12:00:00Z',
        metadata: JSON.stringify({ evidence_quote: 'Finish it by August 20.' }),
      },
    ];

    expect(buildProjectHealth(tasks, undefined, now)).toMatchObject({
      state: 'falling_behind',
      headline: 'Falling behind',
    });
    expect(buildProjectMilestones(tasks, now)[0]).toMatchObject({
      status: 'overdue',
      timing: 'Aug 20',
      source: 'commitment',
      targetDate: '2026-08-20T12:00:00Z',
    });
  });

  it('keeps user milestones distinct and orders active work before completed work', () => {
    const metadata = JSON.stringify({
      projectMilestonesVersion: 1,
      projectMilestones: [
        {
          id: 'user-complete',
          title: 'Requirements signed off',
          status: 'completed',
          targetDate: '2026-08-10',
          note: null,
          createdAt: '2026-08-01T12:00:00Z',
          updatedAt: '2026-08-20T12:00:00Z',
        },
        {
          id: 'user-next',
          title: 'Private beta',
          status: 'planned',
          targetDate: '2026-09-05',
          note: 'Invite five design partners',
          createdAt: '2026-08-20T12:00:00Z',
          updatedAt: '2026-08-20T12:00:00Z',
        },
      ],
    });

    const result = sortProjectMilestones(
      buildUserProjectMilestones(metadata, now),
    );
    expect(result.map((milestone) => milestone.id)).toEqual([
      'user-next',
      'user-complete',
    ]);
    expect(result[0]).toMatchObject({
      status: 'upcoming',
      source: 'user',
      userStatus: 'planned',
      targetDate: '2026-09-05',
      note: 'Invite five design partners',
    });
  });

  it('requires positive recent evidence before saying a project appears on track', () => {
    const completed = [
      {
        id: 't1',
        name: 'Ship private beta',
        status: 'completed' as const,
        due_date: null,
        updated_at: '2026-08-25T12:00:00Z',
        metadata: null,
      },
    ];

    expect(buildProjectHealth(completed, undefined, now).state).toBe(
      'appears_on_track',
    );
    expect(buildProjectHealth([], undefined, now).state).toBe(
      'not_enough_evidence',
    );
  });

  it('summarizes observed momentum without inventing a progress score', () => {
    const meetings = [
      {
        id: 'recent',
        title: 'Launch review',
        started_at: '2026-08-27T12:00:00Z',
        created_at: null,
      },
      {
        id: 'older',
        title: 'Kickoff',
        started_at: '2026-07-01T12:00:00Z',
        created_at: null,
      },
    ];
    const tasks = [
      {
        id: 'open',
        name: 'Confirm launch scope',
        status: 'active',
        due_date: null,
        updated_at: '2026-08-28T12:00:00Z',
        metadata: null,
      },
      {
        id: 'done',
        name: 'Finish prototype',
        status: 'completed',
        due_date: null,
        updated_at: '2026-08-25T12:00:00Z',
        metadata: null,
      },
    ];

    expect(buildProjectMomentum(meetings, tasks, now)).toEqual({
      recentMeetingCount: 1,
      openCommitmentCount: 1,
      completedCommitmentCount: 1,
      recentlyCompletedCount: 1,
      lastActivityAt: '2026-08-28T12:00:00Z',
      headline: 'Recent activity and completed work',
    });
    expect(buildProjectMomentum([], [], now).headline).toBe(
      'Not enough evidence for a trend',
    );
  });
});
