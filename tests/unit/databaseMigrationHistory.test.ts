import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';
import {
  DatabaseLifecycleError,
  describeDatabaseStartupError,
} from '../../electron/database/errors';
import {
  assertSupportedMigrationHistory,
  getPendingMigrationId,
  readAppliedMigrationHistory,
  readPackagedMigrationHistory,
  reconcileWorkspaceChatMigrationFork,
} from '../../electron/database/migrationHistory';

const packaged = [
  { tag: '0000_pluto_baseline', when: 100, hash: 'hash-0' },
  { tag: '0001_example', when: 200, hash: 'hash-1' },
];

describe('database migration history', () => {
  it('keeps established migration hashes, order, and timestamps immutable', () => {
    const established = JSON.parse(
      fs.readFileSync(
        path.join(
          process.cwd(),
          'tests/fixtures/databaseMigrationHistory.json',
        ),
        'utf8',
      ),
    );
    const current = readPackagedMigrationHistory(
      path.join(process.cwd(), 'drizzle'),
    );
    expect(current.slice(0, established.length)).toEqual(established);
  });

  it('accepts blank and exact packaged prefixes', () => {
    expect(() => assertSupportedMigrationHistory([], packaged)).not.toThrow();
    expect(() =>
      assertSupportedMigrationHistory(
        [{ createdAt: 100, hash: 'hash-0' }],
        packaged,
      ),
    ).not.toThrow();
    expect(getPendingMigrationId([], packaged)).toBe('0000_pluto_baseline');
    expect(
      getPendingMigrationId(
        [
          { createdAt: 100, hash: 'hash-0' },
          { createdAt: 200, hash: 'hash-1' },
        ],
        packaged,
      ),
    ).toBeNull();
  });

  it('rejects divergent, skipped, and future histories', () => {
    for (const applied of [
      [{ createdAt: 100, hash: 'different' }],
      [{ createdAt: 200, hash: 'hash-1' }],
      [
        { createdAt: 100, hash: 'hash-0' },
        { createdAt: 200, hash: 'hash-1' },
        { createdAt: 300, hash: 'future' },
      ],
    ]) {
      expect(() =>
        assertSupportedMigrationHistory(applied, packaged),
      ).toThrowError(
        expect.objectContaining({ code: 'database_version_unsupported' }),
      );
    }
  });

  it('explains when the database is ahead of an otherwise matching build', () => {
    const applied = [
      { createdAt: 100, hash: 'hash-0' },
      { createdAt: 200, hash: 'hash-1' },
      { createdAt: 300, hash: 'future' },
    ];
    let failure: unknown;
    try {
      assertSupportedMigrationHistory(applied, packaged);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: 'database_version_unsupported',
      details: { migrationHistoryReason: 'newer_build_required' },
    });
    expect(describeDatabaseStartupError(failure)).toContain(
      'Install a Pluto build that supports this database',
    );
    expect(describeDatabaseStartupError(failure)).toContain(
      'Retrying this build will not resolve',
    );
  });

  it('does not describe a longer divergent history as a simple outdated build', () => {
    for (const first of [
      { createdAt: 100, hash: 'changed' },
      { createdAt: 99, hash: 'hash-0' },
    ]) {
      let failure: unknown;
      try {
        assertSupportedMigrationHistory(
          [
            first,
            { createdAt: 200, hash: 'hash-1' },
            { createdAt: 300, hash: 'future' },
          ],
          packaged,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        code: 'database_version_unsupported',
        details: {},
      });
      expect(describeDatabaseStartupError(failure)).toBe(
        'Database version is not supported by this Pluto build.',
      );
    }
  });

  it('reads packaged tags, timestamps, and Drizzle hashes', () => {
    const history = readPackagedMigrationHistory(
      path.join(process.cwd(), 'drizzle'),
    );
    expect(history).toHaveLength(25);
    expect(history[24]).toMatchObject({ tag: '0024_pluto_actions' });
    expect(history[0]).toMatchObject({ tag: '0000_pluto_baseline' });
    expect(history[1]).toMatchObject({ tag: '0001_voice_representatives' });
    expect(history[2]).toMatchObject({
      tag: '0002_live_meeting_context_checkpoints',
    });
    expect(history[3]).toMatchObject({
      tag: '0003_singleton_participant_identity',
    });
    expect(history[4]).toMatchObject({ tag: '0004_audio_retention' });
    expect(history[5]).toMatchObject({
      tag: '0005_audio_encryption_rollout',
    });
    expect(history[6]).toMatchObject({
      tag: '0006_voice_candidate_attempts',
    });
    expect(history[7]).toMatchObject({ tag: '0007_person_chat' });
    expect(history[8]).toMatchObject({ tag: '0008_hierarchical_context' });
    expect(history[9]).toMatchObject({
      tag: '0009_live_speaker_identity_confirmations',
    });
    expect(history[10]).toMatchObject({ tag: '0010_local_artifacts' });
    expect(history[11]).toMatchObject({
      tag: '0011_local_artifacts_docx_pages',
    });
    expect(history[12]).toMatchObject({
      tag: '0012_meeting_local_artifacts',
    });
    expect(history[13]).toMatchObject({ tag: '0013_prep_attendee_links' });
    expect(history[14]).toMatchObject({ tag: '0014_meeting_prep' });
    expect(history[15]).toMatchObject({ tag: '0015_prep_past_meetings' });
    expect(history[16]).toMatchObject({ tag: '0016_prep_briefing' });
    expect(history[17]).toMatchObject({ tag: '0017_workspace_chat' });
    expect(history[18]).toMatchObject({
      tag: '0018_calendar_recording_confirmation',
    });
    expect(history[19]).toMatchObject({ tag: '0019_commitment_reminders' });
    expect(history[20]).toMatchObject({ tag: '0020_notes' });
    expect(history[21]).toMatchObject({ tag: '0021_prep_notes' });
    expect(history[22]).toMatchObject({ tag: '0022_meeting_list_indexes' });
    expect(history[23]).toMatchObject({
      tag: '0023_meeting_header_covering_index',
    });
    for (const migration of history) {
      expect(migration.when).toEqual(expect.any(Number));
      expect(migration.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('reconciles only the exact earlier chat migration fork without losing chat data', () => {
    const migrationsFolder = path.join(process.cwd(), 'drizzle');
    const history = readPackagedMigrationHistory(migrationsFolder);
    const migrations = readMigrationFiles({ migrationsFolder });
    const sqlite = new Database(':memory:');
    try {
      sqlite.pragma('foreign_keys = ON');
      sqlite.exec(
        'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC NOT NULL)',
      );
      const insert = sqlite.prepare(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
      );
      for (const [index, migration] of history.slice(0, 13).entries()) {
        for (const statement of migrations[index].sql) sqlite.exec(statement);
        insert.run(migration.hash, migration.when);
      }
      for (const statement of migrations[17].sql) sqlite.exec(statement);
      insert.run(history[17].hash, history[17].when);
      sqlite
        .prepare('INSERT INTO workspace_chat_threads (id, title) VALUES (?, ?)')
        .run('thread-1', 'Planning');

      expect(
        reconcileWorkspaceChatMigrationFork(sqlite, migrationsFolder, history),
      ).toBe(true);
      expect(readAppliedMigrationHistory(sqlite)).toEqual(
        history
          .slice(0, 18)
          .map(({ hash, when }) => ({ hash, createdAt: when })),
      );
      expect(
        getPendingMigrationId(readAppliedMigrationHistory(sqlite), history),
      ).toBe('0018_calendar_recording_confirmation');
      expect(
        sqlite
          .prepare(
            "SELECT 1 FROM sqlite_schema WHERE name = 'meeting_calendar_pending_selection'",
          )
          .get(),
      ).toBeUndefined();
      migrate(drizzle(sqlite), { migrationsFolder });
      expect(readAppliedMigrationHistory(sqlite)).toEqual(
        history.map(({ hash, when }) => ({ hash, createdAt: when })),
      );
      expect(
        getPendingMigrationId(readAppliedMigrationHistory(sqlite), history),
      ).toBeNull();
      expect(
        sqlite
          .prepare(
            "SELECT 1 FROM sqlite_schema WHERE name = 'meeting_calendar_pending_selection'",
          )
          .get(),
      ).toBeTruthy();
      expect(
        sqlite
          .prepare('SELECT title FROM workspace_chat_threads WHERE id = ?')
          .get('thread-1'),
      ).toEqual({ title: 'Planning' });
      expect(
        sqlite
          .prepare("SELECT 1 FROM sqlite_schema WHERE name = 'meeting_prep'")
          .get(),
      ).toBeTruthy();
      expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('does not reconcile an unknown migration fork', () => {
    const migrationsFolder = path.join(process.cwd(), 'drizzle');
    const history = readPackagedMigrationHistory(migrationsFolder);
    const sqlite = new Database(':memory:');
    try {
      sqlite.exec(
        'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC NOT NULL)',
      );
      const insert = sqlite.prepare(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
      );
      for (const migration of history.slice(0, 13)) {
        insert.run(migration.hash, migration.when);
      }
      insert.run('unknown-hash', history[17].when);

      expect(
        reconcileWorkspaceChatMigrationFork(sqlite, migrationsFolder, history),
      ).toBe(false);
      expect(
        sqlite
          .prepare("SELECT 1 FROM sqlite_schema WHERE name = 'meeting_prep'")
          .get(),
      ).toBeUndefined();
      expect(readAppliedMigrationHistory(sqlite)).toHaveLength(14);
    } finally {
      sqlite.close();
    }
  });

  it('classifies unreadable packaged migration metadata', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-migrations-'));
    try {
      expect(() => readPackagedMigrationHistory(root)).toThrowError(
        expect.objectContaining({ code: 'database_migration_failed' }),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads no applied history until Drizzle has migrated the database', () => {
    const sqlite = new Database(':memory:');
    expect(readAppliedMigrationHistory(sqlite)).toEqual([]);
    sqlite.exec(
      'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)',
    );
    sqlite
      .prepare(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?), (?, ?)',
      )
      .run('hash-1', 200, 'hash-0', 100);
    expect(readAppliedMigrationHistory(sqlite)).toEqual([
      { createdAt: 100, hash: 'hash-0' },
      { createdAt: 200, hash: 'hash-1' },
    ]);
    sqlite.close();
  });

  it('classifies malformed applied migration metadata', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec('CREATE TABLE __drizzle_migrations (unexpected TEXT)');
    expect(() => readAppliedMigrationHistory(sqlite)).toThrowError(
      expect.objectContaining({ code: 'database_version_unsupported' }),
    );
    sqlite.close();
  });

  it('describes errors without leaking internal messages', () => {
    const error = new DatabaseLifecycleError(
      'database_migration_failed',
      'PRIVATE stored SQL and content',
      { migrationId: '0001_example', sqliteCode: 'SQLITE_ERROR' },
    );
    expect(describeDatabaseStartupError(error)).toBe(
      'Database migration 0001_example failed (SQLITE_ERROR).',
    );
    expect(describeDatabaseStartupError(new Error('PRIVATE'))).toBe(
      'Database startup failed.',
    );
    expect(
      describeDatabaseStartupError(
        new DatabaseLifecycleError(
          'database_key_identity_mismatch',
          'PRIVATE key metadata',
        ),
      ),
    ).toContain('stopped before requesting Keychain access');
  });
});
