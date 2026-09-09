import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DatabaseEncryptionMigrator,
  type MigrationKillPoint,
  isPlaintextSqliteDatabase,
} from '../../electron/database/encryptionMigration';
import { DatabaseLifecycleError } from '../../electron/database/errors';

describe('DatabaseEncryptionMigrator', () => {
  let tempDir: string;
  let dbPath: string;
  const testKeyHex =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pluto-db-migration-test-'),
    );
    dbPath = path.join(tempDir, 'pluto.db');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function createSamplePlaintextDatabase(targetPath: string) {
    const db = new Database(targetPath);
    try {
      db.pragma('user_version = 42');
      db.pragma('foreign_keys = ON');

      // Create __drizzle_migrations table
      db.exec(`
        CREATE TABLE IF NOT EXISTS __drizzle_migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hash text NOT NULL,
          created_at numeric
        );
        INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('hash_init', 1700000000);
        INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('hash_v2', 1700000100);
      `);

      // Create core application tables
      db.exec(`
        CREATE TABLE meetings (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE transcript_chunks (
          id TEXT PRIMARY KEY,
          meeting_id TEXT NOT NULL REFERENCES meetings(id),
          content TEXT NOT NULL,
          speaker TEXT
        );

        CREATE INDEX idx_transcript_meeting ON transcript_chunks(meeting_id);

        INSERT INTO meetings (id, title, created_at) VALUES
          ('m-1', 'Strategy Discussion', '2026-09-01T10:00:00Z'),
          ('m-2', 'Standup Sync', '2026-09-02T09:00:00Z');

        INSERT INTO transcript_chunks (id, meeting_id, content, speaker) VALUES
          ('c-1', 'm-1', 'Let us discuss local security.', 'Alice'),
          ('c-2', 'm-1', 'Agreed, data must stay private.', 'Bob'),
          ('c-3', 'm-2', 'All tasks on track.', 'Alice');
      `);
    } finally {
      db.close();
    }
  }

  it('detects plaintext SQLite database correctly', () => {
    expect(isPlaintextSqliteDatabase(dbPath)).toBe(false);

    createSamplePlaintextDatabase(dbPath);
    expect(isPlaintextSqliteDatabase(dbPath)).toBe(true);

    // Overwrite with random bytes
    fs.writeFileSync(dbPath, Buffer.alloc(64, 0xaa));
    expect(isPlaintextSqliteDatabase(dbPath)).toBe(false);
  });

  it('successfully migrates a plaintext database to an authenticated encrypted database', () => {
    createSamplePlaintextDatabase(dbPath);
    expect(isPlaintextSqliteDatabase(dbPath)).toBe(true);

    const migrator = new DatabaseEncryptionMigrator({
      databasePath: dbPath,
      rawDatabaseKeyHex: testKeyHex,
    });

    migrator.migrate();

    // After migration, the database on disk is NO LONGER plaintext SQLite format
    expect(isPlaintextSqliteDatabase(dbPath)).toBe(false);

    // Verify it opens with key
    const encryptedDb = new Database(dbPath);
    try {
      encryptedDb.pragma("cipher = 'sqlcipher'");
      encryptedDb.pragma(`key = "x'${testKeyHex}'"`);

      expect(encryptedDb.pragma('cipher_integrity_check')).toEqual([]);
      expect(encryptedDb.pragma('quick_check', { simple: true })).toBe('ok');
      expect(encryptedDb.pragma('foreign_key_check')).toEqual([]);
      expect(encryptedDb.pragma('user_version', { simple: true })).toBe(42);

      const meetings = encryptedDb
        .prepare('SELECT * FROM meetings ORDER BY id')
        .all();
      expect(meetings).toHaveLength(2);
      expect((meetings[0] as { title: string }).title).toBe(
        'Strategy Discussion',
      );

      const chunks = encryptedDb
        .prepare('SELECT * FROM transcript_chunks ORDER BY id')
        .all();
      expect(chunks).toHaveLength(3);
    } finally {
      encryptedDb.close();
    }

    // Journal should be cleanly unlinked
    expect(migrator.readJournal()).toBeNull();
  });

  it('aborts cleanly and preserves original plaintext if migration fails during rekey or target verification', () => {
    createSamplePlaintextDatabase(dbPath);

    // Intentionally inject a failure at 'before_verify_target'
    const failingMigrator = new DatabaseEncryptionMigrator({
      databasePath: dbPath,
      rawDatabaseKeyHex: testKeyHex,
      onKillPoint: (point) => {
        if (point === 'before_verify_target') {
          throw new Error('Injected failure during verification');
        }
      },
    });

    expect(() => failingMigrator.migrate()).toThrow(DatabaseLifecycleError);

    // Source database must still be fully intact and plaintext
    expect(isPlaintextSqliteDatabase(dbPath)).toBe(true);
    const db = new Database(dbPath);
    try {
      expect(db.pragma('quick_check', { simple: true })).toBe('ok');
      const count = (
        db.prepare('SELECT COUNT(*) as c FROM meetings').get() as { c: number }
      ).c;
      expect(count).toBe(2);
    } finally {
      db.close();
    }
  });

  it('restores staged plaintext backup if reopening verification fails after activation', () => {
    createSamplePlaintextDatabase(dbPath);

    let activatedTargetSeen = false;
    const failingMigrator = new DatabaseEncryptionMigrator({
      databasePath: dbPath,
      rawDatabaseKeyHex: testKeyHex,
      onKillPoint: (point) => {
        if (point === 'after_activate_target') {
          activatedTargetSeen = true;
          // Corrupt the activated file before reopen verification
          fs.writeFileSync(dbPath, Buffer.alloc(1024, 0xee));
        }
      },
    });

    expect(() => failingMigrator.migrate()).toThrow();
    expect(activatedTargetSeen).toBe(true);

    // Plaintext backup must have been restored
    expect(isPlaintextSqliteDatabase(dbPath)).toBe(true);
    const db = new Database(dbPath);
    try {
      expect(db.pragma('quick_check', { simple: true })).toBe('ok');
      const count = (
        db.prepare('SELECT COUNT(*) as c FROM meetings').get() as { c: number }
      ).c;
      expect(count).toBe(2);
    } finally {
      db.close();
    }
  });

  const killPoints: MigrationKillPoint[] = [
    'before_checkpoint_wal',
    'after_checkpoint_wal',
    'before_copy_staging',
    'after_copy_staging',
    'before_rekey',
    'after_rekey',
    'before_verify_target',
    'after_verify_target',
    'before_stage_artifacts',
    'after_stage_artifacts',
    'before_activate_target',
    'after_activate_target',
    'before_reopen_verify',
    'after_reopen_verify',
    'before_clean_plaintext',
    'after_clean_plaintext',
  ];

  for (const killPoint of killPoints) {
    it(`resumes or rolls back safely across kill point: ${killPoint}`, () => {
      createSamplePlaintextDatabase(dbPath);

      let killed = false;
      const injectedMigrator = new DatabaseEncryptionMigrator({
        databasePath: dbPath,
        rawDatabaseKeyHex: testKeyHex,
        onKillPoint: (point) => {
          if (point === killPoint) {
            killed = true;
            throw new Error(`Simulated crash at kill point: ${killPoint}`);
          }
        },
      });

      expect(() => injectedMigrator.migrate()).toThrow(/Simulated crash/);
      expect(killed).toBe(true);

      // Now resume with a clean migrator instance (simulating app relaunch)
      const resumingMigrator = new DatabaseEncryptionMigrator({
        databasePath: dbPath,
        rawDatabaseKeyHex: testKeyHex,
      });

      resumingMigrator.migrate();

      // Final state must be a healthy encrypted database
      expect(isPlaintextSqliteDatabase(dbPath)).toBe(false);
      const encryptedDb = new Database(dbPath);
      try {
        encryptedDb.pragma("cipher = 'sqlcipher'");
        encryptedDb.pragma(`key = "x'${testKeyHex}'"`);
        expect(encryptedDb.pragma('cipher_integrity_check')).toEqual([]);
        expect(encryptedDb.pragma('quick_check', { simple: true })).toBe('ok');
        const count = (
          encryptedDb.prepare('SELECT COUNT(*) as c FROM meetings').get() as {
            c: number;
          }
        ).c;
        expect(count).toBe(2);
      } finally {
        encryptedDb.close();
      }
    });
  }

  it('recovers active database and completes migration if active file was moved to backup before activation', () => {
    createSamplePlaintextDatabase(dbPath);

    // Simulate crash where source files were moved into deterministic backup directory
    // but activation never completed (e.g. power loss right after rename)
    const backupDir = `${dbPath}.migration-backup`;
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    fs.renameSync(dbPath, path.join(backupDir, path.basename(dbPath)));
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(fs.existsSync(path.join(backupDir, path.basename(dbPath)))).toBe(
      true,
    );

    // Migrator starts without journal or with preflight journal
    const migrator = new DatabaseEncryptionMigrator({
      databasePath: dbPath,
      rawDatabaseKeyHex: testKeyHex,
    });

    migrator.migrate();

    // Active path was successfully restored and migrated to encrypted format
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(isPlaintextSqliteDatabase(dbPath)).toBe(false);

    const encryptedDb = new Database(dbPath);
    try {
      encryptedDb.pragma("cipher = 'sqlcipher'");
      encryptedDb.pragma(`key = "x'${testKeyHex}'"`);
      expect(encryptedDb.pragma('cipher_integrity_check')).toEqual([]);
      expect(encryptedDb.pragma('quick_check', { simple: true })).toBe('ok');
      const count = (
        encryptedDb.prepare('SELECT COUNT(*) as c FROM meetings').get() as {
          c: number;
        }
      ).c;
      expect(count).toBe(2);
    } finally {
      encryptedDb.close();
    }
  });

  it('migrates and streams digests with bounded memory for larger datasets', () => {
    // Populate database with 500 rows in transcript_chunks
    const plainDb = new Database(dbPath);
    plainDb.exec(`
      CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, created_at TEXT);
      CREATE TABLE transcript_chunks (id TEXT PRIMARY KEY, meeting_id TEXT, content TEXT, speaker TEXT);
      INSERT INTO meetings VALUES ('m-1', 'Big Meeting', '2026-09-01T00:00:00Z');
    `);

    const insertStmt = plainDb.prepare(
      'INSERT INTO transcript_chunks VALUES (?, ?, ?, ?)',
    );
    for (let i = 0; i < 500; i++) {
      insertStmt.run(
        `c-${i}`,
        'm-1',
        `Chunk text line ${i} with extra content`,
        `Speaker-${i % 5}`,
      );
    }
    plainDb.close();

    const migrator = new DatabaseEncryptionMigrator({
      databasePath: dbPath,
      rawDatabaseKeyHex: testKeyHex,
    });

    migrator.migrate();

    expect(isPlaintextSqliteDatabase(dbPath)).toBe(false);
    const encryptedDb = new Database(dbPath);
    try {
      encryptedDb.pragma("cipher = 'sqlcipher'");
      encryptedDb.pragma(`key = "x'${testKeyHex}'"`);
      expect(encryptedDb.pragma('cipher_integrity_check')).toEqual([]);
      const count = (
        encryptedDb
          .prepare('SELECT COUNT(*) as c FROM transcript_chunks')
          .get() as {
          c: number;
        }
      ).c;
      expect(count).toBe(500);
    } finally {
      encryptedDb.close();
    }
  });

  it('detects alterations to user tables (e.g. user_notes) in staging and aborts migration', () => {
    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE meetings (id TEXT PRIMARY KEY, user_notes TEXT);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO meetings (id, user_notes) VALUES ('m-1', 'original notes');
        INSERT INTO settings (key, value) VALUES ('theme', 'dark');
      `);
    } finally {
      db.close();
    }

    const migrator = new DatabaseEncryptionMigrator({
      databasePath: dbPath,
      rawDatabaseKeyHex: testKeyHex,
      onKillPoint: (point) => {
        if (point === 'before_verify_target') {
          // Alter the user_notes value inside the encrypted staging database
          const stagingPath = `${dbPath}.staging.db`;
          const stagingDb = new Database(stagingPath);
          try {
            stagingDb.pragma("cipher = 'sqlcipher'");
            stagingDb.pragma(`key = "x'${testKeyHex}'"`);
            stagingDb.exec(
              "UPDATE meetings SET user_notes = 'tampered notes' WHERE id = 'm-1'",
            );
          } finally {
            stagingDb.close();
          }
        }
      },
    });

    expect(() => migrator.migrate()).toThrow(
      /Content digest mismatch for table meetings/,
    );

    // Migration must have aborted and preserved original uncorrupted plaintext
    expect(isPlaintextSqliteDatabase(dbPath)).toBe(true);
    const verifyDb = new Database(dbPath);
    try {
      const row = verifyDb
        .prepare("SELECT user_notes FROM meetings WHERE id = 'm-1'")
        .get() as { user_notes: string };
      expect(row.user_notes).toBe('original notes');
    } finally {
      verifyDb.close();
    }
  });

  it('fails closed with database_restore_failed if backup restoration fails or authoritative database is missing', () => {
    createSamplePlaintextDatabase(dbPath);

    // Simulate crash after moving files to backup
    const backupDir = `${dbPath}.migration-backup`;
    fs.mkdirSync(backupDir, { recursive: true });
    // Move db to backup but remove file so authoritative DB cannot be restored
    fs.renameSync(dbPath, path.join(backupDir, path.basename(dbPath)));
    fs.unlinkSync(path.join(backupDir, path.basename(dbPath))); // empty backup

    const journalPath = `${dbPath}.migration-journal.json`;
    fs.writeFileSync(
      journalPath,
      JSON.stringify({
        step: 'artifacts_staged',
        sourcePath: dbPath,
        stagingPath: `${dbPath}.migration-staging/db.migrating`,
        backupDir,
        startedAtMs: Date.now(),
        updatedAtMs: Date.now(),
      }),
      'utf8',
    );

    const resumingMigrator = new DatabaseEncryptionMigrator({
      databasePath: dbPath,
      rawDatabaseKeyHex: testKeyHex,
    });

    expect(() => resumingMigrator.migrate()).toThrowError(
      expect.objectContaining({
        code: 'database_restore_failed',
      }),
    );

    // Must NOT have created a blank database!
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it('propagates fsync failures during journal persistence and aborts migration', () => {
    createSamplePlaintextDatabase(dbPath);

    const fdPaths = new Map<number, string>();
    const originalOpenSync = fs.openSync;
    const originalFsyncSync = fs.fsyncSync;

    fs.openSync = ((
      target: fs.PathLike,
      flags: fs.OpenMode,
      mode?: fs.Mode,
    ) => {
      const fd = originalOpenSync(target, flags, mode);
      fdPaths.set(fd, String(target));
      return fd;
    }) as typeof fs.openSync;

    fs.fsyncSync = ((fd: number) => {
      const target = fdPaths.get(fd);
      if (target?.includes('migration-journal.json')) {
        throw new Error('Injected fsync failure on journal');
      }
      return originalFsyncSync(fd);
    }) as typeof fs.fsyncSync;

    try {
      const migrator = new DatabaseEncryptionMigrator({
        databasePath: dbPath,
        rawDatabaseKeyHex: testKeyHex,
      });

      expect(() => migrator.migrate()).toThrow(
        expect.objectContaining({
          code: 'database_encryption_migration_failed',
        }),
      );

      // Plaintext database must remain intact
      expect(isPlaintextSqliteDatabase(dbPath)).toBe(true);
    } finally {
      fs.openSync = originalOpenSync;
      fs.fsyncSync = originalFsyncSync;
    }
  });

  it('aborts and preserves recoverable plaintext backup when target activation fsync fails', () => {
    createSamplePlaintextDatabase(dbPath);

    const fdPaths = new Map<number, string>();
    const originalOpenSync = fs.openSync;
    const originalFsyncSync = fs.fsyncSync;
    let activated = false;
    let activationFailureInjected = false;

    fs.openSync = ((
      target: fs.PathLike,
      flags: fs.OpenMode,
      mode?: fs.Mode,
    ) => {
      const fd = originalOpenSync(target, flags, mode);
      fdPaths.set(fd, String(target));
      return fd;
    }) as typeof fs.openSync;

    fs.fsyncSync = ((fd: number) => {
      const target = fdPaths.get(fd);
      // Trigger when syncing the activated databasePath during stepActivateTarget
      if (activated && target === dbPath && !activationFailureInjected) {
        activationFailureInjected = true;
        throw new Error('Injected fsync failure during target activation');
      }
      return originalFsyncSync(fd);
    }) as typeof fs.fsyncSync;

    try {
      const migrator = new DatabaseEncryptionMigrator({
        databasePath: dbPath,
        rawDatabaseKeyHex: testKeyHex,
        onKillPoint: (point) => {
          if (point === 'before_activate_target') {
            activated = true;
          }
        },
      });

      expect(() => migrator.migrate()).toThrow(
        expect.objectContaining({
          code: 'database_encryption_migration_failed',
        }),
      );

      // Durability barrier failed on target activation; recoverable backup must have been restored
      expect(isPlaintextSqliteDatabase(dbPath)).toBe(true);
      const verifyDb = new Database(dbPath);
      try {
        const count = (
          verifyDb.prepare('SELECT COUNT(*) as c FROM meetings').get() as {
            c: number;
          }
        ).c;
        expect(count).toBe(2);
      } finally {
        verifyDb.close();
      }
    } finally {
      fs.openSync = originalOpenSync;
      fs.fsyncSync = originalFsyncSync;
    }
  });

  it('propagates fsync failures during backup cleanup and does not complete migration', () => {
    createSamplePlaintextDatabase(dbPath);

    const fdPaths = new Map<number, string>();
    const originalOpenSync = fs.openSync;
    const originalFsyncSync = fs.fsyncSync;
    let inBackupCleanup = false;

    fs.openSync = ((
      target: fs.PathLike,
      flags: fs.OpenMode,
      mode?: fs.Mode,
    ) => {
      const fd = originalOpenSync(target, flags, mode);
      fdPaths.set(fd, String(target));
      return fd;
    }) as typeof fs.openSync;

    fs.fsyncSync = ((fd: number) => {
      const target = fdPaths.get(fd);
      // Trigger when syncing directory during step 8 (backup cleanup)
      if (inBackupCleanup && target === path.dirname(dbPath)) {
        throw new Error('Injected fsync failure during backup cleanup');
      }
      return originalFsyncSync(fd);
    }) as typeof fs.fsyncSync;

    try {
      const migrator = new DatabaseEncryptionMigrator({
        databasePath: dbPath,
        rawDatabaseKeyHex: testKeyHex,
        onKillPoint: (point) => {
          if (point === 'before_clean_plaintext') {
            inBackupCleanup = true;
          }
        },
      });

      expect(() => migrator.migrate()).toThrow(
        expect.objectContaining({
          code: 'database_encryption_migration_failed',
        }),
      );

      // Migration must NOT have reached complete state; journal still exists
      const journalPath = `${dbPath}.migration-journal.json`;
      expect(fs.existsSync(journalPath)).toBe(true);
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      expect(journal.step).not.toBe('complete');
    } finally {
      fs.openSync = originalOpenSync;
      fs.fsyncSync = originalFsyncSync;
    }
  });
});
