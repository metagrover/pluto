import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { DatabaseLifecycleError } from './errors';

export type MigrationStep =
  | 'idle'
  | 'preflight'
  | 'wal_checkpointed'
  | 'source_closed'
  | 'encrypted_exported'
  | 'target_verified'
  | 'artifacts_staged'
  | 'target_activated'
  | 'reopened_and_recovered'
  | 'plaintext_removed'
  | 'complete';

export interface MigrationJournal {
  step: MigrationStep;
  sourcePath: string;
  stagingPath: string;
  backupDir?: string;
  startedAtMs: number;
  updatedAtMs: number;
}

export interface EncryptionMigrationOptions {
  databasePath: string;
  rawDatabaseKeyHex: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export const SQLITE_HEADER = 'SQLite format 3\x00';

export function isPlaintextSqliteDatabase(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    return buffer.toString('utf8') === SQLITE_HEADER;
  } catch {
    return false;
  }
}

export function isEncryptedOrNonPlaintext(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  return !isPlaintextSqliteDatabase(filePath);
}

export class DatabaseEncryptionMigrator {
  private readonly databasePath: string;
  private readonly stagingPath: string;
  private readonly journalPath: string;
  private readonly rawKeyHex: string;
  private readonly logger?: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(options: EncryptionMigrationOptions) {
    this.databasePath = options.databasePath;
    this.stagingPath = `${options.databasePath}.encrypt-staging.db`;
    this.journalPath = `${options.databasePath}.encryption-migration.journal.json`;
    this.rawKeyHex = options.rawDatabaseKeyHex;
    this.logger = options.logger;
  }

  getJournalPath(): string {
    return this.journalPath;
  }

