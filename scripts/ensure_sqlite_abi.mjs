import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const commandSucceeded = (command, args, options = {}) =>
  spawnSync(command, args, options).status === 0;

const probeElectronBinding = () =>
  commandSucceeded(
    pnpmCommand,
    [
      'exec',
      'electron',
      '-e',
      "const Database=require('better-sqlite3');const db=new Database(':memory:');db.close();try{const McDatabase=require('better-sqlite3-multiple-ciphers');const mcdb=new McDatabase(':memory:');mcdb.close();}catch(e){process.exit(1);}",
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
    },
  );

const rebuildElectronBinding = () =>
  commandSucceeded(
    pnpmCommand,
    [
      'exec',
      'electron-rebuild',
      '-f',
      '-w',
      'better-sqlite3,better-sqlite3-multiple-ciphers',
    ],
    { stdio: 'inherit' },
  );

export const ensureElectronSqliteAbi = ({
  probe = probeElectronBinding,
  rebuild = rebuildElectronBinding,
  log = console.log,
} = {}) => {
  if (probe()) {
    log('Electron SQLite binding is current; skipping rebuild.');
    return 'current';
  }

  log(
    'Electron SQLite binding is missing or incompatible; rebuilding it before launch.',
  );
  if (!rebuild()) throw new Error('Electron SQLite ABI rebuild failed');
  if (!probe()) {
    throw new Error('Electron SQLite ABI verification failed after rebuild');
  }

  log('Electron SQLite binding rebuilt and verified.');
  return 'rebuilt';
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    ensureElectronSqliteAbi();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
