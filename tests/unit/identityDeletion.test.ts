import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
const directory = vi.hoisted(() =>
  require('node:fs').mkdtempSync('/tmp/pluto-identity-deletion-'),
);
vi.mock('electron', () => ({ app: { getPath: () => directory } }));
import { createDatabaseRuntime } from '../../electron/database/runtime';
import * as db from '../../electron/db';
import { createIdentityStore } from '../../electron/identityStore';

const resolution = {
  status: 'unresolved' as const,
  ownerKey: null,
  personId: null,
  source: 'unresolved' as const,
  evidence: [{ turnId: 't0', quote: 'Private source quote' }],
  reason: 'No owner',
};
beforeEach(() => {
  db.resetKnowledge();
  for (const id of ['delete-source', 'keep-source'])
    db.saveMeeting({ id, title: id });
});
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

it('deletes source-scoped history even for unpublished actions, preserving another source across restart', () => {
  db.identityStore.saveResolution(
    'unpublished-action',
    'old',
    resolution,
    'delete-source',
  );
  db.identityStore.saveResolution(
    'unpublished-action',
    'new',
    resolution,
    'delete-source',
  );
  db.identityStore.saveResolution(
    'other-action',
    'keep',
    resolution,
    'keep-source',
  );
  db.identityStore.recordCapture('delete-source', 'imported');
  db.deleteMeeting('delete-source');
  expect(
    db.identityStore.getResolution('unpublished-action', 'old'),
  ).toBeNull();
  expect(
    db.identityStore.getResolution('unpublished-action', 'new'),
  ).toBeNull();
  expect(db.identityStore.getResolution('other-action', 'keep')).toEqual(
    resolution,
  );
  expect(db.identityStore.getCapture('delete-source').origin).toBe('unknown');
});

it('deletes transcript-derived meeting context with its source meeting', () => {
  db.appendMeetingContextEvent({
    meetingId: 'delete-source',
    eventKey: 'decision:segment-1:private',
    kind: 'decision',
    summary: 'Private source summary',
    evidence: [
      {
        segmentId: 'segment-1',
        timestampMs: 1_000,
        quote: 'Private source quote',
      },
    ],
    observedAtMs: 1_000,
  });
  db.saveMeetingContextSnapshot({
    schemaVersion: 1,
    meetingId: 'delete-source',
    updatedThrough: { segmentId: 'segment-1', timestampMs: 1_000 },
    summary: 'Private rolling summary',
    currentTopics: [],
    proposals: [],
    decisions: [],
    actions: [],
    openQuestions: [],
    importantFacts: [],
  });

  db.deleteMeeting('delete-source');

  expect(db.listMeetingContextEvents('delete-source')).toEqual([]);
  expect(db.listMeetingContextSnapshots('delete-source')).toEqual([]);
});

it('preserves people referenced only by self selection or a surviving speaker/capture binding', () => {
  for (const id of ['self-person', 'bound-person', 'capture-person'])
    db.upsertEntity({ id, type: 'person', name: id, dedupe_by_name: false });
  db.identityStore.setSelfPersonId('capture-person');
  db.identityStore.recordCapture('keep-source', 'local');
  db.identityStore.setSelfPersonId('self-person');
  db.identityStore.setBinding('keep-source', {
    speaker: 'S1',
    personId: 'bound-person',
    individual: true,
    source: 'user',
    sourceRevision: 'v1',
    evidence: [],
  });
  db.deleteMeeting('delete-source');
  expect(db.identityStore.getSelfPersonId()).toBe('self-person');
  expect(db.getEntity('bound-person')?.id).toBe('bound-person');
  expect(db.getEntity('capture-person')?.id).toBe('capture-person');
});

it('clears derived identity evidence and pre-meeting capture snapshots on knowledge reset', () => {
  db.identityStore.saveResolution(
    'unpublished-action',
    'old',
    resolution,
    'delete-source',
  );
  db.identityStore.recordCapture('future-recording', 'imported');
  db.appendMeetingContextEvent({
    meetingId: 'delete-source',
    eventKey: 'fact:segment-1:private',
    kind: 'important_fact',
    summary: 'Private source summary',
    evidence: [{ segmentId: 'segment-1', timestampMs: 1_000 }],
    observedAtMs: 1_000,
  });
  db.resetKnowledge();
  expect(
    db.identityStore.getResolution('unpublished-action', 'old'),
  ).toBeNull();
  expect(db.identityStore.getCapture('future-recording').origin).toBe(
    'unknown',
  );
  expect(db.identityStore.getSelfPersonId()).toBeNull();
  expect(db.listMeetingContextEvents('delete-source')).toEqual([]);
});

it.each([false, true])(
  'preserves pre-Drizzle identity history, including an interrupted legacy shape: %s',
  (interrupted) => {
    const databasePath = path.join(directory, `legacy-${interrupted}.db`);
    const legacy = new Database(databasePath);
    try {
      legacy.exec(`CREATE TABLE entities(id TEXT PRIMARY KEY,type TEXT,name TEXT); CREATE TABLE meetings(id TEXT PRIMARY KEY, title TEXT);
      CREATE TABLE identity_resolution_history(action_id TEXT, fingerprint TEXT, payload TEXT, PRIMARY KEY(action_id,fingerprint));`);
      legacy
        .prepare('INSERT INTO identity_resolution_history VALUES(?,?,?)')
        .run('old', 'fp', JSON.stringify(resolution));
      if (interrupted)
        legacy.exec(
          'ALTER TABLE identity_resolution_history ADD COLUMN meeting_id TEXT',
        );
      legacy.close();
      const runtime = createDatabaseRuntime({
        databasePath,
        migrationsFolder: path.join(process.cwd(), 'drizzle'),
      });
      const sql = runtime.initialize();
      const store = createIdentityStore(sql);
      expect(store.getResolution('old', 'fp')).toEqual(resolution);
      sql.exec(
        "INSERT INTO meetings (id, title) VALUES ('persisted-source', 'Source')",
      );
      store.saveResolution('scoped', 'fp', resolution, 'persisted-source');
      expect(createIdentityStore(sql).getResolution('scoped', 'fp')).toEqual(
        resolution,
      );
      runtime.close();
    } finally {
      if (legacy.open) legacy.close();
    }
  },
);
