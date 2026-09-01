import { spawnSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const run = (spawn, command, args, options) => {
  const result = spawn(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit ${result.status}.`);
  }
  return result;
};

const verifyBackup = (backupPath, spawn) => {
  const result = run(
    spawn,
    'sqlite3',
    ['-readonly', backupPath, 'PRAGMA quick_check;'],
    { encoding: 'utf8' },
  );
  if (result.stdout?.trim() !== 'ok') {
    throw new Error(
      `Production-profile recovery snapshot failed integrity check: ${backupPath}`,
    );
  }
};

export const resolveProductionProfile = ({ platform, homeDir }) => {
  if (platform !== 'darwin') {
    throw new Error('pnpm start currently supports macOS only.');
  }
  return path.join(homeDir, 'Library', 'Application Support', 'pluto');
};

export const createProductionBackup = ({
  userDataDir,
  exists = existsSync,
  spawn = spawnSync,
  rename = renameSync,
  processId = process.pid,
}) => {
  const databasePath = path.join(userDataDir, 'pluto.db');
  const backupPath = path.join(
    userDataDir,
    'pluto.db.before-pnpm-start.backup',
  );
  if (!exists(databasePath)) {
    throw new Error(`Pluto production database not found: ${databasePath}`);
  }
  if (exists(backupPath)) {
    verifyBackup(backupPath, spawn);
    return 'existing';
  }

  const temporaryPath = `${backupPath}.in-progress-${processId}`;
  if (exists(temporaryPath)) {
    throw new Error(
      `Incomplete recovery snapshot already exists: ${temporaryPath}`,
    );
  }
  const escapedTemporaryPath = temporaryPath.replaceAll("'", "''");
  run(
    spawn,
    'sqlite3',
    [databasePath, `VACUUM INTO '${escapedTemporaryPath}'`],
    { stdio: 'inherit' },
  );
  verifyBackup(temporaryPath, spawn);
  rename(temporaryPath, backupPath);
  return 'created';
};

export const launchDevelopmentApp = ({
  userDataDir,
  environment = process.env,
  spawn = spawnSync,
}) => {
  run(spawn, 'pnpm', ['exec', 'vite'], {
    env: { ...environment, PLUTO_USER_DATA_DIR: userDataDir },
    stdio: 'inherit',
  });
};

export const main = () => {
  const userDataDir = resolveProductionProfile({
    platform: process.platform,
    homeDir: os.homedir(),
  });
  const backup = createProductionBackup({ userDataDir });
  console.log(
    backup === 'created'
      ? `Created recovery snapshot before development access: ${path.join(userDataDir, 'pluto.db.before-pnpm-start.backup')}`
      : 'Production-profile recovery snapshot already exists.',
  );
  console.log(
    `Starting Pluto development with production profile: ${userDataDir}`,
  );
  launchDevelopmentApp({ userDataDir });
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
