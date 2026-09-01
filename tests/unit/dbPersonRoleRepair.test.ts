import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-person-role-repair-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import * as db from '../../electron/db';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

beforeEach(() => {
  db.resetKnowledge();
  db.calendarStore.disconnect();
  db.saveMeeting({
    id: 'repair-source',
    title: 'Repair source',
    started_at: '2026-08-01T12:00:00.000Z',
    duration_seconds: 1_800,
  });
});

describe('extraction-authored person role repair', () => {
  it('removes a person-name role and its matching extraction context', () => {
    db.upsertEntity({ type: 'person', name: 'Jordan Vale' });
    const person = db.upsertEntity({
      type: 'person',
      name: 'Avery Lane',
      metadata: { role: 'Jordan Vale', team: 'Launch' },
    });
    db.addMeetingEntity({
      meeting_id: 'repair-source',
      entity_id: person.id,
      context: 'Role: Jordan Vale',
    });
    const revisionBeforeRepair = db.getIdentityInputRevision();

    expect(db.repairExtractionAuthoredPersonRoles()).toBe(1);
    expect(db.getIdentityInputRevision()).toBeGreaterThan(revisionBeforeRepair);
    expect(JSON.parse(db.getEntity(person.id)?.metadata || '{}')).toEqual({
      team: 'Launch',
    });
    expect(db.getMeetingEntities('repair-source')).toContainEqual(
      expect.objectContaining({ id: person.id, context: null }),
    );
  });

  it('preserves matching names without extraction provenance', () => {
    db.upsertEntity({ type: 'person', name: 'Jordan Vale' });
    const person = db.upsertEntity({
      type: 'person',
      name: 'Avery Lane',
      metadata: { role: 'Jordan Vale' },
    });
    db.addMeetingEntity({
      meeting_id: 'repair-source',
      entity_id: person.id,
      context: 'Discussed the launch sequence.',
    });

    expect(db.repairExtractionAuthoredPersonRoles()).toBe(0);
    expect(JSON.parse(db.getEntity(person.id)?.metadata || '{}')).toEqual({
      role: 'Jordan Vale',
    });
  });

  it('preserves extraction roles that do not match another known person', () => {
    const person = db.upsertEntity({
      type: 'person',
      name: 'Avery Lane',
      metadata: { role: 'Design lead' },
    });
    db.addMeetingEntity({
      meeting_id: 'repair-source',
      entity_id: person.id,
      context: 'Role: Design lead',
    });

    expect(db.repairExtractionAuthoredPersonRoles()).toBe(0);
    expect(JSON.parse(db.getEntity(person.id)?.metadata || '{}')).toEqual({
      role: 'Design lead',
    });
  });
});
