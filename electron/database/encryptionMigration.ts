import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { DatabaseLifecycleError } from './errors';

export const SQLITE_PLAINTEXT_HEADER = Buffer.from('SQLite format 3\0', 'utf8');

export function isPlaintextSqliteDatabase(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  let fd: number | null = null;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < 16) return false;
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    return buffer.equals(SQLITE_PLAINTEXT_HEADER);
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

function fsyncPath(targetPath: string): void {
  const fd = fs.openSync(targetPath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDirectory(dirPath: string): void {
  fsyncPath(dirPath);
}

function durableAtomicWriteFile(
  filePath: string,
  content: string | Buffer,
): void {
  const tmpPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fd = fs.openSync(tmpPath, 'w', 0o600);
  try {
    if (typeof content === 'string') {
      fs.writeFileSync(fd, content, 'utf8');
    } else {
      fs.writeFileSync(fd, content);
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
  fsyncDirectory(path.dirname(filePath));
}

function serializeRow(row: Record<string, unknown>): string {
  const keys = Object.keys(row).sort();
  const sortedRow: Record<string, unknown> = {};
  for (const k of keys) {
    const val = row[k];
    if (Buffer.isBuffer(val)) {
      sortedRow[k] = val.toString('base64');
    } else {
      sortedRow[k] = val;
    }
  }
  return JSON.stringify(sortedRow);
}

function getTableOrderClause(db: Database.Database, table: string): string {
  try {
    db.prepare(`SELECT ROWID FROM "${table}" LIMIT 0`).run();
    return 'ROWID ASC';
  } catch {
    try {
      const columns = db.pragma(`table_info("${table}")`) as Array<{
        name: string;
        pk: number;
      }>;
      const pkCols = columns
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => `"${c.name}" ASC`);
      if (pkCols.length > 0) {
        return pkCols.join(', ');
      }
      if (columns.length > 0) {
        return columns.map((c) => `"${c.name}" ASC`).join(', ');
      }
    } catch {}
    return '1 ASC';
  }
}

function computeTableDigest(
  database: Database.Database,
  table: string,
): string {
  const hash = crypto.createHash('sha256');
  const orderClause = getTableOrderClause(database, table);
  const stmt = database.prepare(
    `SELECT * FROM "${table}" ORDER BY ${orderClause}`,
  );
  for (const row of stmt.iterate()) {
    hash.update(serializeRow(row as Record<string, unknown>));
  }
  return hash.digest('hex');
}

export type MigrationStep =
  | 'preflight'
  | 'wal_checkpointed'
  | 'staging_copied'
  | 'rekeyed_encrypted'
  | 'target_verified'
  | 'staging_artifacts'
  | 'artifacts_staged'
  | 'target_activated'
  | 'reopened_and_recovered'
  | 'plaintext_removed'
  | 'complete';

export type MigrationKillPoint =
  | 'before_checkpoint_wal'
  | 'after_checkpoint_wal'
  | 'before_copy_staging'
  | 'after_copy_staging'
  | 'before_rekey'
  | 'after_rekey'
  | 'before_verify_target'
  | 'after_verify_target'
  | 'before_stage_artifacts'
  | 'after_stage_artifacts'
  | 'before_activate_target'
  | 'after_activate_target'
  | 'before_reopen_verify'
  | 'after_reopen_verify'
  | 'before_clean_plaintext'
  | 'after_clean_plaintext';

export interface MigrationJournal {
  step: MigrationStep;
  sourcePath: string;
  stagingPath: string;
  backupDir?: string;
  startedAtMs: number;
  updatedAtMs: number;
}

export interface DatabaseEncryptionMigratorOptions {
  databasePath: string;
  rawDatabaseKeyHex: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  onKillPoint?: (point: MigrationKillPoint) => void;
}

export class DatabaseEncryptionMigrator {
  private readonly databasePath: string;
  private readonly rawKeyHex: string;
  private readonly journalPath: string;
  private readonly stagingPath: string;
  private readonly backupDir: string;
  private readonly logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  private readonly onKillPoint?: (point: MigrationKillPoint) => void;

  constructor(options: DatabaseEncryptionMigratorOptions) {
    this.databasePath = options.databasePath;
    this.rawKeyHex = options.rawDatabaseKeyHex;
    this.journalPath = `${options.databasePath}.migration-journal.json`;
    this.stagingPath = `${options.databasePath}.staging.db`;
    this.backupDir = `${options.databasePath}.migration-backup`;
    this.logger = options.logger;
    this.onKillPoint = options.onKillPoint;
  }

  private triggerKillPoint(point: MigrationKillPoint) {
    if (this.onKillPoint) {
      this.onKillPoint(point);
    }
  }

  readJournal(): MigrationJournal | null {
    try {
      if (!fs.existsSync(this.journalPath)) return null;
      return JSON.parse(fs.readFileSync(this.journalPath, 'utf8'));
    } catch {
      return null;
    }
  }

  writeJournal(journal: MigrationJournal) {
    journal.updatedAtMs = Date.now();
    durableAtomicWriteFile(this.journalPath, JSON.stringify(journal, null, 2));
  }

  cleanJournal() {
    if (fs.existsSync(this.journalPath)) {
      fs.unlinkSync(this.journalPath);
      fsyncDirectory(path.dirname(this.journalPath));
    }
  }

  cleanStaging() {
    try {
      if (fs.existsSync(this.stagingPath)) {
        fs.unlinkSync(this.stagingPath);
      }
      const related = [
        `${this.stagingPath}-wal`,
        `${this.stagingPath}-shm`,
        `${this.stagingPath}-journal`,
      ];
      for (const f of related) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      fsyncDirectory(path.dirname(this.stagingPath));
    } catch {}
  }

  migrate(): void {
    let journal = this.readJournal();
    if (journal) {
      this.logger?.warn?.(
        `[EncryptionMigration] Resuming in-progress migration from journal state: ${journal.step}`,
      );
      this.resume(journal);
      return;
    }

    if (!fs.existsSync(this.databasePath)) {
      this.recoverOrphanedPlaintextBackups();
    }

    if (!isPlaintextSqliteDatabase(this.databasePath)) {
      return;
    }

    journal = {
      step: 'preflight',
      sourcePath: this.databasePath,
      stagingPath: this.stagingPath,
      startedAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };
    try {
      this.writeJournal(journal);
    } catch (error) {
      throw error instanceof DatabaseLifecycleError
        ? error
        : new DatabaseLifecycleError(
            'database_encryption_migration_failed',
            `Failed to persist initial migration journal: ${error instanceof Error ? error.message : String(error)}`,
            {},
            { cause: error },
          );
    }

    this.runSteps(journal);
  }

  private runSteps(journal: MigrationJournal) {
    try {
      // 1. Checkpoint WAL
      if (journal.step === 'preflight') {
        this.triggerKillPoint('before_checkpoint_wal');
        this.stepCheckpointWal();
        this.triggerKillPoint('after_checkpoint_wal');
        journal.step = 'wal_checkpointed';
        this.writeJournal(journal);
      }

      // 2. Copy source to staging
      if (journal.step === 'wal_checkpointed') {
        this.triggerKillPoint('before_copy_staging');
        this.stepCopyToStaging();
        this.triggerKillPoint('after_copy_staging');
        journal.step = 'staging_copied';
        this.writeJournal(journal);
      }

      // 3. Rekey staging database to SQLCipher
      if (journal.step === 'staging_copied') {
        this.triggerKillPoint('before_rekey');
        this.stepRekeyStaging();
        this.triggerKillPoint('after_rekey');
        journal.step = 'rekeyed_encrypted';
        this.writeJournal(journal);
      }

      // 4. Deep structural verification
      if (journal.step === 'rekeyed_encrypted') {
        this.triggerKillPoint('before_verify_target');
        this.stepVerifyEncryptedTarget();
        this.triggerKillPoint('after_verify_target');
        journal.step = 'target_verified';
        this.writeJournal(journal);
      }

      // 5. Stage original plaintext artifacts into backup directory
      if (journal.step === 'target_verified') {
        fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
        fsyncDirectory(this.backupDir);
        journal.backupDir = this.backupDir;
        journal.step = 'staging_artifacts';
        this.writeJournal(journal);
      }

      if (journal.step === 'staging_artifacts') {
        const backupDir = journal.backupDir ?? this.backupDir;
        this.triggerKillPoint('before_stage_artifacts');
        this.stepStagePlaintextArtifacts(backupDir);
        this.triggerKillPoint('after_stage_artifacts');
        journal.step = 'artifacts_staged';
        this.writeJournal(journal);
      }

      // 6. Atomically activate target
      if (journal.step === 'artifacts_staged') {
        this.triggerKillPoint('before_activate_target');
        this.stepActivateTarget();
        journal.step = 'target_activated';
        this.writeJournal(journal);
        this.triggerKillPoint('after_activate_target');
      }

      // 7. Reopen and verify activated database
      if (journal.step === 'target_activated') {
        this.triggerKillPoint('before_reopen_verify');
        try {
          this.stepReopenAndVerify();
        } catch (verifyError) {
          // If reopen verification fails on activated database, restore backup immediately
          const backupDir = journal.backupDir ?? this.backupDir;
          if (fs.existsSync(backupDir)) {
            this.logger?.error?.(
              '[EncryptionMigration] Reopened database verification failed; restoring plaintext backup',
            );
            this.restoreFromBackup(backupDir);
          }
          throw verifyError;
        }
        this.triggerKillPoint('after_reopen_verify');
        journal.step = 'reopened_and_recovered';
        this.writeJournal(journal);
      }

      // 8. Clean up staged plaintext backup
      if (journal.step === 'reopened_and_recovered') {
        this.triggerKillPoint('before_clean_plaintext');
        const backupDir = journal.backupDir ?? this.backupDir;
        if (fs.existsSync(backupDir)) {
          fs.rmSync(backupDir, { recursive: true, force: true });
          fsyncDirectory(path.dirname(this.databasePath));
        }
        this.triggerKillPoint('after_clean_plaintext');
        journal.step = 'plaintext_removed';
        this.writeJournal(journal);
      }

      // 9. Complete
      journal.step = 'complete';
      this.cleanJournal();
      this.logger?.info?.(
        '[EncryptionMigration] Database encryption migration completed successfully.',
      );
    } catch (error) {
      // If error occurs before activation, clean staging and restore backup if created
      if (
        journal.step !== 'target_activated' &&
        journal.step !== 'reopened_and_recovered' &&
        journal.step !== 'plaintext_removed' &&
        journal.step !== 'complete'
      ) {
        const backupDir = journal.backupDir ?? this.backupDir;
        if (fs.existsSync(backupDir)) {
          this.restoreFromBackup(backupDir);
        }
        this.recoverOrphanedPlaintextBackups();
        this.cleanStaging();
      }

      throw error instanceof DatabaseLifecycleError
        ? error
        : new DatabaseLifecycleError(
            'database_encryption_migration_failed',
            `Database encryption migration failed at step ${journal.step}: ${error instanceof Error ? error.message : String(error)}`,
            {},
            { cause: error },
          );
    }
  }

  private resume(journal: MigrationJournal) {
    if (
      journal.step === 'target_activated' ||
      journal.step === 'reopened_and_recovered' ||
      journal.step === 'plaintext_removed'
    ) {
      // Target is already authoritative. Resume from verification/cleanup.
      this.runSteps(journal);
      return;
    }

    // Interrupted before activation: Plaintext is authoritative.
    this.cleanStaging();
    const backupDir = journal.backupDir ?? this.backupDir;
    if (fs.existsSync(backupDir)) {
      this.restoreFromBackup(backupDir);
    }
    this.recoverOrphanedPlaintextBackups();

    if (!fs.existsSync(this.databasePath)) {
      throw new DatabaseLifecycleError(
        'database_restore_failed',
        `Authoritative plaintext database at ${this.databasePath} was not restored during migration resumption.`,
      );
    }
    if (!isPlaintextSqliteDatabase(this.databasePath)) {
      throw new DatabaseLifecycleError(
        'database_restore_failed',
        `Database at ${this.databasePath} is not a valid plaintext SQLite database after restore during migration resumption.`,
      );
    }

    journal.step = 'preflight';
    this.writeJournal(journal);
    this.runSteps(journal);
  }

  private stepCheckpointWal() {
    const db = new Database(this.databasePath);
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      db.close();
    }
    fsyncPath(this.databasePath);
    fsyncDirectory(path.dirname(this.databasePath));
  }

  private stepCopyToStaging() {
    this.cleanStaging();
    fs.copyFileSync(this.databasePath, this.stagingPath);
    fsyncPath(this.stagingPath);
    fsyncDirectory(path.dirname(this.stagingPath));
  }

  private stepRekeyStaging() {
    const stagingDb = new Database(this.stagingPath);
    try {
      stagingDb.pragma("cipher = 'sqlcipher'");
      stagingDb.pragma(`rekey = "x'${this.rawKeyHex}'"`);
    } finally {
      stagingDb.close();
    }
    fsyncPath(this.stagingPath);
    fsyncDirectory(path.dirname(this.stagingPath));
  }

  private stepVerifyEncryptedTarget() {
    const db = new Database(this.stagingPath);
    try {
      db.pragma("cipher = 'sqlcipher'");
      db.pragma(`key = "x'${this.rawKeyHex}'"`);

      // 1. cipher_integrity_check
      const cipherCheck = db.pragma('cipher_integrity_check') as unknown[];
      if (cipherCheck.length > 0) {
        throw new Error(
          `cipher_integrity_check failed on encrypted staging: ${JSON.stringify(cipherCheck)}`,
        );
      }

      // 2. quick_check
      const quickCheck = db.pragma('quick_check', { simple: true });
      if (quickCheck !== 'ok') {
        throw new Error(
          `quick_check failed on encrypted staging: ${quickCheck}`,
        );
      }

      // 3. foreign_key_check
      const foreignKeyCheck = db.pragma('foreign_key_check') as unknown[];
      if (foreignKeyCheck.length > 0) {
        throw new Error(
          `foreign_key_check failed on encrypted staging: ${JSON.stringify(foreignKeyCheck)}`,
        );
      }

      // Source database comparison
      const originalDb = new Database(this.databasePath);
      try {
        // 4. user_version match
        const origUserVer = originalDb.pragma('user_version', { simple: true });
        const targetUserVer = db.pragma('user_version', { simple: true });
        if (origUserVer !== targetUserVer) {
          throw new Error(
            `user_version mismatch: expected ${origUserVer}, found ${targetUserVer}`,
          );
        }

        // 5. Full schema DDL parity
        const origSchema = originalDb
          .prepare(
            `SELECT type, name, tbl_name, sql FROM sqlite_schema
             WHERE name NOT LIKE 'sqlite_%'
             ORDER BY type, name`,
          )
          .all() as Array<{
          type: string;
          name: string;
          tbl_name: string;
          sql: string | null;
        }>;

        const targetSchema = db
          .prepare(
            `SELECT type, name, tbl_name, sql FROM sqlite_schema
             WHERE name NOT LIKE 'sqlite_%'
             ORDER BY type, name`,
          )
          .all() as Array<{
          type: string;
          name: string;
          tbl_name: string;
          sql: string | null;
        }>;

        if (origSchema.length !== targetSchema.length) {
          throw new Error(
            `Schema item count mismatch: source has ${origSchema.length}, target has ${targetSchema.length}`,
          );
        }

        const targetSchemaMap = new Map(
          targetSchema.map((item) => [`${item.type}:${item.name}`, item.sql]),
        );

        for (const item of origSchema) {
          const key = `${item.type}:${item.name}`;
          if (!targetSchemaMap.has(key)) {
            throw new Error(
              `Target encrypted DB is missing schema object: ${key}`,
            );
          }
          if (targetSchemaMap.get(key) !== item.sql) {
            throw new Error(`Schema mismatch for ${key}`);
          }
        }

        // 6. Drizzle migrations parity
        const origTables = origSchema
          .filter((s) => s.type === 'table')
          .map((s) => s.name);

        if (origTables.includes('__drizzle_migrations')) {
          const origDigest = computeTableDigest(
            originalDb,
            '__drizzle_migrations',
          );
          const targetDigest = computeTableDigest(db, '__drizzle_migrations');
          if (origDigest !== targetDigest) {
            throw new Error(
              'Drizzle migration records mismatch between source and target',
            );
          }
        }

        // 7. Table row counts
        for (const table of origTables) {
          const origCount = (
            originalDb
              .prepare(`SELECT COUNT(*) as count FROM "${table}"`)
              .get() as {
              count: number;
            }
          ).count;
          const targetCount = (
            db.prepare(`SELECT COUNT(*) as count FROM "${table}"`).get() as {
              count: number;
            }
          ).count;
          if (origCount !== targetCount) {
            throw new Error(
              `Row count mismatch for table ${table}: source ${origCount}, target ${targetCount}`,
            );
          }
        }

        // 8. Content digests for all user tables (streaming with bounded memory)
        for (const table of origTables) {
          const origHash = computeTableDigest(originalDb, table);
          const targetHash = computeTableDigest(db, table);
          if (origHash !== targetHash) {
            throw new Error(`Content digest mismatch for table ${table}`);
          }
        }
      } finally {
        originalDb.close();
      }
    } finally {
      db.close();
    }
  }

  private stepStagePlaintextArtifacts(backupDir: string): void {
    const relatedFiles = [
      this.databasePath,
      `${this.databasePath}-wal`,
      `${this.databasePath}-shm`,
      `${this.databasePath}-journal`,
    ];

    for (const file of relatedFiles) {
      if (fs.existsSync(file)) {
        const dest = path.join(backupDir, path.basename(file));
        fs.renameSync(file, dest);
      }
    }
    fsyncDirectory(backupDir);
    fsyncDirectory(path.dirname(this.databasePath));
  }

  private recoverOrphanedPlaintextBackups(): void {
    const dir = path.dirname(this.databasePath);
    const base = path.basename(this.databasePath);
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (
          (entry.startsWith(`${base}.plaintext-migration-backup-`) ||
            entry === `${base}.migration-backup`) &&
          fs.statSync(path.join(dir, entry)).isDirectory()
        ) {
          const candidateBackupDir = path.join(dir, entry);
          this.restoreFromBackup(candidateBackupDir);
        }
      }
    } catch (error) {
      if (error instanceof DatabaseLifecycleError) throw error;
      throw new DatabaseLifecycleError(
        'database_restore_failed',
        `Failed scanning for orphaned plaintext backups in ${dir}: ${error instanceof Error ? error.message : String(error)}`,
        {},
        { cause: error },
      );
    }
  }

  private stepActivateTarget() {
    fs.renameSync(this.stagingPath, this.databasePath);
    fsyncPath(this.databasePath);
    fsyncDirectory(path.dirname(this.databasePath));
  }

  private stepReopenAndVerify() {
    const db = new Database(this.databasePath);
    try {
      db.pragma("cipher = 'sqlcipher'");
      db.pragma(`key = "x'${this.rawKeyHex}'"`);
      const cipherCheck = db.pragma('cipher_integrity_check') as unknown[];
      if (cipherCheck.length > 0) {
        throw new Error(
          `Reopened database cipher_integrity_check failed: ${JSON.stringify(cipherCheck)}`,
        );
      }
      const quickCheck = db.pragma('quick_check', { simple: true });
      if (quickCheck !== 'ok') {
        throw new Error(`Reopened database quick_check failed: ${quickCheck}`);
      }
    } finally {
      db.close();
    }
  }

  private restoreFromBackup(backupDir: string): void {
    if (!fs.existsSync(backupDir)) return;
    try {
      const files = fs.readdirSync(backupDir);
      const dbDir = path.dirname(this.databasePath);
      for (const file of files) {
        const src = path.join(backupDir, file);
        const dest = path.join(dbDir, file);
        fs.renameSync(src, dest);
        fsyncPath(dest);
      }
      fs.rmSync(backupDir, { recursive: true, force: true });
      fsyncDirectory(dbDir);
    } catch (error) {
      throw error instanceof DatabaseLifecycleError
        ? error
        : new DatabaseLifecycleError(
            'database_restore_failed',
            `Failed to restore database from backup directory ${backupDir}: ${error instanceof Error ? error.message : String(error)}`,
            {},
            { cause: error },
          );
    }
  }
}
