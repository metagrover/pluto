import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
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
} from '../../electron/database/migrationHistory';

const packaged = [
  { tag: '0000_pluto_baseline', when: 100, hash: 'hash-0' },
  { tag: '0001_example', when: 200, hash: 'hash-1' },
];

describe('database migration history', () => {
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

  it('reads packaged tags, timestamps, and Drizzle hashes', () => {
    const history = readPackagedMigrationHistory(
      path.join(process.cwd(), 'drizzle'),
    );
    expect(history).toHaveLength(12);
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
    for (const migration of history) {
      expect(migration.when).toEqual(expect.any(Number));
      expect(migration.hash).toMatch(/^[a-f0-9]{64}$/);
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