  readJournal(): MigrationJournal | null {
    if (!fs.existsSync(this.journalPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.journalPath, 'utf8'));
    } catch {
      return null;
    }
  }

  writeJournal(journal: MigrationJournal) {
    journal.updatedAtMs = Date.now();
    const tmp = `${this.journalPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(journal, null, 2), 'utf8');
    fs.renameSync(tmp, this.journalPath);
  }

  cleanJournal() {
    try {
      if (fs.existsSync(this.journalPath)) fs.unlinkSync(this.journalPath);
    } catch {}
  }

  cleanStaging() {
    try {
      if (fs.existsSync(this.stagingPath)) fs.unlinkSync(this.stagingPath);
    } catch {}
  }

  /**
   * Resumes an interrupted migration if a journal is present,
   * or starts a fresh migration of the plaintext database.
   */
  migrate(): void {
    let journal = this.readJournal();
    if (journal) {
      this.logger?.warn?.(
        `[EncryptionMigration] Found in-progress migration at step: ${journal.step}`,
      );
      this.resume(journal);
      return;
    }

    if (!isPlaintextSqliteDatabase(this.databasePath)) {
      // Nothing to migrate if not plaintext
      return;
    }

    journal = {
      step: 'preflight',
      sourcePath: this.databasePath,
      stagingPath: this.stagingPath,
      startedAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };
    this.writeJournal(journal);

    this.runSteps(journal);
  }

  private runSteps(journal: MigrationJournal) {
    try {
      // 1. preflight & checkpoint WAL
      if (journal.step === 'preflight') {
        this.stepCheckpointWal();
        journal.step = 'wal_checkpointed';
        this.writeJournal(journal);
      }

      // 2. source closed & copy to staging
      if (journal.step === 'wal_checkpointed') {
        this.stepCopyToStaging();
        journal.step = 'source_closed';
        this.writeJournal(journal);
      }

      // 3. rekey staging file to encrypted
      if (journal.step === 'source_closed') {
        this.stepRekeyStaging();
        journal.step = 'encrypted_exported';
        this.writeJournal(journal);
      }

      // 4. verify encrypted staging database
      if (journal.step === 'encrypted_exported') {
        this.stepVerifyEncryptedTarget();
        journal.step = 'target_verified';
        this.writeJournal(journal);
      }

      // 5. stage original plaintext artifacts into backup directory
      if (journal.step === 'target_verified') {
        const backupDir = this.stepStagePlaintextArtifacts();
        journal.backupDir = backupDir;
        journal.step = 'artifacts_staged';
        this.writeJournal(journal);
      }

      // 6. atomically activate target
      if (journal.step === 'artifacts_staged') {
        this.stepActivateTarget();
        journal.step = 'target_activated';
        this.writeJournal(journal);
      }

      // 7. reopen and verify activated database
      if (journal.step === 'target_activated') {
        this.stepReopenAndVerify();
        journal.step = 'reopened_and_recovered';
        this.writeJournal(journal);
      }

      // 8. clean up staged plaintext backup
      if (journal.step === 'reopened_and_recovered') {
        if (journal.backupDir && fs.existsSync(journal.backupDir)) {
          fs.rmSync(journal.backupDir, { recursive: true, force: true });
        }
        journal.step = 'plaintext_removed';
        this.writeJournal(journal);
      }

      // 9. complete
      journal.step = 'complete';
      this.cleanJournal();
      this.logger?.info?.(
        '[EncryptionMigration] Database encryption migration completed successfully.',
      );
    } catch (error) {
      throw new DatabaseLifecycleError(
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
      journal.step === 'reopened_and_recovered'
    ) {
      // Staging was already moved to main DB. Resume verification and cleanup.
      this.runSteps(journal);
      return;
    }

    // Target was not activated yet. Clean staging and restart cleanly.
    this.cleanStaging();
    if (journal.backupDir && fs.existsSync(journal.backupDir)) {
      // Restore files if they were staged
      this.restoreFromBackup(journal.backupDir);
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
  }

  private stepCopyToStaging() {
    this.cleanStaging();
    fs.copyFileSync(this.databasePath, this.stagingPath);
  }

  private stepRekeyStaging() {
    const stagingDb = new Database(this.stagingPath);
    try {
      stagingDb.pragma("cipher = 'sqlcipher'");
      stagingDb.pragma(`rekey = "x'${this.rawKeyHex}'"`);
    } finally {
      stagingDb.close();
    }
  }

  private stepVerifyEncryptedTarget() {
    const db = new Database(this.stagingPath);
    try {
      db.pragma("cipher = 'sqlcipher'");
      db.pragma(`key = "x'${this.rawKeyHex}'"`);

      const quickCheck = db.pragma('quick_check', { simple: true });
      if (quickCheck !== 'ok') {
        throw new Error(
          `quick_check failed on encrypted target: ${quickCheck}`,
        );
      }

      const foreignKeyCheck = db.pragma('foreign_key_check') as unknown[];
      if (foreignKeyCheck.length > 0) {
        throw new Error(
          `foreign_key_check failed on encrypted target: ${JSON.stringify(foreignKeyCheck)}`,
        );
      }

      // Verify table count parity with original
      const originalDb = new Database(this.databasePath);
      let originalTables: string[];
      try {
        originalTables = (
          originalDb
            .prepare(
              "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .all() as Array<{ name: string }>
        ).map((r) => r.name);
      } finally {
        originalDb.close();
      }

      const targetTables = (
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
          .all() as Array<{ name: string }>
      ).map((r) => r.name);

      for (const table of originalTables) {
        if (!targetTables.includes(table)) {
          throw new Error(`Target encrypted DB missing table: ${table}`);
        }
      }
    } finally {
      db.close();
    }
  }

  private stepStagePlaintextArtifacts(): string {
    const backupDir = `${this.databasePath}.plaintext-migration-backup-${Date.now()}`;
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });

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

    return backupDir;
  }

  private stepActivateTarget() {
    fs.renameSync(this.stagingPath, this.databasePath);
  }

  private stepReopenAndVerify() {
    const db = new Database(this.databasePath);
    try {
      db.pragma("cipher = 'sqlcipher'");
      db.pragma(`key = "x'${this.rawKeyHex}'"`);
      const check = db.pragma('quick_check', { simple: true });
      if (check !== 'ok') {
        throw new Error(
          `Reopened encrypted database failed health check: ${check}`,
        );
      }
    } finally {
      db.close();
    }
  }

  private restoreFromBackup(backupDir: string) {
    if (!fs.existsSync(backupDir)) return;
    const files = fs.readdirSync(backupDir);
    const dbDir = path.dirname(this.databasePath);
    for (const file of files) {
      const src = path.join(backupDir, file);
      const dest = path.join(dbDir, file);
      fs.renameSync(src, dest);
    }
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}
