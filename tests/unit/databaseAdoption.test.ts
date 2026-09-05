import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseRuntime } from '../../electron/database/runtime';

const roots: string[] = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-db-adoption-'));
  roots.push(root);
  return root;
};

const baselineFolder = path.join(process.cwd(), 'drizzle');

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('legacy database adoption', () => {
  it('adopts a legacy database preserving existing rows and tables', () => {
    const root = makeRoot();
    const databasePath = path.join(root, 'pluto.db');
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        start_time TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO meetings (id, title) VALUES ('meeting-123', 'Important Planning Meeting');

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      INSERT INTO settings (key, value) VALUES ('setup_complete', 'true');
    `);
    legacy.close();

    const runtime = createDatabaseRuntime({
      databasePath,
      migrationsFolder: baselineFolder,
    });
    const sqlite = runtime.initialize();

    // Verify existing rows were preserved
    const meeting = sqlite
      .prepare("SELECT * FROM meetings WHERE id = 'meeting-123'")
      .get() as { id: string; title: string };
    expect(meeting).toBeDefined();
    expect(meeting.title).toBe('Important Planning Meeting');

    const setting = sqlite
      .prepare("SELECT value FROM settings WHERE key = 'setup_complete'")
      .get() as { value: string };
    expect(setting).toBeDefined();
    expect(setting.value).toBe('true');

    // Verify __drizzle_migrations table was stamped
    const migrations = sqlite
      .prepare('SELECT * FROM __drizzle_migrations')
      .all();
    expect(migrations.length).toBeGreaterThan(0);

    // Verify speaker candidate tables were created
    const candidateTable = sqlite
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'meeting_speaker_candidates'",
      )
      .get();
    expect(candidateTable).toBeDefined();

    // Verify pre-adoption backup directory was created
    const backupDirs = fs
      .readdirSync(root)
      .filter((name) => name.startsWith('.pluto-db-pre-drizzle-adoption-'));
    expect(backupDirs.length).toBe(1);

    // Verify health
    expect(sqlite.pragma('quick_check', { simple: true })).toBe('ok');
    expect((sqlite.pragma('foreign_key_check') as unknown[]).length).toBe(0);

    runtime.close();

    // Verify re-opening as managed database works seamlessly
    const reRuntime = createDatabaseRuntime({
      databasePath,
      migrationsFolder: baselineFolder,
    });
    const reSqlite = reRuntime.initialize();
    expect(
      reSqlite
        .prepare("SELECT title FROM meetings WHERE id = 'meeting-123'")
        .get(),
    ).toEqual({ title: 'Important Planning Meeting' });
    reRuntime.close();
  });
});
