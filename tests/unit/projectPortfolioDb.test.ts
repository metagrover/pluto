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
});
