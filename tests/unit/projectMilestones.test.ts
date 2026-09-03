import { describe, expect, it } from 'vitest';
import {
  readProjectMilestones,
  readUserProjectMilestones,
  restoreUserProjectMilestone,
  withSavedDreamingProjectMilestone,
  withSavedUserProjectMilestone,
  withoutUserProjectMilestone,
} from '../../src/utils/projectMilestones';

const now = '2026-08-29T12:00:00.000Z';

describe('project milestone metadata', () => {
  it('reads only valid versioned milestone records', () => {
    const metadata = JSON.stringify({
      projectMilestonesVersion: 1,
      projectMilestones: [
        {
          id: 'm1',
          title: 'Private beta',
          status: 'planned',
          targetDate: '2026-09-10',
          note: null,
          createdAt: now,
          updatedAt: now,
        },
        { id: 'broken', title: '', status: 'unknown' },
      ],
    });

    expect(readUserProjectMilestones(metadata)).toEqual([
      {
        id: 'm1',
        title: 'Private beta',
        status: 'planned',
        targetDate: '2026-09-10',
        note: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    expect(readUserProjectMilestones('{')).toEqual([]);
  });

  it('adds a normalized milestone while preserving unrelated metadata', () => {
    const result = withSavedUserProjectMilestone(
      JSON.stringify({ projectQualification: { state: 'qualified' } }),
      {
        title: '  Private beta  ',
        status: 'planned',
        targetDate: '2026-09-10',
        note: '  Confirm design partners  ',
      },
      { id: 'm1', now },
    );

    expect(result.milestone).toEqual({
      id: 'm1',
      title: 'Private beta',
      status: 'planned',
      targetDate: '2026-09-10',
      note: 'Confirm design partners',
      createdAt: now,
      updatedAt: now,
    });
    expect(JSON.parse(result.metadata)).toMatchObject({
      projectQualification: { state: 'qualified' },
      projectMilestonesVersion: 1,
      projectMilestones: [result.milestone],
    });
  });

  it('edits a milestone without changing its identity or creation time', () => {
    const created = withSavedUserProjectMilestone(
      null,
      { title: 'Private beta', status: 'planned' },
      { id: 'm1', now },
    );
    const edited = withSavedUserProjectMilestone(
      created.metadata,
      {
        id: 'm1',
        title: 'Private beta ready',
        status: 'in_progress',
        targetDate: '',
        note: '',
      },
      { id: 'ignored', now: '2026-08-30T09:00:00.000Z' },
    );

    expect(edited.milestone).toMatchObject({
      id: 'm1',
      title: 'Private beta ready',
      status: 'in_progress',
      targetDate: null,
      note: null,
      createdAt: now,
      updatedAt: '2026-08-30T09:00:00.000Z',
    });
  });

  it('rejects blank titles and unknown edit ids', () => {
    expect(() =>
      withSavedUserProjectMilestone(
        null,
        { title: '  ', status: 'planned' },
        { id: 'm1', now },
      ),
    ).toThrow('project_milestone_title_required');
    expect(() =>
      withSavedUserProjectMilestone(
        null,
        { id: 'missing', title: 'Launch', status: 'planned' },
        { id: 'm1', now },
      ),
    ).toThrow('project_milestone_not_found');
    expect(() =>
      withSavedUserProjectMilestone(
        null,
        {
          title: 'Launch',
          status: 'invalid' as 'planned',
        },
        { id: 'm1', now },
      ),
    ).toThrow('project_milestone_status_invalid');
  });

  it('removes a milestone recoverably and preserves other metadata', () => {
    const created = withSavedUserProjectMilestone(
      JSON.stringify({ context: 'Keep me' }),
      { title: 'Launch', status: 'planned' },
      { id: 'm1', now },
    );
    const removed = withoutUserProjectMilestone(created.metadata, 'm1');

    expect(removed.removed).toEqual(created.milestone);
    expect(readUserProjectMilestones(removed.metadata)).toEqual([]);
    expect(JSON.parse(removed.metadata).context).toBe('Keep me');

    const restored = restoreUserProjectMilestone(
      removed.metadata,
      removed.removed!,
      '2026-08-30T09:00:00.000Z',
    );
    expect(restored.milestone).toMatchObject({
      id: 'm1',
      title: 'Launch',
      createdAt: now,
      updatedAt: '2026-08-30T09:00:00.000Z',
    });
  });

  it('stores generated milestones with immutable evidence provenance without exposing them as user milestones', () => {
    const user = withSavedUserProjectMilestone(
      null,
      { title: 'User launch', status: 'planned' },
      { id: 'user-1', now },
    );
    const generated = withSavedDreamingProjectMilestone(
      user.metadata,
      { title: 'Evidence launch', status: 'in_progress' },
      {
        id: 'generated-1',
        now,
        proposalId: 'proposal-1',
        runId: 'run-1',
        evidence: [
          { meetingId: 'meeting-1', excerpt: 'Launch work is underway' },
        ],
      },
    );

    expect(readUserProjectMilestones(generated.metadata)).toEqual([
      user.milestone,
    ]);
    expect(readProjectMilestones(generated.metadata)[1]).toMatchObject({
      id: 'generated-1',
      source: 'dreaming',
      dreamingProposalId: 'proposal-1',
      dreamingRunId: 'run-1',
      sourceMeetingIds: ['meeting-1'],
      sourceExcerpts: ['Launch work is underway'],
    });
  });
});
