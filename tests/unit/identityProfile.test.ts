import fs from 'node:fs';
import Database from 'better-sqlite3';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const directory = vi.hoisted(() => {
  const filesystem = require('node:fs') as typeof import('node:fs');
  return filesystem.mkdtempSync('/tmp/pluto-profile-');
});
vi.mock('electron', () => ({ app: { getPath: () => directory } }));
import { getMeetingIdentityContext } from '../../electron/commitmentIdentity';
import * as db from '../../electron/db';
import { handleIdentityRequest } from '../../electron/identityHandlers';
import { createIdentityStore } from '../../electron/identityStore';

afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
beforeEach(() => {
  vi.restoreAllMocks();
  db.identityStore.setSelfPersonId(null);
});
const profile = {
  preferredName: 'Morgan Lee',
  aliases: ['Morgan', 'Mo'],
  useCases: ['work', 'study'],
  role: 'Engineering',
  industry: 'Education',
};
const save = (overrides: Record<string, unknown> = {}) =>
  handleIdentityRequest('SAVE_IDENTITY_PROFILE', {
    expectedRevision: db.identityStore.getRevision(),
    ...profile,
    ...overrides,
  });

describe('workspace About you profile', () => {
  it('creates one distinct self person, normalizes aliases, and updates the same stable ID', () => {
    const existing = db.upsertEntity({
      type: 'person',
      name: profile.preferredName,
      dedupe_by_name: false,
    });
    const first = save({ aliases: [' Morgan ', 'MO', 'mo'] });
    expect(first.selfPersonId).not.toBe(existing.id);
    expect(first.profile).toMatchObject({
      ...profile,
      aliases: ['Morgan', 'MO'],
      disposition: 'completed',
    });
    const second = save({ preferredName: 'Morgan L.', aliases: ['Mo'] });
    expect(second.selfPersonId).toBe(first.selfPersonId);
    expect(db.getEntity(first.selfPersonId!)?.name).toBe('Morgan L.');
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(db.getEntity(existing.id)?.name).toBe(profile.preferredName);
  });

  it('permits context-only and unbound-name profiles without inventing people or identity evidence', () => {
    const before = db.getEntitiesByType('person').length;
    const state = save({ preferredName: '', aliases: ['Mo'] });
    expect(state.selfPersonId).toBeNull();
    expect(state.profile).toMatchObject({
      preferredName: '',
      aliases: ['Mo'],
      role: 'Engineering',
    });
    expect(db.getEntitiesByType('person')).toHaveLength(before);
    const bound = save();
    expect(db.identityStore.getPersonAliases(bound.selfPersonId!)).toEqual([
      'Morgan',
      'Mo',
    ]);
  });

  it('clears current names explicitly while preserving optional context and old capture snapshots', () => {
    const first = save();
    db.identityStore.recordCapture('profile-capture', 'local');
    const cleared = handleIdentityRequest('SET_SELF_IDENTITY', {
      personId: null,
      expectedRevision: db.identityStore.getRevision(),
    });
    expect(cleared.profile).toMatchObject({
      preferredName: '',
      aliases: [],
      useCases: ['work', 'study'],
      role: 'Engineering',
      industry: 'Education',
    });
    expect(cleared.selfPersonId).toBeNull();
    expect(db.identityStore.getCapture('profile-capture').selfPersonId).toBe(
      first.selfPersonId,
    );
    expect(db.getEntity(first.selfPersonId!)).toBeTruthy();
  });

  it('saving an empty preferred name clears a previously selected self instead of retaining hidden identity', () => {
    save();
    const state = save({ preferredName: '', aliases: [] });
    expect(state.selfPersonId).toBeNull();
    expect(state.profile.preferredName).toBe('');
  });

  it('advanced person selection switches names and aliases without overwriting another person', () => {
    const first = save();
    handleIdentityRequest('SET_SELF_IDENTITY', {
      newName: 'Drew',
      expectedRevision: db.identityStore.getRevision(),
    });
    const second = save({ preferredName: 'Drew', aliases: ['D'] });
    const switched = handleIdentityRequest('SET_SELF_IDENTITY', {
      personId: first.selfPersonId,
      expectedRevision: db.identityStore.getRevision(),
    });
    expect(switched.profile).toMatchObject({
      preferredName: 'Morgan Lee',
      aliases: ['Morgan', 'Mo'],
    });
    expect(db.identityStore.getPersonAliases(second.selfPersonId!)).toEqual([
      'D',
    ]);
  });

  it('dismisses once without erasing a saved profile and rejects stale dismissals', () => {
    const first = save();
    const dismissed = handleIdentityRequest('DISMISS_IDENTITY_PROFILE', {
      expectedRevision: first.revision,
    });
    expect(dismissed.profile).toMatchObject({
      ...profile,
      disposition: 'dismissed',
    });
    expect(() =>
      handleIdentityRequest('DISMISS_IDENTITY_PROFILE', {
        expectedRevision: first.revision,
      }),
    ).toThrow(/revision/);
    expect(save().profile.disposition).toBe('completed');
  });

  it('rejects stale saves before creating a person or changing aliases', () => {
    const first = save();
    const people = db.getEntitiesByType('person');
    expect(() => save({ expectedRevision: first.revision - 1 })).toThrow(
      /revision/,
    );
    expect(db.getEntitiesByType('person')).toEqual(people);
    expect(db.identityStore.getPersonAliases(first.selfPersonId!)).toEqual(
      profile.aliases,
    );
  });

  it('rolls back person, aliases and profile together when profile persistence fails', () => {
    const before = handleIdentityRequest('GET_IDENTITY_STATE', {});
    vi.spyOn(db.identityStore, 'saveProfile').mockImplementation(() => {
      throw new Error('disk failed');
    });
    expect(() => save()).toThrow('disk failed');
    expect(handleIdentityRequest('GET_IDENTITY_STATE', {})).toEqual(before);
  });

  it.each([
    { preferredName: 'x'.repeat(201) },
    { preferredName: 'Mo\n' },
    { aliases: ['x'.repeat(201)] },
    { aliases: Array(13).fill('Mo') },
    { aliases: [' '] },
    { aliases: ['Mo\t'] },
    { aliases: 'Mo' },
    { useCases: ['other'] },
    { useCases: null },
    { role: 'x'.repeat(161) },
    { industry: 'x'.repeat(161) },
    { role: '\nrole' },
    { industry: 'a\0b' },
    { unexpected: true },
  ])('rejects invalid bounded profile input %j atomically', (overrides) => {
    const before = handleIdentityRequest('GET_IDENTITY_STATE', {});
    expect(() => save(overrides)).toThrow(/identity/);
    expect(handleIdentityRequest('GET_IDENTITY_STATE', {})).toEqual(before);
  });

  it('exposes declared person aliases to source context but excludes profile role and industry', () => {
    const state = save();
    db.saveMeeting({
      id: 'profile-context',
      title: 'Source',
      transcript_json: JSON.stringify([
        { speaker: 'Me', text: 'I will check.' },
      ]),
    });
    const context = getMeetingIdentityContext('profile-context');
    expect(
      context.people.find((person) => person.id === state.selfPersonId),
    ).toMatchObject({ aliases: ['Morgan', 'Mo'] });
    expect(JSON.stringify(context)).not.toContain('Engineering');
    expect(JSON.stringify(context)).not.toContain('Education');
    expect(context.bindings).toEqual([]);
  });

  it('isolates profile context and aliases across two independent workspace databases', () => {
    const connections = [new Database(':memory:'), new Database(':memory:')];
    try {
      const stores = connections.map((sql) => {
        sql.exec(
          "CREATE TABLE entities(id TEXT PRIMARY KEY, type TEXT, name TEXT); CREATE TABLE meetings(id TEXT PRIMARY KEY); INSERT INTO entities VALUES ('person','person','Morgan');",
        );
        return createIdentityStore(sql);
      });
      stores[0].setSelfPersonId('person');
      stores[0].saveProfile({
        ...profile,
        useCases: ['work'],
        disposition: 'completed',
      });
      expect(stores[0].getPersonAliases('person')).toEqual(profile.aliases);
      expect(stores[1].getProfile()).toMatchObject({
        preferredName: '',
        aliases: [],
        role: '',
        disposition: 'pending',
      });
      expect(stores[1].getPersonAliases('person')).toEqual([]);
    } finally {
      connections.forEach((sql) => sql.close());
    }
  });
});
