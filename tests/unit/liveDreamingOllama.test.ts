import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-live-dreaming-test-${Date.now()}`,
}));

vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));

import * as db from '../../electron/db';
import { packageEntityNotes } from '../../electron/dreaming/packageEntityNotes';
import { buildDreamingGenerationRequest } from '../../electron/dreaming/prompt';
import { validateDreamingOutput } from '../../electron/dreaming/validateDreamingOutput';

describe('Dreaming production request integration', () => {
  afterAll(() => {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });

  it('uses the production Gemma request and validates without canonical mutation', async () => {
    const project = db.upsertEntity({
      type: 'project',
      name: 'Unified Search Engine',
    });
    const m1Id = 'meeting-search-1';
    db.saveMeeting({
      id: m1Id,
      title: 'Search Architecture Kickoff',
      folder: 'Engineering',
      date: '2026-08-20',
      duration: 2400,
      enhanced_notes:
        'Discussed building unified search combining vector search with SQLite FTS5.',
    });
    db.addMeetingEntity({
      meeting_id: m1Id,
      entity_id: project.id,
      context: 'Discussed unified search architecture',
    });
    const m2Id = 'meeting-search-2';
    db.saveMeeting({
      id: m2Id,
      title: 'Search Progress Sync',
      folder: 'Engineering',
      date: '2026-08-28',
      duration: 1800,
      enhanced_notes:
        'SQLite-Vec Indexing Complete and integrated into the nightly build.',
    });
    db.addMeetingEntity({
      meeting_id: m2Id,
      entity_id: project.id,
      context: 'Completed indexing milestone',
    });

    const pkg = packageEntityNotes(project.id);
    expect(pkg).not.toBeNull();
    const request = buildDreamingGenerationRequest(pkg!);
    expect(request.model).toBe('gemma4:12b');
    const modelResponseJson = JSON.stringify({
      status: 'proposed',
      proposals: [
        {
          kind: 'project_milestone',
          payload: {
            name: 'SQLite-Vec Indexing Complete',
            status: 'completed',
          },
          evidence: [
            {
              meetingId: m2Id,
              excerpt:
                'SQLite-Vec Indexing Complete and integrated into the nightly build.',
            },
          ],
        },
      ],
    });

    expect(validateDreamingOutput(modelResponseJson, pkg!)).toMatchObject({
      valid: true,
    });
    expect(JSON.parse(db.getEntity(project.id)?.metadata || '{}')).toEqual({});
    expect(db.getEntityAliasSuggestions(project.id)).toEqual([]);
  });
});
