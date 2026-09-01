import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-person-role-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import * as db from '../../electron/db';
import { processExtractedEntities } from '../../electron/entityPipeline';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

beforeEach(() => {
  db.resetKnowledge();
  db.calendarStore.disconnect();
  db.saveMeeting({
    id: 'role-source',
    title: 'Role source',
    started_at: '2026-08-01T12:00:00.000Z',
    duration_seconds: 1_800,
  });
});

describe('person role evidence boundary', () => {
  it('persists a role only when an exact quote links it to the named person', async () => {
    const transcript = 'Avery Lane is the design lead for this launch.';

    await processExtractedEntities(
      {
        people: [
          {
            name: 'Avery Lane',
            role: 'design lead',
            role_evidence: 'Avery Lane is the design lead for this launch.',
          },
        ],
        topics: [],
        action_items: [],
        decisions: [],
      },
      'role-source',
      undefined,
      transcript,
    );

    const person = db.findEntity('person', 'Avery Lane');
    expect(JSON.parse(person?.metadata || '{}')).toMatchObject({
      role: 'design lead',
    });
    expect(db.getMeetingEntities('role-source')).toContainEqual(
      expect.objectContaining({
        id: person?.id,
        context: 'Role: design lead',
      }),
    );
  });

  it('rejects another person name even when the quote contains both names', async () => {
    db.upsertEntity({ type: 'person', name: 'Jordan Vale' });
    const transcript = 'Avery Lane met Jordan Vale after the review.';

    await processExtractedEntities(
      {
        people: [
          {
            name: 'Avery Lane',
            role: 'Jordan Vale',
            role_evidence: 'Avery Lane met Jordan Vale after the review.',
          },
        ],
        topics: [],
        action_items: [],
        decisions: [],
      },
      'role-source',
      undefined,
      transcript,
    );

    const person = db.findEntity('person', 'Avery Lane');
    expect(JSON.parse(person?.metadata || '{}')).not.toHaveProperty('role');
    expect(db.getMeetingEntities('role-source')).toContainEqual(
      expect.objectContaining({ id: person?.id, context: null }),
    );
  });

  it('keeps the person but omits a role without exact evidence', async () => {
    const transcript = 'Avery Lane joined the review.';

    await processExtractedEntities(
      {
        people: [{ name: 'Avery Lane', role: 'design lead' }],
        topics: [],
        action_items: [],
        decisions: [],
      },
      'role-source',
      undefined,
      transcript,
    );

    const person = db.findEntity('person', 'Avery Lane');
    expect(person).toBeDefined();
    expect(JSON.parse(person?.metadata || '{}')).not.toHaveProperty('role');
  });

  it('rejects a fabricated evidence quote that is absent from the transcript', async () => {
    const transcript = 'Avery Lane joined the review.';

    await processExtractedEntities(
      {
        people: [
          {
            name: 'Avery Lane',
            role: 'design lead',
            role_evidence: 'Avery Lane is the design lead.',
          },
        ],
        topics: [],
        action_items: [],
        decisions: [],
      },
      'role-source',
      undefined,
      transcript,
    );

    const person = db.findEntity('person', 'Avery Lane');
    expect(JSON.parse(person?.metadata || '{}')).not.toHaveProperty('role');
  });
});
