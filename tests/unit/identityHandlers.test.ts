import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const directory = vi.hoisted(() => {
  const filesystem = require('node:fs') as typeof import('node:fs');
  return filesystem.mkdtempSync('/tmp/pluto-identity-handlers-');
});
vi.mock('electron', () => ({ app: { getPath: () => directory } }));
import * as db from '../../electron/db';
import {
  IDENTITY_CHANNELS,
  handleIdentityRequest,
} from '../../electron/identityHandlers';

afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
let fixture = 0;
let meetingId: string;
let personId: string;
beforeEach(() => {
  vi.restoreAllMocks();
  for (
    let job = db.identityStore.nextJob();
    job;
    job = db.identityStore.nextJob()
  )
    db.identityStore.checkpointJob(job, null, true);
  fixture++;
  meetingId = `identity-handler-meeting-${fixture}`;
  personId = `identity-handler-person-${fixture}`;
  db.saveMeeting({
    id: meetingId,
    title: 'Source',
    transcript_json: JSON.stringify([
      { speaker: 'Me', text: 'I will send it.' },
      { speaker: 'Them', text: 'Thank you.' },
    ]),
  });
  db.upsertEntity({
    id: personId,
    type: 'person',
    name: 'Robin',
    dedupe_by_name: false,
  });
  db.identityStore.setSelfPersonId(null);
});
const revision = () => db.identityStore.getRevision();

