import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-project-portfolio-${process.pid}`,
}));
vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));
import * as db from '../../electron/db';
afterAll(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
describe('project portfolio source summaries', () => {
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
    const task = db.upsertEntity({
      type: 'action_item',
      name: 'Complete migration review',
      status: 'active',
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
        mid_json: JSON.stringify({
          participants: [
            { entity_id: 'person:alex', name: 'Alex' },
            { entity_id: 'person:sam', name: 'Sam' },
            { entity_id: 'speaker:unknown', name: 'Speaker 1' },
          ],
        }),
      });
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
