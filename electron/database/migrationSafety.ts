import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { DatabaseLifecycleError } from './errors';
import type { PackagedMigration } from './migrationHistory';

export type MigrationRisk = 'additive' | 'major' | 'destructive';

type MigrationPolicyFile = {
  version: 1;
  migrations: Record<string, { risk: MigrationRisk }>;
};

export type SchemaMigrationJournal = {
  version: 1;
  state: 'prepared' | 'backed_up';
  fromSchemaVersion: number;
  toSchemaVersion: number;
  pendingMigrationIds: string[];
  targetMigrationHashes: string[];
  backupDirectory?: string;
  startedAt: string;
};

const writeDurableJson = (filePath: string, value: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  const fd = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, filePath);
  const directoryFd = fs.openSync(path.dirname(filePath), 'r');
  try {
    fs.fsyncSync(directoryFd);
  } finally {
    fs.closeSync(directoryFd);
  }
};

const sha256File = (filePath: string) =>
  crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

export const schemaMigrationJournalPath = (databasePath: string) =>
  `${databasePath}.schema-migration-journal.json`;

export const readMigrationPolicies = (
  migrationsFolder: string,
  packaged: PackagedMigration[],
): Map<string, MigrationRisk> => {
  const policyPath = path.join(migrationsFolder, 'migration-policy.json');
  try {
    const parsed = JSON.parse(
      fs.readFileSync(policyPath, 'utf8'),
    ) as MigrationPolicyFile;
    if (parsed.version !== 1 || !parsed.migrations) throw new Error('format');
    const policies = new Map<string, MigrationRisk>();
    for (const migration of packaged) {
      const risk = parsed.migrations[migration.tag]?.risk;
      if (!['additive', 'major', 'destructive'].includes(risk)) {
        throw new Error(`missing policy for ${migration.tag}`);
      }
      policies.set(migration.tag, risk);
    }
    const known = new Set(packaged.map(({ tag }) => tag));
    if (Object.keys(parsed.migrations).some((tag) => !known.has(tag))) {
      throw new Error('policy references an unknown migration');
    }
    return policies;
  } catch (error) {
    throw new DatabaseLifecycleError(
      'database_migration_policy_invalid',
      'Migration policy is missing or inconsistent.',
      {},
      { cause: error },
    );
  }
};

export const readSchemaMigrationJournal = (
  databasePath: string,
): SchemaMigrationJournal | null => {
  if (databasePath === ':memory:') return null;
  const journalPath = schemaMigrationJournalPath(databasePath);
  if (!fs.existsSync(journalPath)) return null;
  try {
    const value = JSON.parse(
      fs.readFileSync(journalPath, 'utf8'),
    ) as SchemaMigrationJournal;
    if (
      value.version !== 1 ||
      !['prepared', 'backed_up'].includes(value.state) ||
      !Number.isSafeInteger(value.fromSchemaVersion) ||
      !Number.isSafeInteger(value.toSchemaVersion) ||
      !Array.isArray(value.pendingMigrationIds) ||
      !Array.isArray(value.targetMigrationHashes)
    ) {
      throw new Error('invalid schema migration journal');
    }
    return value;
  } catch (error) {
    throw new DatabaseLifecycleError(
      'database_migration_recovery_required',
      'Schema migration journal is invalid.',
      {},
      { cause: error },
    );
  }
};

