import type Database from 'better-sqlite3';
import {
  type IdentityProfile,
  emptyIdentityProfile,
} from '../src/types/identity';
import type {
  IdentityBinding,
  IdentityContext,
  OwnerResolution,
} from '../src/types/identity';

export interface IdentityJob {
  meetingId: string;
  revision: number;
  fingerprint: string;
  cursor: string | null;
  state: 'pending' | 'running' | 'complete' | 'failed';
  attempts: number;
  error: string | null;
  nextAttemptAt: number;
}

export function createIdentityStore(sql: Database.Database) {
  sql.exec(`CREATE TABLE IF NOT EXISTS identity_workspace (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1), self_person_id TEXT, revision INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO identity_workspace(singleton) VALUES (1);
    CREATE TABLE IF NOT EXISTS identity_profiles (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS identity_person_aliases (
      person_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE, aliases_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS identity_captures (
      meeting_id TEXT PRIMARY KEY, origin TEXT NOT NULL, self_person_id TEXT);
    CREATE TABLE IF NOT EXISTS identity_bindings (
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      speaker TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(meeting_id, speaker));
    CREATE TABLE IF NOT EXISTS identity_resolutions (
      action_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS identity_resolution_history (
      action_id TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY(action_id, fingerprint));
    CREATE TABLE IF NOT EXISTS identity_jobs (
      meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, fingerprint TEXT NOT NULL, cursor TEXT,
      state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT, next_attempt_at INTEGER NOT NULL DEFAULT 0);
    UPDATE identity_jobs SET state = 'pending' WHERE state = 'running';`);
  // Old provisional caches did not retain source scope. They are derived data,
  // so invalidate them instead of retaining quotes that cannot be deleted by source.
  sql.transaction(() => {
    for (const table of [
      'identity_resolutions',
      'identity_resolution_history',
    ]) {
      const columns = sql.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
      }[];
      if (!columns.some((column) => column.name === 'meeting_id')) {
        sql.exec(`ALTER TABLE ${table} ADD COLUMN meeting_id TEXT;`);
      }
      sql.exec(`DELETE FROM ${table} WHERE meeting_id IS NULL OR NOT EXISTS (SELECT 1 FROM meetings m WHERE m.id = ${table}.meeting_id);
        CREATE INDEX IF NOT EXISTS idx_${table}_meeting ON ${table}(meeting_id);`);
    }
  })();
  const getRevision = () =>
    (
      sql
        .prepare('SELECT revision FROM identity_workspace WHERE singleton = 1')
        .get() as { revision: number }
    ).revision;
  const bump = () => {
    sql
      .prepare(
        'UPDATE identity_workspace SET revision = revision + 1 WHERE singleton = 1',
      )
      .run();
  };
  const validatePerson = (id: string | null) => {
    if (
      id !== null &&
      (typeof id !== 'string' ||
        !sql
          .prepare("SELECT 1 FROM entities WHERE id = ? AND type = 'person'")
          .get(id))
    )
      throw new Error('identity_person_invalid');
  };
  const getSelfPersonId = (): string | null => {
    const row = sql
      .prepare(
        "SELECT e.id FROM identity_workspace w JOIN entities e ON e.id = w.self_person_id AND e.type = 'person' WHERE singleton = 1",
      )
      .get() as { id: string } | undefined;
    return row?.id ?? null;
  };
  const validateMeeting = (meetingId: string) => {
    if (!sql.prepare('SELECT 1 FROM meetings WHERE id = ?').get(meetingId))
      throw new Error('identity_meeting_invalid');
  };
  const storedProfile = (): IdentityProfile => {
    const row = sql
      .prepare('SELECT payload FROM identity_profiles WHERE singleton = 1')
      .get() as { payload: string } | undefined;
    return row
      ? (JSON.parse(row.payload) as IdentityProfile)
      : emptyIdentityProfile();
  };
  const getPersonAliases = (personId: string): string[] => {
    const row = sql
      .prepare(
        'SELECT aliases_json FROM identity_person_aliases WHERE person_id = ?',
      )
      .get(personId) as { aliases_json: string } | undefined;
    return row ? (JSON.parse(row.aliases_json) as string[]) : [];
  };
  const writeProfile = (profile: IdentityProfile) =>
    sql
      .prepare(
        'INSERT INTO identity_profiles(singleton, payload) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET payload = excluded.payload',
      )
      .run(JSON.stringify(profile));
  const getProfile = (): IdentityProfile => {
    const profile = storedProfile();
    const self = getSelfPersonId();
    if (!self)
      return profile.preferredName
        ? { ...profile, preferredName: '', aliases: [] }
        : profile;
    const person = sql
      .prepare('SELECT name FROM entities WHERE id = ?')
      .get(self) as { name: string };
    return {
      ...profile,
      preferredName: person.name,
      aliases: getPersonAliases(self),
    };
  };
  const enqueue = (meetingId: string, fingerprint: string) => {
    validateMeeting(meetingId);
    if (!fingerprint || fingerprint.length > 512)
      throw new Error('identity_fingerprint_invalid');
    sql
      .prepare(`INSERT INTO identity_jobs(meeting_id, revision, fingerprint, state) VALUES (?, 1, ?, 'pending')
      ON CONFLICT(meeting_id) DO UPDATE SET revision = revision + 1, fingerprint = excluded.fingerprint,
      cursor = NULL, state = 'pending', attempts = 0, error = NULL, next_attempt_at = 0
      WHERE identity_jobs.fingerprint != excluded.fingerprint`)
      .run(meetingId, fingerprint);
  };
  const getStatus = (meetingId: string): IdentityJob | null =>
    (sql
      .prepare(`SELECT meeting_id AS meetingId, revision, fingerprint, cursor, state, attempts, error, next_attempt_at AS nextAttemptAt
      FROM identity_jobs WHERE meeting_id = ?`)
      .get(meetingId) as IdentityJob | undefined) ?? null;
  return {
    getRevision,
    getSelfPersonId,
    getProfile,
    getPersonAliases,
    saveProfile: (profile: IdentityProfile) =>
      sql.transaction(() => {
        const self = getSelfPersonId();
        const changed =
          JSON.stringify(storedProfile()) !== JSON.stringify(profile) ||
          (self &&
            JSON.stringify(getPersonAliases(self)) !==
              JSON.stringify(profile.aliases));
        if (!changed) return;
        if (self)
          sql
            .prepare(
              'INSERT INTO identity_person_aliases(person_id, aliases_json) VALUES (?, ?) ON CONFLICT(person_id) DO UPDATE SET aliases_json = excluded.aliases_json',
            )
            .run(self, JSON.stringify(profile.aliases));
        writeProfile(profile);
        bump();
      })(),
    setSelfPersonId: (id: string | null) =>
      sql.transaction(() => {
        validatePerson(id);
        const previous = sql
          .prepare(
            'SELECT self_person_id FROM identity_workspace WHERE singleton = 1',
          )
          .get() as { self_person_id: string | null };
        const currentProfile = storedProfile();
        const person = id
          ? (sql.prepare('SELECT name FROM entities WHERE id = ?').get(id) as {
              name: string;
            })
          : null;
        const nextProfile = {
          ...currentProfile,
          preferredName: person?.name ?? '',
          aliases: id ? getPersonAliases(id) : [],
        };
        if (
          previous.self_person_id === id &&
          JSON.stringify(currentProfile) === JSON.stringify(nextProfile)
        )
          return;
        if (id === null && previous.self_person_id)
          sql
            .prepare('DELETE FROM identity_person_aliases WHERE person_id = ?')
            .run(previous.self_person_id);
        sql
          .prepare(
            'UPDATE identity_workspace SET self_person_id = ? WHERE singleton = 1',
          )
          .run(id);
        writeProfile(nextProfile);
        bump();
      })(),
    recordCapture: (
      meetingId: string,
      origin: IdentityContext['capture']['origin'],
      frozenSelfPersonId: string | null = getSelfPersonId(),
    ) => {
      if (
        !meetingId.trim() ||
        !['local', 'imported', 'unknown'].includes(origin)
      )
        throw new Error('identity_capture_invalid');
      if (origin === 'local') validatePerson(frozenSelfPersonId);
      sql
        .prepare(
          'INSERT OR IGNORE INTO identity_captures(meeting_id, origin, self_person_id) VALUES (?, ?, ?)',
        )
        .run(meetingId, origin, origin === 'local' ? frozenSelfPersonId : null);
    },
    getCapture: (meetingId: string): IdentityContext['capture'] => {
      const row = sql
        .prepare(
          'SELECT origin, self_person_id FROM identity_captures WHERE meeting_id = ?',
        )
        .get(meetingId) as
        | {
            origin: IdentityContext['capture']['origin'];
            self_person_id: string | null;
          }
        | undefined;
      return row
        ? { origin: row.origin, selfPersonId: row.self_person_id }
        : { origin: 'unknown', selfPersonId: null };
    },
    getBindings: (meetingId: string): IdentityBinding[] =>
      (
        sql
          .prepare(
            'SELECT payload FROM identity_bindings WHERE meeting_id = ? ORDER BY speaker',
          )
          .all(meetingId) as { payload: string }[]
      ).map((row) => JSON.parse(row.payload) as IdentityBinding),
    setBinding: (
      meetingId: string,
      binding: IdentityBinding,
      expectedRevision?: number,
    ) =>
      sql.transaction(() => {
        validateMeeting(meetingId);
        validatePerson(binding.personId);
        if (
          expectedRevision !== undefined &&
          expectedRevision !== getRevision()
        )
          throw new Error('identity_revision_stale');
        if (
          !binding.speaker?.trim() ||
          binding.speaker.length > 256 ||
          binding.individual !== true ||
          binding.source !== 'user' ||
          typeof binding.sourceRevision !== 'string' ||
          !Array.isArray(binding.evidence)
        )
          throw new Error('identity_binding_invalid');
        sql
          .prepare(
            'INSERT INTO identity_bindings(meeting_id, speaker, payload) VALUES (?, ?, ?) ON CONFLICT(meeting_id, speaker) DO UPDATE SET payload = excluded.payload',
          )
          .run(meetingId, binding.speaker, JSON.stringify(binding));
        bump();
        enqueue(meetingId, `identity:${getRevision()}`);
      })(),
    clearBinding: (
      meetingId: string,
      speaker: string,
      expectedRevision?: number,
    ) =>
      sql.transaction(() => {
        validateMeeting(meetingId);
        if (
          expectedRevision !== undefined &&
          expectedRevision !== getRevision()
        )
          throw new Error('identity_revision_stale');
        if (
          !sql
            .prepare(
              'DELETE FROM identity_bindings WHERE meeting_id = ? AND speaker = ?',
            )
            .run(meetingId, speaker).changes
        )
          return;
        bump();
        enqueue(meetingId, `identity:${getRevision()}`);
      })(),
    getResolution: (
      actionId: string,
      fingerprint: string,
    ): OwnerResolution | null => {
      const row = sql
        .prepare(
          'SELECT payload FROM identity_resolution_history WHERE action_id = ? AND fingerprint = ?',
        )
        .get(actionId, fingerprint) as { payload: string } | undefined;
      return row ? (JSON.parse(row.payload) as OwnerResolution) : null;
    },
    saveResolution: (
      actionId: string,
      fingerprint: string,
      resolution: OwnerResolution,
      meetingId: string,
    ) => {
      // A source-less user action has no transcript evidence to cache.
      if (!sql.prepare('SELECT 1 FROM meetings WHERE id = ?').get(meetingId))
        return;
      sql
        .prepare(
          'INSERT OR IGNORE INTO identity_resolution_history(action_id, fingerprint, payload, meeting_id) VALUES (?, ?, ?, ?)',
        )
        .run(actionId, fingerprint, JSON.stringify(resolution), meetingId);
    },
    enqueue,
    getStatus,
    nextJob: (now = Date.now()): IdentityJob | null =>
      sql.transaction(() => {
        const row = sql
          .prepare(
            "SELECT meeting_id FROM identity_jobs WHERE state = 'pending' AND attempts < 3 AND next_attempt_at <= ? ORDER BY next_attempt_at, meeting_id LIMIT 1",
          )
          .get(now) as { meeting_id: string } | undefined;
        if (!row) return null;
        sql
          .prepare(
            "UPDATE identity_jobs SET state = 'running' WHERE meeting_id = ?",
          )
          .run(row.meeting_id);
        return getStatus(row.meeting_id);
      })(),
    checkpointJob: (
      job: IdentityJob,
      cursor: string | null,
      complete: boolean,
    ): boolean =>
      sql
        .prepare(
          "UPDATE identity_jobs SET cursor = ?, state = ?, error = NULL, next_attempt_at = 0 WHERE meeting_id = ? AND revision = ? AND state = 'running'",
        )
        .run(
          cursor,
          complete ? 'complete' : 'pending',
          job.meetingId,
          job.revision,
        ).changes > 0,
    failJob: (job: IdentityJob, error: string, now = Date.now()): boolean =>
      sql
        .prepare(
          "UPDATE identity_jobs SET attempts = attempts + 1, state = CASE WHEN attempts >= 2 THEN 'failed' ELSE 'pending' END, error = ?, next_attempt_at = ? WHERE meeting_id = ? AND revision = ? AND state = 'running'",
        )
        .run(
          error.slice(0, 500),
          now + 5000 * 2 ** job.attempts,
          job.meetingId,
          job.revision,
        ).changes > 0,
    retryJob: (meetingId: string) => {
      validateMeeting(meetingId);
      sql
        .prepare(
          "UPDATE identity_jobs SET revision = revision + 1, state = 'pending', attempts = 0, error = NULL, next_attempt_at = 0 WHERE meeting_id = ? AND state != 'complete'",
        )
        .run(meetingId);
    },
  };
}

export type IdentityStore = ReturnType<typeof createIdentityStore>;