describe('identity IPC service', () => {
  it('exposes only the eight supported channels', () => {
    expect(IDENTITY_CHANNELS).toEqual([
      'GET_IDENTITY_STATE',
      'SET_SELF_IDENTITY',
      'GET_MEETING_IDENTITY',
      'SET_MEETING_IDENTITY_BINDING',
      'CLEAR_MEETING_IDENTITY_BINDING',
      'RETRY_IDENTITY_RECONCILIATION',
      'SAVE_IDENTITY_PROFILE',
      'DISMISS_IDENTITY_PROFILE',
    ]);
  });
  it('returns global identity state with display-only person records', () => {
    const state = handleIdentityRequest('GET_IDENTITY_STATE', {});
    expect(state).toMatchObject({
      selfPersonId: null,
      revision: revision(),
      people: expect.arrayContaining([{ id: personId, name: 'Robin' }]),
    });
    expect(Object.keys(state)).toEqual([
      'selfPersonId',
      'people',
      'revision',
      'profile',
    ]);
  });
  it('filters out generic speaker placeholders from global identity state people', () => {
    const rawDb = new Database(path.join(directory, 'pluto.db'));
    try {
      rawDb
        .prepare(
          "INSERT INTO entities (id, type, name, normalized_name, created_at, updated_at) VALUES ('legacy-rs-99', 'person', 'Remote Speaker 99', 'remote speaker 99', datetime('now'), datetime('now'))",
        )
        .run();
      rawDb
        .prepare(
          "INSERT INTO entities (id, type, name, normalized_name, created_at, updated_at) VALUES ('legacy-spk-5', 'person', 'Speaker 5', 'speaker 5', datetime('now'), datetime('now'))",
        )
        .run();
    } finally {
      rawDb.close();
    }
    const state = handleIdentityRequest('GET_IDENTITY_STATE', {});
    expect(
      state.people.some((p: { name: string }) => p.name === 'Remote Speaker 99'),
    ).toBe(false);
    expect(
      state.people.some((p: { name: string }) => p.name === 'Speaker 5'),
    ).toBe(false);
    expect(state.people.some((p: { name: string }) => p.name === 'Robin')).toBe(
      true,
    );
  });
  it('selects and clears self only at the expected revision', () => {
    expect(
      handleIdentityRequest('SET_SELF_IDENTITY', {
        personId,
        expectedRevision: revision(),
      }),
    ).toMatchObject({ selfPersonId: personId });
    expect(
      handleIdentityRequest('SET_SELF_IDENTITY', {
        personId: null,
        expectedRevision: revision(),
      }),
    ).toMatchObject({ selfPersonId: null });
  });
  it('creates a distinct same-name person on explicit creation', () => {
    const state = handleIdentityRequest('SET_SELF_IDENTITY', {
      newName: ' Robin ',
      expectedRevision: revision(),
    });
    expect(state.selfPersonId).not.toBe(personId);
    expect(state.people).toEqual(
      expect.arrayContaining([
        { id: personId, name: 'Robin' },
        { id: state.selfPersonId, name: 'Robin' },
      ]),
    );
  });
  it('rejects stale self creation without leaving an orphan person', () => {
    const before = db.getEntitiesByType('person');
    expect(() =>
      handleIdentityRequest('SET_SELF_IDENTITY', {
        newName: 'Uncommitted',
        expectedRevision: revision() - 1,
      }),
    ).toThrow(/revision/);
    expect(db.getEntitiesByType('person')).toEqual(before);
  });
  it('rolls back person creation when saving self fails', () => {
    const before = db.getEntitiesByType('person');
    vi.spyOn(db.identityStore, 'setSelfPersonId').mockImplementation(() => {
      throw new Error('disk failed');
    });
    expect(() =>
      handleIdentityRequest('SET_SELF_IDENTITY', {
        newName: 'Uncommitted',
        expectedRevision: revision(),
      }),
    ).toThrow('disk failed');
    expect(db.getEntitiesByType('person')).toEqual(before);
  });
  it('returns meeting-local speakers, bindings, capture and truthful job state', () => {
    expect(
      handleIdentityRequest('GET_MEETING_IDENTITY', { meetingId }),
    ).toMatchObject({
      meetingId,
      speakers: ['Me', 'Them'],
      bindings: [],
      capture: { origin: 'unknown', selfPersonId: null },
      job: null,
    });
  });
  it('saves an explicit individual speaker correction and atomically queues its meeting', () => {
    const state = handleIdentityRequest('SET_MEETING_IDENTITY_BINDING', {
      meetingId,
      speaker: 'Them',
      personId,
      individual: true,
      expectedRevision: revision(),
    });
    expect(state).toMatchObject({
      meetingId,
      bindings: [
        expect.objectContaining({
          speaker: 'Them',
          personId,
          individual: true,
          source: 'user',
        }),
      ],
      job: { state: 'pending' },
    });
    expect(
      db.identityStore.getBindings(meetingId)[0].sourceRevision,
    ).toHaveLength(64);
  });
  it('reports affected people after commit and ignores refresh failures', () => {
    const onBindingChange = vi.fn(() => {
      throw new Error('refresh unavailable');
    });
    const state = handleIdentityRequest(
      'SET_MEETING_IDENTITY_BINDING',
      {
        meetingId,
        speaker: 'Them',
        personId,
        individual: true,
        expectedRevision: revision(),
      },
      { onBindingChange },
    );

    expect(onBindingChange).toHaveBeenCalledWith({
      meetingId,
      personIds: [personId],
    });
    expect(state).toMatchObject({
      bindings: [expect.objectContaining({ personId })],
    });
  });
  it('allows a corrected individual speaker without a real-world person and can clear it', () => {
    handleIdentityRequest('SET_MEETING_IDENTITY_BINDING', {
      meetingId,
      speaker: 'Them',
      personId: null,
      individual: true,
      expectedRevision: revision(),
    });
    expect(db.identityStore.getBindings(meetingId)[0].personId).toBeNull();
    expect(
      handleIdentityRequest('CLEAR_MEETING_IDENTITY_BINDING', {
        meetingId,
        speaker: 'Them',
        expectedRevision: revision(),
      }),
    ).toMatchObject({ bindings: [], job: { state: 'pending' } });
  });
  it('creates a distinct person and correction together', () => {
    const state = handleIdentityRequest('SET_MEETING_IDENTITY_BINDING', {
      meetingId,
      speaker: 'Them',
      newName: 'Robin',
      individual: true,
      expectedRevision: revision(),
    });
    expect(db.identityStore.getBindings(meetingId)[0].personId).not.toBe(
      personId,
    );
    expect(state).toMatchObject({ job: { state: 'pending' } });
  });
  it('rolls back person creation if correction persistence fails', () => {
    const before = db.getEntitiesByType('person');
    vi.spyOn(db.identityStore, 'setBinding').mockImplementation(() => {
      throw new Error('binding write failed');
    });
    expect(() =>
      handleIdentityRequest('SET_MEETING_IDENTITY_BINDING', {
        meetingId,
        speaker: 'Them',
        newName: 'Uncommitted',
        individual: true,
        expectedRevision: revision(),
      }),
    ).toThrow('binding write failed');
    expect(db.getEntitiesByType('person')).toEqual(before);
  });
  it.each([
    { payload: null },
    { payload: [] },
    { payload: 'bad' },
    { payload: { unexpected: true } },
  ])('rejects malformed read payload $payload', ({ payload }) => {
    expect(() => handleIdentityRequest('GET_IDENTITY_STATE', payload)).toThrow(
      /payload/,
    );
  });
  it.each([
    {},
    { personId: 'missing' },
    { personId: '' },
    { personId: ' space ' },
    { personId: null, newName: 'Robin' },
    { newName: '' },
    { newName: 'x'.repeat(257) },
    { newName: 'Remote Speaker 1' },
    { newName: 'Speaker 2' },
    { newName: 'Me' },
    { personId: null, extra: true },
    { personId: null, expectedRevision: -1 },
    { personId: null, expectedRevision: 1.5 },
    { personId: null, expectedRevision: '1' },
  ])('rejects malformed self selection %j', (payload) => {
    expect(() =>
      handleIdentityRequest('SET_SELF_IDENTITY', {
        expectedRevision: revision(),
        ...payload,
      }),
    ).toThrow(/identity/);
  });
  it('rejects non-person IDs', () => {
    db.upsertEntity({
      id: 'handler-project',
      type: 'project',
      name: 'Launch',
      dedupe_by_name: false,
    });
    expect(() =>
      handleIdentityRequest('SET_SELF_IDENTITY', {
        personId: 'handler-project',
        expectedRevision: revision(),
      }),
    ).toThrow(/person/);
  });
  it.each([
    'GET_MEETING_IDENTITY',
    'SET_MEETING_IDENTITY_BINDING',
    'CLEAR_MEETING_IDENTITY_BINDING',
    'RETRY_IDENTITY_RECONCILIATION',
  ])('rejects unknown meeting for %s', (channel) => {
    const payload =
      channel === 'SET_MEETING_IDENTITY_BINDING'
        ? {
            speaker: 'Me',
            personId,
            individual: true,
            expectedRevision: revision(),
          }
        : channel === 'CLEAR_MEETING_IDENTITY_BINDING'
          ? { speaker: 'Me', expectedRevision: revision() }
          : {};
    expect(() =>
      handleIdentityRequest(channel, {
        ...payload,
        meetingId: 'missing-meeting',
      }),
    ).toThrow(/meeting/);
  });
  it('rejects unobserved speaker labels and non-individual scope before person creation', () => {
    const before = db.getEntitiesByType('person');
    expect(() =>
      handleIdentityRequest('SET_MEETING_IDENTITY_BINDING', {
        meetingId,
        speaker: 'Absent',
        newName: 'Uncommitted',
        individual: true,
        expectedRevision: revision(),
      }),
    ).toThrow(/speaker/);
    expect(() =>
      handleIdentityRequest('SET_MEETING_IDENTITY_BINDING', {
        meetingId,
        speaker: 'Them',
        personId,
        individual: false,
        expectedRevision: revision(),
      }),
    ).toThrow(/individual/);
    expect(db.getEntitiesByType('person')).toEqual(before);
  });
  it('rejects conflicting correction updates without changing current binding', () => {
    const stale = revision();
    handleIdentityRequest('SET_MEETING_IDENTITY_BINDING', {
      meetingId,
      speaker: 'Me',
      personId,
      individual: true,
      expectedRevision: stale,
    });
    expect(() =>
      handleIdentityRequest('CLEAR_MEETING_IDENTITY_BINDING', {
        meetingId,
        speaker: 'Me',
        expectedRevision: stale,
      }),
    ).toThrow(/revision/);
    expect(db.identityStore.getBindings(meetingId)[0].personId).toBe(personId);
  });
  it('retries a failed attempt while preserving its meeting scope', () => {
    db.identityStore.enqueue(meetingId, 'retry-case');
    const job = db.identityStore.nextJob();
    expect(job?.meetingId).toBe(meetingId);
    if (!job) throw new Error('Missing fixture job');
    db.identityStore.failJob(job, 'Provider unavailable');
    expect(
      handleIdentityRequest('RETRY_IDENTITY_RECONCILIATION', { meetingId }),
    ).toMatchObject({
      job: { meetingId, state: 'pending', attempts: 0, error: null },
    });
  });
  it('does not manufacture a retry job where none exists', () => {
    expect(() =>
      handleIdentityRequest('RETRY_IDENTITY_RECONCILIATION', { meetingId }),
    ).toThrow(/retry/);
  });
  it('rejects unknown channels', () => {
    expect(() => handleIdentityRequest('UNKNOWN', {})).toThrow(/channel/);
  });
});
