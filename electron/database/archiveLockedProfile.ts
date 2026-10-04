import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isPlaintextSqliteDatabase } from './encryptionMigration';

/** Move a locked encrypted profile aside without opening or modifying its data. */
export const archiveLockedProfile = (profileDir: string): string => {
  const resolved = path.resolve(profileDir);
  const parent = path.dirname(resolved);
  const name = path.basename(resolved);
  if (parent === resolved || name === '.' || name === '..') {
    throw new Error('Invalid profile directory');
  }
  const profile = fs.lstatSync(resolved);
  const databasePath = path.join(resolved, 'pluto.db');
  if (
    !profile.isDirectory() ||
    profile.isSymbolicLink() ||
    !fs.existsSync(databasePath) ||
    !fs.lstatSync(databasePath).isFile() ||
    fs.statSync(databasePath).size < 16 ||
    isPlaintextSqliteDatabase(databasePath)
  ) {
    throw new Error('Only an existing encrypted profile can be archived here');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = path.join(
    parent,
    `${name}-archive-${timestamp}-${randomUUID()}`,
  );
  if (fs.existsSync(archivePath)) {
    throw new Error('Archive destination already exists');
  }
  fs.renameSync(resolved, archivePath);
  try {
    fs.mkdirSync(resolved, { mode: 0o700 });
  } catch (error) {
    // The old path is still unoccupied here, so put the profile back.
    if (!fs.existsSync(resolved)) fs.renameSync(archivePath, resolved);
    throw error;
  }
  return archivePath;
};
