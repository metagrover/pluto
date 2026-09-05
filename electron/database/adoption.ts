import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { DatabaseLifecycleError } from './errors';
import {
  type PackagedMigration,
  readPackagedMigrationHistory,
} from './migrationHistory';

const SQLITE_SUFFIXES = ['', '-journal', '-shm', '-wal'] as const;

export const backupLegacyDatabase = (databasePath: string): string | null => {
  if (databasePath === ':memory:') return null;
  const parent = path.dirname(databasePath);
  const backupDir = path.join(
    parent,
    `.pluto-db-pre-drizzle-adoption-${Date.now()}-${process.pid}`,
  );
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    for (const suffix of SQLITE_SUFFIXES) {
      const source = `${databasePath}${suffix}`;
      if (fs.existsSync(source)) {
        fs.copyFileSync(source, path.join(backupDir, path.basename(source)));
      }
    }
    return backupDir;
  } catch {
    return null;
  }
};

export const adoptLegacyDatabase = (input: {
  sqlite: Database.Database;
  migrationsFolder: string;
  packagedHistory?: PackagedMigration[];
}): void => {
  const { sqlite, migrationsFolder } = input;
  const packaged =
    input.packagedHistory ?? readPackagedMigrationHistory(migrationsFolder);
  if (packaged.length === 0) {
    throw new DatabaseLifecycleError(
      'database_migration_failed',
      'No packaged migrations available for adoption.',
    );
  }

  const baseline = packaged[0];
  const baselineSqlPath = path.join(migrationsFolder, `${baseline.tag}.sql`);
  if (!fs.existsSync(baselineSqlPath)) {
    throw new DatabaseLifecycleError(
      'database_migration_failed',
      `Baseline migration file ${baseline.tag}.sql not found.`,
    );
  }

  const baselineSql = fs.readFileSync(baselineSqlPath, 'utf8');
  const statements = baselineSql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  sqlite.pragma('foreign_keys = OFF');
  try {
    for (const raw of statements) {
      const statement = raw
        .replace(/^CREATE TABLE `/i, 'CREATE TABLE IF NOT EXISTS `')
        .replace(
          /^CREATE UNIQUE INDEX `/i,
          'CREATE UNIQUE INDEX IF NOT EXISTS `',
        )
        .replace(/^CREATE INDEX `/i, 'CREATE INDEX IF NOT EXISTS `')
        .replace(
          /^CREATE VIRTUAL TABLE /i,
          'CREATE VIRTUAL TABLE IF NOT EXISTS ',
        )
        .replace(/^CREATE TRIGGER /i, 'CREATE TRIGGER IF NOT EXISTS ')
        .replace(/^INSERT INTO /i, 'INSERT OR IGNORE INTO ');

      try {
        sqlite.exec(statement);
      } catch {
        // Idempotent execution: ignore errors if existing object already matches
      }
    }

    // Ensure cross-meeting speaker voice tables exist
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS meeting_speaker_candidates (
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        speaker TEXT NOT NULL,
        source_revision TEXT NOT NULL,
        candidate_digest TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        clean_duration_sec REAL NOT NULL,
        clean_segment_count INTEGER NOT NULL,
        clean_chunk_count INTEGER NOT NULL,
        minimum_chunk_similarity REAL NOT NULL,
        mean_chunk_similarity REAL NOT NULL,
        reference_start_sec REAL NOT NULL,
        reference_end_sec REAL NOT NULL,
        reference_excerpt TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (meeting_id, speaker, source_revision)
      );
      CREATE INDEX IF NOT EXISTS idx_meeting_speaker_candidates_meeting ON meeting_speaker_candidates(meeting_id);

      CREATE TABLE IF NOT EXISTS speaker_voice_enrollments (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        source_meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        source_revision TEXT NOT NULL,
        speaker TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        chunk_count INTEGER NOT NULL,
        clean_duration_sec REAL NOT NULL,
        minimum_chunk_similarity REAL NOT NULL,
        mean_chunk_similarity REAL NOT NULL,
        reference_start_sec REAL NOT NULL,
        reference_end_sec REAL NOT NULL,
        reference_excerpt TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        candidate_digest TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_speaker_voice_enrollments_person ON speaker_voice_enrollments(person_id);
      CREATE INDEX IF NOT EXISTS idx_speaker_voice_enrollments_meeting ON speaker_voice_enrollments(source_meeting_id);

      CREATE TABLE IF NOT EXISTS speaker_voice_profile_settings (
        person_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
        is_active INTEGER NOT NULL DEFAULT 1,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS speaker_voice_rejections (
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        speaker TEXT NOT NULL,
        source_revision TEXT NOT NULL,
        candidate_digest TEXT NOT NULL,
        person_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (meeting_id, speaker, source_revision, candidate_digest, person_id)
      );
      CREATE INDEX IF NOT EXISTS idx_speaker_voice_rejections_meeting ON speaker_voice_rejections(meeting_id);
    `);

    // Ensure legacy identity_resolution_history has meeting_id if it existed in an older shape
    try {
      const historyCols = sqlite.pragma(
        'table_info(identity_resolution_history)',
      ) as Array<{ name: string }>;
      if (
        historyCols.length > 0 &&
        !historyCols.some((c) => c.name === 'meeting_id')
      ) {
        sqlite.exec(
          'ALTER TABLE identity_resolution_history ADD COLUMN meeting_id TEXT',
        );
      }
    } catch {
      // Ignore if table doesn't exist yet
    }

    // Ensure __drizzle_migrations exists and stamp baseline migration
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      );
      INSERT INTO __drizzle_migrations (hash, created_at)
      SELECT '${baseline.hash}', ${baseline.when}
      WHERE NOT EXISTS (
        SELECT 1 FROM __drizzle_migrations WHERE hash = '${baseline.hash}'
      );
    `);
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
};
