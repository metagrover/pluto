import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-project-portfolio-${process.pid}`,
}));
vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));
import * as db from '../../electron/db';
afterAll(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
it('counts established speakers instead of mentioned people and deduplicates merged identities', () => {
  const project = db.upsertEntity({
    type: 'project',
    name: 'Participant roster regression',
  });
  const people = Array.from({ length: 68 }, (_, index) =>
    db.upsertEntity({
      type: 'person',
      name: `Roster person ${index}`,
      dedupe_by_name: false,
    }),
  );
  const meetingId = 'project-roster-source';
  db.saveMeeting({
    id: meetingId,
    title: 'Roster review',
    transcript_json: JSON.stringify({
      segments: people.slice(0, 12).map((_, index) => ({
        speaker: `Speaker ${index}`,
        text: 'Review the project.',
      })),
    }),
    mid_json: JSON.stringify({
      participants: people.map((person) => ({
        entity_id: person.id,
        name: person.name,
      })),
    }),
  });
  db.addMeetingEntity({ meeting_id: meetingId, entity_id: project.id });
  people.slice(0, 13).forEach((person, index) =>
    db.identityStore.setBinding(meetingId, {
      speaker: `Speaker ${index}`,
      personId: person.id,
      individual: true,
      source: 'user',
      sourceRevision: 'fixture',
      evidence: [],
    }),
  );
  expect(db.getProjectBrief(project.id)?.meetings[0].participants).toHaveLength(
    12,
  );
  db.mergePerson(people[1].id, people[0].id);
  expect(db.getProjectBrief(project.id)?.meetings[0].participants).toHaveLength(
    11,
  );
  db.identityStore.setBinding(meetingId, {
    speaker: 'Speaker 2',
    personId: null,
    individual: true,
    source: 'user',
    sourceRevision: 'fixture',
    evidence: [],
  });
  const roster = db.getProjectBrief(project.id)?.meetings[0].participants;
  expect(roster).toHaveLength(10);
  expect(roster?.some((person) => person.entity_id === people[2].id)).toBe(
    false,
  );
});
describe('evidence-backed routing to an existing pinned project', () => {
  function routingFixture(suffix: string) {
    const qualification = {
      version: 1,
      state: 'qualified',
      source: 'extraction',
      reason: 'Established outcome',
      assessedAt: '2026-09-01',
    };
    const parent = db.upsertEntity({
      type: 'project',
      name: `Archive program ${suffix}`,
      metadata: { projectStarred: true, projectQualification: qualification },
    });
    const candidate = db.upsertEntity({
      type: 'project',
      name: `Permission validation ${suffix}`,
      metadata: { projectQualification: qualification, custom: 'preserve' },
    });
    const parentQuote =
      'The archive pilot needs access rules and permission validation for partner collections.';
    const quote =
      'Permission validation will check access rules before the searchable archive pilot launches.';
    for (const [id, text, entity] of [
      [`routing-parent-${suffix}`, parentQuote, parent],
      [`routing-new-${suffix}`, quote, candidate],
    ] as const) {
      db.saveMeeting({ id, title: 'Archive discussion', user_notes: text });
      db.addMeetingEntity({
        meeting_id: id,
        entity_id: entity.id,
        context: text,
      });
    }
    return {
      parent,
      candidate,
      membership: {
        projectId: candidate.id,
        parentProjectId: parent.id,
        relationship: 'workstream' as const,
        sourceMeetingId: `routing-new-${suffix}`,
        evidenceQuote: quote,
        parentSourceMeetingId: `routing-parent-${suffix}`,
        parentEvidenceQuote: parentQuote,
        expectedMetadata: candidate.metadata,
        expectedParentMetadata: parent.metadata,
      },
    };
  }
  it('files work, refreshes parent history, and preserves its name and pin', () => {
    const { parent, candidate, membership } = routingFixture('file');
    expect(db.saveProjectRoutingMembership(membership)).toBe(true);
    expect(JSON.parse(db.getEntity(candidate.id)!.metadata!)).toMatchObject({
      custom: 'preserve',
      projectQualification: {
        state: 'subordinate',
        parentProjectId: parent.id,
      },
    });
    expect(
      db.getProjectBrief(parent.id)?.meetings.map((meeting) => meeting.id),
    ).toContain(membership.sourceMeetingId);
    expect(db.getEntity(parent.id)).toMatchObject({
      name: parent.name,
      metadata: parent.metadata,
    });
  });
  it('accepts parent evidence linked through a reversible alias', () => {
    const { parent, membership } = routingFixture('alias-source');
    const alias = db.upsertEntity({
      type: 'project',
      name: 'Archive former name',
    });
    const sourceId = 'routing-parent-alias-only';
    db.saveMeeting({
      id: sourceId,
      title: 'Archive planning',
      user_notes: membership.parentEvidenceQuote,
    });
    db.addMeetingEntity({
      meeting_id: sourceId,
      entity_id: alias.id,
      context: membership.parentEvidenceQuote,
    });
    db.mergeProject(alias.id, parent.id);
    expect(
      db.saveProjectRoutingMembership({
        ...membership,
        parentSourceMeetingId: sourceId,
      }),
    ).toBe(true);
  });

  it('accepts parent evidence from an already filed workstream', () => {
    const { parent, membership } = routingFixture('workstream-source');
    const member = db.upsertEntity({
      type: 'project',
      name: 'Archive access work',
      metadata: {
        projectQualification: {
          version: 1,
          state: 'subordinate',
          source: 'review',
          reason: 'Filed',
          assessedAt: '2026-09-01',
          parentProjectId: parent.id,
        },
      },
    });
    const sourceId = 'routing-parent-workstream-only';
    db.saveMeeting({
      id: sourceId,
      title: 'Access planning',
      user_notes: membership.parentEvidenceQuote,
    });
    db.addMeetingEntity({
      meeting_id: sourceId,
      entity_id: member.id,
      context: membership.parentEvidenceQuote,
    });
    expect(
      db.saveProjectRoutingMembership({
        ...membership,
        parentSourceMeetingId: sourceId,
      }),
    ).toBe(true);
  });
  it('rejects a source quote changed after inference without adding parent history', () => {
    const { parent, candidate, membership } = routingFixture('stale');
    db.saveMeeting({
      id: membership.sourceMeetingId,
      title: 'Corrected discussion',
      user_notes: 'This is separate unrelated work.',
    });
    expect(db.saveProjectRoutingMembership(membership)).toBe(false);
    expect(db.getEntity(candidate.id)?.metadata).toBe(candidate.metadata);
    expect(
      db.getProjectBrief(parent.id)?.meetings.map((meeting) => meeting.id),
    ).not.toContain(membership.sourceMeetingId);
  });
  it('rejects a parent correction that arrives while inference runs', () => {
    const { parent, membership } = routingFixture('parent-correction');
    db.upsertEntity({
      ...parent,
      metadata: { projectPortfolioDisposition: 'dismissed' },
    });
    expect(db.saveProjectRoutingMembership(membership)).toBe(false);
  });
  it('uses reversible aliases and respects undo on future routing', () => {
    const { parent, candidate, membership } = routingFixture('alias');
    expect(
      db.saveProjectRoutingMembership({ ...membership, relationship: 'alias' }),
    ).toBe(true);
    expect(db.resolveProjectIdentityId(candidate.id)).toBe(parent.id);
    db.restoreProjectMerge(candidate.id);
    const restored = db.getEntity(candidate.id)!;
    expect(db.resolveProjectIdentityId(candidate.id)).toBe(candidate.id);
    expect(
      db.saveProjectRoutingMembership({
        ...membership,
        relationship: 'alias',
        expectedMetadata: restored.metadata,
      }),
    ).toBe(false);
  });
});
describe('project portfolio source summaries', () => {
  it('shares identity projections within a portfolio read and re-reads user corrections on the next read', () => {
    const projects = ['Shared portfolio A', 'Shared portfolio B'].map((name) =>
      db.upsertEntity({
        type: 'project',
        name,
        metadata: {
          projectQualification: {
            version: 1,
            state: 'qualified',
            source: 'user',
            reason: 'Fictional scope',
            assessedAt: '2026-10-01',
          },
        },
      }),
    );
    const person = db.upsertEntity({
      type: 'person',
      name: 'Casey Example',
      dedupe_by_name: false,
    });
    const meetingId = 'shared-portfolio-projection';
    db.saveMeeting({
      id: meetingId,
      title: 'Fictional shared source',
      transcript_json: JSON.stringify({
        segments: [
          { speaker: 'Speaker 1', text: 'Review the fictional work.' },
        ],
      }),
    });
    for (const project of projects)
      db.addMeetingEntity({ meeting_id: meetingId, entity_id: project.id });
    db.identityStore.setBinding(meetingId, {
      speaker: 'Speaker 1',
      personId: person.id,
      individual: true,
      source: 'user',
      sourceRevision: 'fixture',
      evidence: [],
    });
    const bindings = vi.spyOn(db.identityStore, 'getBindings');
    try {
      const rows = db.getProjectPortfolio();
      expect(
        rows
          .filter((row) => projects.some((project) => project.id === row.id))
          .every((row) => row.typical_participant_count === 1),
      ).toBe(true);
      expect(
        bindings.mock.calls.filter(([id]) => id === meetingId),
      ).toHaveLength(2);
      db.identityStore.setBinding(meetingId, {
        speaker: 'Speaker 1',
        personId: null,
        individual: true,
        source: 'user',
        sourceRevision: 'corrected-fixture',
        evidence: [],
      });
      bindings.mockClear();
      const corrected = db.getProjectPortfolio();
      expect(
        corrected
          .filter((row) => projects.some((project) => project.id === row.id))
          .every((row) => row.typical_participant_count === null),
      ).toBe(true);
      expect(
        bindings.mock.calls.filter(([id]) => id === meetingId),
      ).toHaveLength(2);
    } finally {
      bindings.mockRestore();
    }
  });
  it('returns source activity without requiring tasks and keeps unsourced entries', () => {
    const project = db.upsertEntity({ type: 'project', name: 'Aurora' });
    const other = db.upsertEntity({
      type: 'project',
      name: 'Unassessed entry',
    });
    db.saveMeeting({
      id: 'source-older',
      title: 'Older',
      started_at: '2026-08-01T10:00:00Z',
      created_at: '2026-08-28T10:00:00Z',
    });
    db.saveMeeting({
      id: 'source-newer',
      title: 'Newer',
      started_at: '2026-08-20T10:00:00Z',
    });
    db.addMeetingEntity({
      meeting_id: 'source-older',
      entity_id: project.id,
      context: 'Older evidence',
    });
    db.addMeetingEntity({
      meeting_id: 'source-newer',
      entity_id: project.id,
      context: 'Current evidence',
    });
    const rows = db.getProjectPortfolio();
    expect(rows.find((p) => p.id === project.id)).toMatchObject({
      meeting_count: 2,
      last_mentioned_at: '2026-08-20T10:00:00Z',
      latest_context: 'Current evidence',
    });
    expect(rows.find((p) => p.id === other.id)).toMatchObject({
      meeting_count: 0,
      last_mentioned_at: null,
    });
  });

  it('builds a grounded project brief with protected identity and trusted attendance', () => {
    const project = db.upsertEntity({
      type: 'project',
      name: 'A very long automatically detected archive modernization initiative',
    });
    db.updateProjectDisplayTitle(project.id, 'Archive modernization');
    db.upsertEntity({
      id: 'person:alex',
      type: 'person',
      name: 'Alex',
      metadata: { role: 'Engineering lead' },
    });
    db.upsertEntity({ id: 'person:sam', type: 'person', name: 'Sam' });
    const task = db.upsertEntity({
      type: 'action_item',
      name: 'Complete migration review',
      status: 'active',
      metadata: { commitment_state: 'confirmed' },
      due_date: '2026-09-05T10:00:00Z',
      dedupe_by_name: false,
    });
    db.linkEntities({
      source_entity_id: task.id,
      target_entity_id: project.id,
      relationship: 'belongs_to',
      state: 'confirmed',
      source: 'user',
    });
    for (const [index, day] of [1, 8, 15].entries()) {
      const meetingId = `brief-meeting-${index}`;
      db.saveMeeting({
        id: meetingId,
        title: 'Archive weekly review',
        started_at: `2026-08-${String(day).padStart(2, '0')}T10:00:00Z`,
        transcript_json: JSON.stringify({
          segments: [
            { speaker: 'Speaker 1', text: 'Review the archive.' },
            { speaker: 'Speaker 2', text: 'Agreed.' },
          ],
        }),
        mid_json: JSON.stringify({
          participants: [
            {
              entity_id: 'person:alex',
              name: 'Alex',
              role: 'Engineering lead',
            },
            { entity_id: 'person:sam', name: 'Sam' },
            { entity_id: 'speaker:unknown', name: 'Speaker 1' },
          ],
        }),
      });
      for (const [speaker, personId] of [
        ['Speaker 1', 'person:alex'],
        ['Speaker 2', 'person:sam'],
      ]) {
        db.identityStore.setBinding(meetingId, {
          speaker,
          personId,
          individual: true,
          source: 'user',
          sourceRevision: 'fixture',
          evidence: [],
        });
      }
      db.addMeetingEntity({
        meeting_id: meetingId,
        entity_id: project.id,
        context: 'Review context',
      });
    }

    const brief = db.getProjectBrief(project.id);

    expect(brief).toMatchObject({
      project: {
        id: project.id,
        displayTitle: 'Archive modernization',
        detectedTitle:
          'A very long automatically detected archive modernization initiative',
      },
      meetingStats: {
        meetingCount: 3,
        participantCoverage: 3,
        typicalParticipantCount: 2,
      },
    });
    expect(brief?.meetingStats.recurringSeries[0]).toMatchObject({
      meetingCount: 3,
      cadence: 'Weekly pattern',
    });
    expect(brief?.meetings[0]?.participants).toContainEqual({
      entity_id: 'person:alex',
      name: 'Alex',
      role: 'Engineering lead',
    });
    expect(brief?.milestones[0]).toMatchObject({
      title: 'Complete migration review',
    });
  });

  it('persists, edits, deletes and restores user milestones on the canonical project', () => {
    const project = db.upsertEntity({
      type: 'project',
      name: 'Apollo launch',
      metadata: {
        projectQualification: { state: 'qualified' },
        projectDisplayTitle: 'Apollo',
      },
      dedupe_by_name: false,
    });
    const alias = db.upsertEntity({
      type: 'project',
      name: 'Apollo beta',
      dedupe_by_name: false,
    });
    db.mergeProject(alias.id, project.id);

    const created = db.saveProjectMilestone(alias.id, {
      title: 'Private beta',
      status: 'planned',
      targetDate: '2026-09-10',
      note: 'Confirm design partners',
    });
    expect(db.getProjectBrief(project.id)?.milestones).toContainEqual(
      expect.objectContaining({
        id: created.id,
        title: 'Private beta',
        source: 'user',
      }),
    );

    const edited = db.saveProjectMilestone(project.id, {
      ...created,
      title: 'Private beta ready',
      status: 'in_progress',
    });
    expect(edited).toMatchObject({
      id: created.id,
      title: 'Private beta ready',
      status: 'in_progress',
      createdAt: created.createdAt,
    });
    expect(JSON.parse(db.getEntity(project.id)!.metadata!)).toMatchObject({
      projectQualification: { state: 'qualified' },
      projectDisplayTitle: 'Apollo',
    });

    const removed = db.deleteProjectMilestone(project.id, created.id);
    expect(removed.id).toBe(created.id);
    expect(db.getProjectBrief(project.id)?.milestones).toEqual([]);

    db.restoreProjectMilestone(project.id, removed);
    expect(db.getProjectBrief(project.id)?.milestones).toContainEqual(
      expect.objectContaining({ id: created.id, title: 'Private beta ready' }),
    );
  });

  it('merges projects as a reversible alias without deleting source records', () => {
    const destination = db.upsertEntity({
      type: 'project',
      name: 'Canonical Atlas',
      dedupe_by_name: false,
    });
    const absorbed = db.upsertEntity({
      type: 'project',
      name: 'Atlas subproject',
      dedupe_by_name: false,
    });
    db.saveMeeting({ id: 'atlas-main', title: 'Atlas planning' });
    db.saveMeeting({
      id: 'atlas-sub',
      title: 'Atlas implementation',
      duration_seconds: 300,
      user_notes:
        'A sufficiently detailed source note establishes the implementation work, its decisions, owners, risks, and follow-up context for future synthesis and makes this a trusted project source.',
    });
    db.addMeetingEntity({
      meeting_id: 'atlas-main',
      entity_id: destination.id,
    });
    db.addMeetingEntity({
      meeting_id: 'atlas-sub',
      entity_id: absorbed.id,
    });

    db.mergeProject(absorbed.id, destination.id);

    expect(db.getEntity(absorbed.id)?.name).toBe('Atlas subproject');
    expect(db.getProjectPortfolio().some((row) => row.id === absorbed.id)).toBe(
      false,
    );
    expect(
      db.getProjectPortfolio().find((row) => row.id === destination.id),
    ).toMatchObject({ meeting_count: 2 });
    expect(db.getProjectBrief(destination.id)?.mergedProjects).toContainEqual(
      expect.objectContaining({ id: absorbed.id, name: 'Atlas subproject' }),
    );
    expect(
      db.upsertEntity({ type: 'project', name: 'Atlas subproject' }).id,
    ).toBe(destination.id);
    expect(db.getEntity(destination.id)?.name).toBe('Canonical Atlas');
    const doc = db.upsertKnowledgeDoc({
      scope_type: 'project',
      scope_key: destination.id,
      title: 'Atlas context',
    });
    expect(
      db.getKnowledgeDocSourceMeetings(doc.id).map((row) => row.id),
    ).toContain('atlas-sub');

    db.restoreProjectMerge(absorbed.id);

    expect(db.getProjectPortfolio().some((row) => row.id === absorbed.id)).toBe(
      true,
    );
  });

  it('restores nested aliases to their prior project when a merge is undone', () => {
    const destination = db.upsertEntity({
      type: 'project',
      name: 'Destination project',
      dedupe_by_name: false,
    });
    const source = db.upsertEntity({
      type: 'project',
      name: 'Source project',
      dedupe_by_name: false,
    });
    const child = db.upsertEntity({
      type: 'project',
      name: 'Child project',
      dedupe_by_name: false,
    });
    db.mergeProject(child.id, source.id);
    db.mergeProject(source.id, destination.id);
    db.restoreProjectMerge(source.id);

    expect(db.upsertEntity({ type: 'project', name: 'Child project' }).id).toBe(
      source.id,
    );
    expect(db.getProjectBrief(source.id)?.mergedProjects).toContainEqual(
      expect.objectContaining({ id: child.id }),
    );
  });
});

describe('automatic project grouping persistence', () => {
  const evidenceQuote =
    'The export pipeline is a workstream within the Beacon release.';
  const setup = (suffix: string) => {
    const parent = db.upsertEntity({
      id: `beacon-${suffix}`,
      type: 'project',
      name: `Beacon ${suffix}`,
      dedupe_by_name: false,
    });
    const member = db.upsertEntity({
      id: `export-${suffix}`,
      type: 'project',
      name: `Export ${suffix}`,
      dedupe_by_name: false,
    });
    const meetingId = `group-source-${suffix}`;
    db.saveMeeting({
      id: meetingId,
      title: 'Beacon planning',
      user_notes: evidenceQuote,
    });
    db.addMeetingEntity({ meeting_id: meetingId, entity_id: member.id });
    const theme = {
      id: parent.id,
      name: parent.name,
      sourceMeetingIds: [meetingId],
      context: evidenceQuote,
      sourceContexts: { [meetingId]: evidenceQuote },
      metadata: {
        projectQualification: {
          version: 1,
          state: 'qualified',
          source: 'review',
        },
      },
      memberships: [
        {
          projectId: member.id,
          relationship: 'workstream' as 'workstream' | 'alias',
          sourceMeetingId: meetingId,
          evidenceQuote,
          expectedMetadata: member.metadata,
        },
      ],
    };
    return { parent, member, meetingId, theme };
  };

  it('files supported work and includes later child evidence and commitments in the parent', () => {
    const { parent, member, theme } = setup('workstream');
    db.saveSynthesizedProjectTheme(theme);
    expect(JSON.parse(db.getEntity(member.id)!.metadata!)).toMatchObject({
      projectQualification: {
        state: 'subordinate',
        parentProjectId: parent.id,
      },
    });
    db.saveMeeting({
      id: 'later-beacon-work',
      title: 'Export review',
      duration_seconds: 300,
      user_notes:
        'The export pipeline review confirmed release readiness, documented quality checks, and agreed a follow-up review of the export implementation with the team.',
    });
    db.addMeetingEntity({
      meeting_id: 'later-beacon-work',
      entity_id: member.id,
    });
    const task = db.upsertEntity({
      type: 'action_item',
      name: 'Review export',
      dedupe_by_name: false,
    });
    db.linkEntities({
      source_entity_id: task.id,
      target_entity_id: member.id,
      relationship: 'belongs_to',
      state: 'confirmed',
      source: 'user',
    });
    expect(
      db.getProjectBrief(parent.id)?.meetings.map((meeting) => meeting.id),
    ).toContain('later-beacon-work');
    expect(
      db.getProjectBrief(parent.id)?.tasks.map((item) => item.id),
    ).toContain(task.id);
    const doc = db.upsertKnowledgeDoc({
      scope_type: 'project',
      scope_key: parent.id,
      title: 'Beacon context',
    });
    expect(
      db.getKnowledgeDocSourceMeetings(doc.id).map((meeting) => meeting.id),
    ).toContain('later-beacon-work');
    expect(db.getEntity(member.id)).toBeDefined();
  });

  it('restores aliases without losing evidence and preserves the keep-separate correction', () => {
    const { parent, member, theme } = setup('alias');
    theme.memberships[0].relationship = 'alias';
    db.saveSynthesizedProjectTheme(theme);
    expect(
      db
        .getProjectBrief(parent.id)
        ?.mergedProjects.some((item) => item.id === member.id),
    ).toBe(true);
    db.restoreProjectMerge(member.id);
    expect(JSON.parse(db.getEntity(member.id)!.metadata!)).toMatchObject({
      projectAutoGroupingOptOut: true,
    });
    theme.memberships[0].expectedMetadata = db.getEntity(member.id)!.metadata;
    db.saveSynthesizedProjectTheme(theme);
    expect(
      db
        .getProjectBrief(parent.id)
        ?.mergedProjects.some((item) => item.id === member.id),
    ).toBe(false);
    expect(db.getProjectBrief(member.id)?.meetings).toHaveLength(1);
  });

  it('rolls back the entire save if a source disappeared, and skips a concurrent user correction', () => {
    const { parent, member, theme } = setup('rollback');
    theme.sourceMeetingIds.push('missing-source');
    expect(() => db.saveSynthesizedProjectTheme(theme)).toThrow(
      'project_theme_source_missing',
    );
    expect(db.getEntity(parent.id)?.metadata).toBe(parent.metadata);
    expect(db.getEntity(member.id)?.metadata).toBe(member.metadata);
    theme.sourceMeetingIds.pop();
    db.upsertEntity({
      ...member,
      metadata: {
        projectQualification: {
          version: 1,
          state: 'qualified',
          source: 'user',
        },
      },
    });
    db.saveSynthesizedProjectTheme(theme);
    expect(JSON.parse(db.getEntity(member.id)!.metadata!)).toMatchObject({
      projectQualification: { state: 'qualified', source: 'user' },
    });
  });
});

it('hides claims whose exact evidence was removed from current source notes', () => {
  const quote = 'The Beacon pilot is ready for the partner review.';
  db.saveMeeting({
    id: 'freshness-source',
    title: 'Beacon pilot review',
    user_notes: quote,
  });
  const project = db.upsertEntity({
    type: 'project',
    name: 'Beacon freshness',
    dedupe_by_name: false,
    metadata: {
      projectThemeSynthesis: {
        version: 3,
        sourceMeetingIds: ['freshness-source'],
        candidateProjectIds: [],
        outcome: 'Launch the Beacon pilot.',
        currentFocus: 'Review partner readiness.',
        summary: {
          text: 'The pilot is ready.',
          sourceMeetingId: 'freshness-source',
          evidenceQuote: quote,
        },
        evidence: [
          { sourceMeetingId: 'freshness-source', evidenceQuote: quote },
        ],
        workstreams: [],
        decisions: [],
        recentChanges: [],
        openThreads: [],
        synthesizedAt: '2026-09-30T10:00:00Z',
      },
    },
  });
  db.addMeetingEntity({
    meeting_id: 'freshness-source',
    entity_id: project.id,
  });
  expect(db.getProjectBrief(project.id)?.theme?.summary?.text).toBe(
    'The pilot is ready.',
  );
  db.saveMeeting({
    id: 'freshness-source',
    title: 'Beacon pilot review',
    user_notes: 'The pilot review was postponed while readiness is verified.',
  });
  expect(db.getProjectBrief(project.id)).toMatchObject({
    themeSourceOutdated: true,
    theme: { currentFocus: '', outcome: '' },
  });
  expect(db.getProjectBrief(project.id)?.theme?.summary).toBeUndefined();
  expect(
    JSON.parse(db.getEntity(project.id)!.metadata!).projectThemeSynthesis
      .summary.text,
  ).toBe('The pilot is ready.');
});

it('does not turn possible dated follow-ups into confirmed milestones or health warnings', () => {
  const project = db.upsertEntity({
    type: 'project',
    name: 'Beacon possible work',
    dedupe_by_name: false,
  });
  const task = db.upsertEntity({
    type: 'action_item',
    name: 'Explore an optional pilot',
    status: 'overdue',
    due_date: '2026-01-01',
    metadata: { commitment_state: 'possible' },
    dedupe_by_name: false,
  });
  db.linkEntities({
    source_entity_id: task.id,
    target_entity_id: project.id,
    relationship: 'belongs_to',
    state: 'confirmed',
    source: 'user',
  });
  const detail = db.getProjectBrief(project.id)!;
  expect(detail.tasks.map((item) => item.id)).toContain(task.id);
  expect(detail.milestones.some((item) => item.id === task.id)).toBe(false);
  expect(detail.health.evidenceTaskIds).not.toContain(task.id);
  expect(detail.momentum.openCommitmentCount).toBe(0);
});