export const prepareSchemaMigration = (input: {
  sqlite: Database.Database;
  databasePath: string;
  fromSchemaVersion: number;
  packaged: PackagedMigration[];
  policies: Map<string, MigrationRisk>;
}): SchemaMigrationJournal | null => {
  const pending = input.packaged.slice(input.fromSchemaVersion);
  if (pending.length === 0 || input.databasePath === ':memory:') return null;
  const journalPath = schemaMigrationJournalPath(input.databasePath);
  const prior = readSchemaMigrationJournal(input.databasePath);
  if (prior) {
    if (
      prior.fromSchemaVersion !== input.fromSchemaVersion ||
      prior.toSchemaVersion !== input.packaged.length ||
      prior.pendingMigrationIds.join('\n') !==
        pending.map(({ tag }) => tag).join('\n') ||
      prior.targetMigrationHashes.join('\n') !==
        pending.map(({ hash }) => hash).join('\n')
    ) {
      throw new DatabaseLifecycleError(
        'database_migration_recovery_required',
        'Interrupted schema migration does not match the current database.',
      );
    }
    return prior;
  }

  let journal: SchemaMigrationJournal = {
    version: 1,
    state: 'prepared',
    fromSchemaVersion: input.fromSchemaVersion,
    toSchemaVersion: input.packaged.length,
    pendingMigrationIds: pending.map(({ tag }) => tag),
    targetMigrationHashes: pending.map(({ hash }) => hash),
    startedAt: new Date().toISOString(),
  };
  writeDurableJson(journalPath, journal);

  const needsBackup = pending.some(({ tag }) => {
    const risk = input.policies.get(tag);
    return risk === 'major' || risk === 'destructive';
  });
  if (
    needsBackup &&
    fs.existsSync(input.databasePath) &&
    fs.statSync(input.databasePath).size > 0
  ) {
    const checkpoint = input.sqlite.pragma(
      'wal_checkpoint(TRUNCATE)',
    ) as Array<{
      busy?: number;
    }>;
    if (checkpoint.some(({ busy }) => Number(busy) !== 0)) {
      throw new DatabaseLifecycleError(
        'database_backup_failed',
        'Database WAL could not be checkpointed before backup.',
      );
    }
    const stamp = journal.startedAt.replace(/[^0-9A-Za-z]/g, '-');
    const backupDirectory = path.join(
      path.dirname(input.databasePath),
      'db-backups',
      `schema-${journal.fromSchemaVersion}-to-${journal.toSchemaVersion}-${stamp}`,
    );
    fs.mkdirSync(path.dirname(backupDirectory), {
      recursive: true,
      mode: 0o700,
    });
    fs.mkdirSync(backupDirectory, { recursive: false, mode: 0o700 });
    const backupPath = path.join(
      backupDirectory,
      path.basename(input.databasePath),
    );
    fs.copyFileSync(input.databasePath, backupPath, fs.constants.COPYFILE_EXCL);
    const backupFd = fs.openSync(backupPath, 'r');
    try {
      fs.fsyncSync(backupFd);
    } finally {
      fs.closeSync(backupFd);
    }
    writeDurableJson(path.join(backupDirectory, 'manifest.json'), {
      version: 1,
      state: 'complete',
      databaseFile: path.basename(backupPath),
      sourceDatabaseSha256: sha256File(backupPath),
      fromSchemaVersion: journal.fromSchemaVersion,
      toSchemaVersion: journal.toSchemaVersion,
      pendingMigrationIds: journal.pendingMigrationIds,
      targetMigrationHashes: journal.targetMigrationHashes,
      createdAt: journal.startedAt,
    });
    journal = { ...journal, state: 'backed_up', backupDirectory };
    writeDurableJson(journalPath, journal);
  }
  return journal;
};

export const completeSchemaMigration = (databasePath: string) => {
  if (databasePath === ':memory:') return;
  const journalPath = schemaMigrationJournalPath(databasePath);
  if (!fs.existsSync(journalPath)) return;
  fs.unlinkSync(journalPath);
  const directoryFd = fs.openSync(path.dirname(journalPath), 'r');
  try {
    fs.fsyncSync(directoryFd);
  } finally {
    fs.closeSync(directoryFd);
  }
};

export const restoreLatestVerifiedSchemaBackup = (databasePath: string) => {
  const backupsRoot = path.join(path.dirname(databasePath), 'db-backups');
  const candidates = fs.existsSync(backupsRoot)
    ? fs
        .readdirSync(backupsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(backupsRoot, entry.name))
        .sort()
        .reverse()
    : [];
  for (const directory of candidates) {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'),
      ) as {
        version?: unknown;
        state?: unknown;
        databaseFile?: unknown;
        sourceDatabaseSha256?: unknown;
      };
      if (
        manifest.version !== 1 ||
        manifest.state !== 'complete' ||
        typeof manifest.databaseFile !== 'string' ||
        typeof manifest.sourceDatabaseSha256 !== 'string' ||
        path.basename(manifest.databaseFile) !== manifest.databaseFile
      )
        continue;
      const backupPath = path.join(directory, manifest.databaseFile);
      if (sha256File(backupPath) !== manifest.sourceDatabaseSha256) continue;
      const temporary = `${databasePath}.restore-${process.pid}`;
      fs.copyFileSync(backupPath, temporary, fs.constants.COPYFILE_EXCL);
      const temporaryFd = fs.openSync(temporary, 'r');
      try {
        fs.fsyncSync(temporaryFd);
      } finally {
        fs.closeSync(temporaryFd);
      }
      const failedSuffix = `.failed-${new Date()
        .toISOString()
        .replace(/[^0-9A-Za-z]/g, '-')}`;
      if (fs.existsSync(databasePath)) {
        const failedDatabasePath = `${databasePath}${failedSuffix}`;
        fs.copyFileSync(
          databasePath,
          failedDatabasePath,
          fs.constants.COPYFILE_EXCL,
        );
        const failedFd = fs.openSync(failedDatabasePath, 'r');
        try {
          fs.fsyncSync(failedFd);
        } finally {
          fs.closeSync(failedFd);
        }
      }
      for (const suffix of ['-wal', '-shm']) {
        const artifact = `${databasePath}${suffix}`;
        if (fs.existsSync(artifact)) {
          fs.renameSync(artifact, `${artifact}${failedSuffix}`);
        }
      }
      fs.renameSync(temporary, databasePath);
      completeSchemaMigration(databasePath);
      return directory;
    } catch {
      // Try the next newest complete, hash-verified backup.
    }
  }
  throw new DatabaseLifecycleError(
    'database_restore_failed',
    'No complete, hash-verified schema backup is available.',
  );
};
