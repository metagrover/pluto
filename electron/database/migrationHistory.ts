import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { DatabaseLifecycleError } from './errors';

export interface PackagedMigration {
  tag: string;
  when: number;
  hash: string;
}

export interface AppliedMigration {
  createdAt: number;
  hash: string;
}

interface DrizzleJournal {
  entries: Array<{ idx: number; tag: string; when: number }>;
}

const sqliteCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object' || !('code' in error)) return;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

export const readPackagedMigrationHistory = (
  migrationsFolder: string,
): PackagedMigration[] => {
  try {
    const journal = JSON.parse(
      fs.readFileSync(
        path.join(migrationsFolder, 'meta', '_journal.json'),
        'utf8',
      ),
    ) as DrizzleJournal;
    const migrationFiles = readMigrationFiles({ migrationsFolder });

    if (journal.entries.length !== migrationFiles.length) {
      throw new DatabaseLifecycleError(
        'database_version_unsupported',
        'Packaged migration metadata is inconsistent.',
      );
    }

    return journal.entries.map((entry, index) => ({
      tag: entry.tag,
      when: entry.when,
      hash: migrationFiles[index]?.hash ?? '',
    }));
  } catch (error) {
    if (error instanceof DatabaseLifecycleError) throw error;
    throw new DatabaseLifecycleError(
      'database_migration_failed',
      'Packaged migration history could not be read.',
      { sqliteCode: sqliteCode(error) },
      { cause: error },
    );
  }
};

export const readAppliedMigrationHistory = (
  sqlite: Database.Database,
): AppliedMigration[] => {
  try {
    const exists = sqlite
      .prepare(
        `SELECT 1 FROM sqlite_schema
         WHERE type = 'table' AND name = '__drizzle_migrations'`,
      )
      .get();
    if (!exists) return [];

    const rows = sqlite
      .prepare(
        `SELECT hash, created_at AS createdAt
         FROM __drizzle_migrations
         ORDER BY created_at, id`,
      )
      .all() as Array<{ hash: string; createdAt: number | string }>;
    return rows.map((row) => ({
      createdAt: Number(row.createdAt),
      hash: row.hash,
    }));
  } catch (error) {
    if (error instanceof DatabaseLifecycleError) throw error;
    throw new DatabaseLifecycleError(
      'database_version_unsupported',
      'Applied migration history could not be read.',
      { sqliteCode: sqliteCode(error) },
      { cause: error },
    );
  }
};

export const assertSupportedMigrationHistory = (
  applied: AppliedMigration[],
  packaged: PackagedMigration[],
): void => {
  const isExactPrefix =
    applied.length <= packaged.length &&
    applied.every(
      (entry, index) =>
        entry.createdAt === packaged[index]?.when &&
        entry.hash === packaged[index]?.hash,
    );
  if (!isExactPrefix) {
    throw new DatabaseLifecycleError(
      'database_version_unsupported',
      'Applied migrations are not an exact prefix of packaged migrations.',
    );
  }
};

export const getPendingMigrationId = (
  applied: AppliedMigration[],
  packaged: PackagedMigration[],
): string | null => {
  assertSupportedMigrationHistory(applied, packaged);
  return packaged[applied.length]?.tag ?? null;
};
