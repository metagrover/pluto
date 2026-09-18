import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-delete-entity-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));

import * as db from '../../electron/db';

beforeEach(() => {
  db.resetKnowledge();
});

afterAll(() => {
  fs.rmSync(fixture.directory, { recursive: true, force: true });
});

describe('deleteEntity', () => {
  it('prevents deletion of the self-person entity and preserves data', () => {
    const selfPerson = db.upsertEntity({
      id: 'self-user',
      type: 'person',
      name: 'Taylor Self',
      dedupe_by_name: false,
    });
    db.identityStore.setSelfPersonId(selfPerson.id);

    expect(() => db.deleteEntity(selfPerson.id)).toThrow(
      'cannot_delete_self_person',
    );
    expect(db.getEntity(selfPerson.id)).not.toBeUndefined();
    expect(db.identityStore.getSelfPersonId()).toBe(selfPerson.id);
  });

  it('deletes person entity, unlinks speaker bindings, and cascades voice/alias cleanup', () => {
    const person = db.upsertEntity({
      id: 'colleague-1',
      type: 'person',
      name: 'Morgan Colleague',
      dedupe_by_name: false,
    });

    db.saveMeeting({
      id: 'meeting-1',
      title: 'Sprint Planning',
      started_at: '2026-08-01T10:00:00.000Z',
    });

    db.saveMeeting({
      id: 'meeting-2',
      title: 'Design Review',
      started_at: '2026-08-02T10:00:00.000Z',
    });

    // Bind Morgan to speaker S1 in meeting-1
    db.identityStore.setBinding('meeting-1', {
      speaker: 'S1',
      personId: person.id,
      individual: true,
      source: 'user',
      sourceRevision: 'v1',
      evidence: [],
    });

    // Insert voice profile settings and enrollment
    db.db
      .prepare(
        'INSERT INTO speaker_voice_profile_settings (person_id, is_active, updated_at) VALUES (?, 1, CURRENT_TIMESTAMP)',
      )
      .run(person.id);

    db.db
      .prepare(`
        INSERT INTO speaker_voice_enrollments (
          id, person_id, source_meeting_id, source_revision, speaker,
          embedding_json, chunk_count, clean_duration_sec, minimum_chunk_similarity,
          mean_chunk_similarity, reference_start_sec, reference_end_sec,
          reference_excerpt, provenance_json, candidate_digest, created_at
        ) VALUES (
          'enroll-1', ?, 'meeting-1', 'v1', 'S1',
          '[]', 1, 10.0, 0.9,
          0.9, 0.0, 10.0,
          'Hello Morgan', '{}', 'digest-1', CURRENT_TIMESTAMP
        )
      `)
      .run(person.id);

    expect(
      (
        db.db
          .prepare(
            'SELECT count(*) as count FROM speaker_voice_profile_settings WHERE person_id = ?',
          )
          .get(person.id) as { count: number }
      ).count,
    ).toBe(1);
    expect(
      (
        db.db
          .prepare(
            'SELECT count(*) as count FROM speaker_voice_enrollments WHERE person_id = ?',
          )
          .get(person.id) as { count: number }
      ).count,
    ).toBe(1);

    // Delete person
    const result = db.deleteEntity(person.id);

    // Should return affected meeting IDs where bindings were unlinked
    expect(result.affectedMeetingIds).toContain('meeting-1');

    // Person entity is deleted
    expect(db.getEntity(person.id)).toBeUndefined();

    // Speaker binding in meeting-1 is unlinked
    const bindings = db.identityStore.getBindings('meeting-1');
    expect(bindings.S1).toBeUndefined();

    // Voice profile settings & enrollment are cleaned up
    expect(
      (
        db.db
          .prepare(
            'SELECT count(*) as count FROM speaker_voice_profile_settings WHERE person_id = ?',
          )
          .get(person.id) as { count: number }
      ).count,
    ).toBe(0);
    expect(
      (
        db.db
          .prepare(
            'SELECT count(*) as count FROM speaker_voice_enrollments WHERE person_id = ?',
          )
          .get(person.id) as { count: number }
      ).count,
    ).toBe(0);
  });

  it('deletes project entity, cascades links, and untethers child projects', () => {
    const parent = db.upsertEntity({
      id: 'proj-parent',
      type: 'project',
      name: 'Core Platform',
      dedupe_by_name: false,
    });

    const child = db.upsertEntity({
      id: 'proj-child',
      type: 'project',
      name: 'Auth Subsystem',
      metadata: {
        qualification: {
          parentProjectId: parent.id,
          focusAreas: ['security'],
        },
      },
      dedupe_by_name: false,
    });

    const childMeta = JSON.parse(
      (db.getEntity(child.id)?.metadata as string) || '{}',
    );
    expect(childMeta?.qualification?.parentProjectId).toBe(parent.id);

    // Delete parent project
    const result = db.deleteEntity(parent.id);
    expect(result.affectedMeetingIds).toEqual([]);

    // Parent is gone
    expect(db.getEntity(parent.id)).toBeUndefined();

    // Child is untethered: parentProjectId is stripped from metadata
    const refreshedChild = db.getEntity(child.id);
    expect(refreshedChild).not.toBeUndefined();
    const refreshedMeta = JSON.parse(
      (refreshedChild?.metadata as string) || '{}',
    );
    expect(refreshedMeta?.qualification?.parentProjectId).toBeUndefined();
    expect(refreshedMeta?.qualification?.focusAreas).toEqual(['security']);
  });
});
