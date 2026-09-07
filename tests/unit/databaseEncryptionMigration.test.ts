import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DatabaseEncryptionMigrator,
  isEncryptedOrNonPlaintext,
  isPlaintextSqliteDatabase,
} from '../../electron/database/encryptionMigration';

describe('DatabaseEncryptionMigrator', () => {
  let tmpDir: string;
  let dbPath: string;
  let rawKeyHex: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-migration-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    rawKeyHex = randomBytes(32).toString('hex');
  });

  it('detects plaintext SQLite database vs non-plaintext', () => {
    expect(isPlaintextSqliteDatabase(dbPath)).toBe(false);

    // Create plaintext DB
    const db = new Database(dbPath);
    db.exec('CREATE TABLE test (id INT);');
    db.close();

    expect(isPlaintextSqliteDatabase(dbPath)).toBe(true);
    expect(isEncryptedOrNonPlaintext(dbPath)).toBe(false);

    // Rekey to encrypted
    const encDb = new Database(dbPath);
    encDb.pragma("cipher = 'sqlcipher'");
    encDb.pragma(`rekey = "x'${rawKeyHex}'"`);
    encDb.close();

    expect(isPlaintextSqliteDatabase(dbPath)).toBe(false);
    expect(isEncryptedOrNonPlaintext(dbPath)).toBe(true);
  });

  it('migrates a plaintext database to an encrypted database end-to-end', () => {
    // 1. Setup rich plaintext DB with tables, indexes, rows
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT);
      CREATE TABLE meeting_speaker_candidates (id TEXT PRIMARY KEY, meeting_id TEXT, embedding BLOB);
      CREATE TABLE speaker_voice_enrollments (id TEXT PRIMARY KEY, name TEXT, embedding BLOB);
      INSERT INTO meetings VALUES ('m1', 'Weekly Sync');
      INSERT INTO meeting_speaker_candidates VALUES ('c1', 'm1', X'01020304');
      INSERT INTO speaker_voice_enrollments VALUES ('e1', 'Alice', X'AABBCCDD');
    `);
    db.close();

    expect(isPlaintextSqliteDatabase(dbPath)).toBe(true);

    // 2. Run migration
    const migrator = new DatabaseEncryptionMigrator({
      databasePath: dbPath,
      rawDatabaseKeyHex: rawKeyHex,
    });
    migrator.migrate();

    // 3. Verify file is no longer plaintext
    expect(isPlaintextSqliteDatabase(dbPath)).toBe(false);
    expect(isEncryptedOrNonPlaintext(dbPath)).toBe(true);

    // 4. Verify opening without key fails
    const unkeyed = new Database(dbPath);
    expect(() => unkeyed.prepare('SELECT * FROM meetings').all()).toThrow(
      /file is not a database/,
    );
    unkeyed.close();

    // 5. Verify opening with key succeeds with full data fidelity
    const keyed = new Database(dbPath);
    keyed.pragma("cipher = 'sqlcipher'");
    keyed.pragma(`key = "x'${rawKeyHex}'"`);
    const meetings = keyed.prepare('SELECT * FROM meetings').all();
    expect(meetings).toEqual([{ id: 'm1', title: 'Weekly Sync' }]);
    const candidates = keyed
      .prepare('SELECT * FROM meeting_speaker_candidates')
      .all();
    expect(candidates).toHaveLength(1);
    const enrollments = keyed
      .prepare('SELECT * FROM speaker_voice_enrollments')
      .all();
    expect(enrollments).toHaveLength(1);
    keyed.close();

    // 6. Verify migration journal was cleaned up
    expect(fs.existsSync(migrator.getJournalPath())).toBe(false);
  });

  it('resumes deterministically if interrupted after target verification', () => {
    // Setup plaintext DB
    const db = new Database(dbPath);
    db.exec(
      "CREATE TABLE items (id INT, val TEXT); INSERT INTO items VALUES (1, 'data');",
    );
    db.close();

    const migrator = new DatabaseEncryptionMigrator({
      databasePath: dbPath,
      rawDatabaseKeyHex: rawKeyHex,
    });

    // Simulate interrupted journal at step 'preflight'
    migrator.writeJournal({
      step: 'preflight',
      sourcePath: dbPath,
      stagingPath: `${dbPath}.encrypt-staging.db`,
      startedAtMs: Date.now(),
      updatedAtMs: Date.now(),
    });

    // Run migrate - it should resume and complete
    migrator.migrate();

    expect(isEncryptedOrNonPlaintext(dbPath)).toBe(true);
    const keyed = new Database(dbPath);
    keyed.pragma("cipher = 'sqlcipher'");
    keyed.pragma(`key = "x'${rawKeyHex}'"`);
    const rows = keyed.prepare('SELECT * FROM items').all();
    expect(rows).toEqual([{ id: 1, val: 'data' }]);
    keyed.close();
  });
});
