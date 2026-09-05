import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  adoptLegacyDatabase,
  backupLegacyDatabase,
} from '../electron/database/adoption';

const defaultUserDataDir = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'pluto',
);
const targetDb = process.argv[2] || path.join(defaultUserDataDir, 'pluto.db');
const sourceBackup = process.argv[3] || null;

console.log(`Target database: ${targetDb}`);
if (sourceBackup) {
  console.log(`Restoring from source backup: ${sourceBackup}`);
  if (!fs.existsSync(sourceBackup)) {
    console.error(`Source backup does not exist: ${sourceBackup}`);
    process.exit(1);
  }
  fs.copyFileSync(sourceBackup, targetDb);
  const wal = `${sourceBackup}-wal`;
  const shm = `${sourceBackup}-shm`;
  if (fs.existsSync(wal)) fs.copyFileSync(wal, `${targetDb}-wal`);
  else if (fs.existsSync(`${targetDb}-wal`)) fs.unlinkSync(`${targetDb}-wal`);
  if (fs.existsSync(shm)) fs.copyFileSync(shm, `${targetDb}-shm`);
  else if (fs.existsSync(`${targetDb}-shm`)) fs.unlinkSync(`${targetDb}-shm`);
}

if (!fs.existsSync(targetDb)) {
  console.error(`Target database does not exist: ${targetDb}`);
  process.exit(1);
}

const backup = backupLegacyDatabase(targetDb);
if (backup) {
  console.log(`Created pre-adoption safety backup at: ${backup}`);
}

const migrationsFolder = path.resolve('drizzle');
const sqlite = new Database(targetDb);
try {
  adoptLegacyDatabase({ sqlite, migrationsFolder });
  const qc = sqlite.pragma('quick_check', { simple: true });
  const fk = sqlite.pragma('foreign_key_check') as unknown[];
  if (qc !== 'ok' || fk.length > 0) {
    throw new Error(`Health verification failed: quick_check=${qc}, fk_errors=${fk.length}`);
  }
  console.log('Successfully adopted legacy database into Drizzle lifecycle!');
  const meetingCount = sqlite.prepare('SELECT count(*) as count FROM meetings').get() as { count: number };
  console.log(`Preserved ${meetingCount.count} meetings.`);
} finally {
  sqlite.close();
}
