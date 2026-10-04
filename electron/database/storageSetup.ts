import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isPlaintextSqliteDatabase } from './encryptionMigration';
import { DatabaseLifecycleError } from './errors';

export type DatabaseStorageMode = 'standard' | 'encrypted';
type StorageChoice = {
  version: 1;
  mode: DatabaseStorageMode;
  initialized: boolean;
};

const choicePath = (databasePath: string) =>
  path.join(path.dirname(databasePath), 'database-storage.json');

const readChoice = (databasePath: string): StorageChoice | null => {
  const filePath = choicePath(databasePath);
  if (!fs.existsSync(filePath)) return null;
  try {
    const choice = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (
      choice?.version !== 1 ||
      (choice.mode !== 'standard' && choice.mode !== 'encrypted') ||
      typeof choice.initialized !== 'boolean'
    ) {
      throw new Error('Invalid storage choice');
    }
    return choice;
  } catch (cause) {
    throw new DatabaseLifecycleError(
      'database_configuration_failed',
      'The saved database storage choice could not be read. No data was changed.',
      {},
      { cause },
    );
  }
};

const writeChoice = (databasePath: string, choice: StorageChoice) => {
  const filePath = choicePath(databasePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporaryPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(choice));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporaryPath, filePath);
    const directory = fs.openSync(path.dirname(filePath), 'r');
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
};

// A saved choice is authoritative. Legacy profiles keep their actual format.
// Missing/corrupt data must never be mistaken for a new installation.
export const resolveDatabaseStorageMode = (
  databasePath: string,
): DatabaseStorageMode | null => {
  const choice = readChoice(databasePath);
  if (fs.existsSync(databasePath)) {
    if (fs.statSync(databasePath).size < 16) {
      throw new DatabaseLifecycleError(
        'database_integrity_failed',
        'The existing database is incomplete. No new database was created.',
      );
    }
    const mode = isPlaintextSqliteDatabase(databasePath)
      ? 'standard'
      : 'encrypted';
    if (choice && choice.mode !== mode) {
      throw new DatabaseLifecycleError(
        'database_configuration_failed',
        'The database format does not match its saved storage choice.',
      );
    }
    return mode;
  }
  const dir = path.dirname(databasePath);
  const base = path.basename(databasePath);
  const hasExistingArtifacts =
    fs.existsSync(dir) &&
    fs
      .readdirSync(dir)
      .some(
        (name) =>
          name.startsWith(`${base}-`) ||
          name.startsWith(`${base}.`) ||
          name === 'app-key-envelope.json' ||
          name === 'app-recovery-key.json' ||
          name === 'meetings' ||
          name === 'secure-settings.json',
      );
  if (choice?.initialized || (!choice && hasExistingArtifacts)) {
    throw new DatabaseLifecycleError(
      'database_restore_failed',
      'An existing profile is missing its database. Its artifacts were preserved.',
    );
  }
  if (choice?.mode === 'encrypted' && !hasExistingArtifacts) {
    // Interrupted before obtaining a key: onboarding is still uncommitted.
    return null;
  }
  return choice?.mode ?? null;
};

export const initializeDatabaseStorageSetup = (input: {
  databasePath: string;
  chooseMode: () => DatabaseStorageMode | null;
  prepareEncryption: () => void;
  initialize: (mode: DatabaseStorageMode) => void;
}): DatabaseStorageMode | null => {
  let mode = resolveDatabaseStorageMode(input.databasePath);
  if (mode === null) {
    mode = input.chooseMode();
    if (mode === null) return null;
    // Persist intent before creating a key so a crash cannot leave an orphaned
    // key that looks like an existing profile with a missing database.
    writeChoice(input.databasePath, { version: 1, mode, initialized: false });
    if (mode === 'encrypted') {
      // Do not create a database until permission succeeds.
      try {
        input.prepareEncryption();
      } catch (cause) {
        if (resolveDatabaseStorageMode(input.databasePath) === null) {
          fs.unlinkSync(choicePath(input.databasePath));
        }
        throw new DatabaseLifecycleError(
          'database_setup_key_unavailable',
          'Encrypted setup needs permission to store its key.',
          {},
          { cause },
        );
      }
    }
  }
  input.initialize(mode);
  const choice = readChoice(input.databasePath);
  if (choice && !choice.initialized) {
    writeChoice(input.databasePath, { ...choice, initialized: true });
  }
  return mode;
};
