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

/**
 * A development chat migration was applied before the meeting-prep migrations
 * landed on master. Accept only that exact history and reconcile it to the
 * packaged order; every other divergent history remains unsupported.
 */
export const reconcileWorkspaceChatMigrationFork = (
  sqlite: Database.Database,
  migrationsFolder: string,
  packaged: PackagedMigration[],
): boolean => {
  const applied = readAppliedMigrationHistory(sqlite);
  const chat = packaged[17];
  if (
    applied.length !== 14 ||
    packaged.length < 18 ||
    chat?.tag !== '0017_workspace_chat' ||
    applied[13].createdAt !== chat.when ||
    applied[13].hash !== chat.hash ||
    !applied
      .slice(0, 13)
      .every(
        (entry, index) =>
          entry.createdAt === packaged[index]?.when &&
          entry.hash === packaged[index]?.hash,
      )
  ) {
    return false;
  }

  const hasTable = (name: string): boolean =>
    Boolean(
      sqlite
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?",
        )
        .get(name),
    );
  if (
    !hasTable('workspace_chat_threads') ||
    !hasTable('workspace_chat_messages') ||
    hasTable('prep_attendee_links') ||
    hasTable('meeting_prep')
  ) {
    throw new DatabaseLifecycleError(
      'database_version_unsupported',
      'The chat migration fork does not match the expected schema.',
    );
  }

  const migrationFiles = readMigrationFiles({ migrationsFolder });
  if (
    migrationFiles.length !== packaged.length ||
    !migrationFiles.every((file, index) => file.hash === packaged[index].hash)
  ) {
    throw new DatabaseLifecycleError(
      'database_version_unsupported',
      'Packaged migration metadata is inconsistent.',
    );
  }

  const foreignKeysEnabled =
    sqlite.pragma('foreign_keys', { simple: true }) === 1;
  sqlite.pragma('foreign_keys = OFF');
  try {
    sqlite.transaction(() => {
      for (const migration of migrationFiles.slice(13, 17)) {
        for (const statement of migration.sql) sqlite.exec(statement);
      }
      sqlite
        .prepare(
          'DELETE FROM __drizzle_migrations WHERE hash = ? AND created_at = ?',
        )
        .run(chat.hash, chat.when);
      const insert = sqlite.prepare(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
      );
      for (const migration of packaged.slice(13, 18)) {
        insert.run(migration.hash, migration.when);
      }
      if ((sqlite.pragma('foreign_key_check') as unknown[]).length > 0) {
        throw new DatabaseLifecycleError(
          'database_migration_failed',
          'The reconciled migration history violates foreign keys.',
        );
      }
    })();
  } finally {
    sqlite.pragma(`foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
  }
  assertSupportedMigrationHistory(
    readAppliedMigrationHistory(sqlite),
    packaged,
  );
  return true;
};

export const getPendingMigrationId = (
  applied: AppliedMigration[],
  packaged: PackagedMigration[],
): string | null => {
  assertSupportedMigrationHistory(applied, packaged);
  return packaged[applied.length]?.tag ?? null;
};
