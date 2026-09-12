import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const EXPECTED_IDENTIFIER = 'com.pluto.app';
const RECOVERY_KEY_FILE_NAME = 'app-recovery-key.json';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const run = (spawn, command, args, options = {}) => {
  const result = spawn(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit ${result.status}.`);
  }
  return result;
};

export const resolveInstalledPlutoApp = ({
  platform,
  applicationsDir = '/Applications',
  override,
}) => {
  if (platform !== 'darwin') {
    throw new Error('pnpm start currently supports macOS only.');
  }
  return override?.trim()
    ? path.resolve(override.trim())
    : path.join(applicationsDir, 'Pluto.app');
};

export const resolveProductionProfile = ({ platform, homeDir }) => {
  if (platform !== 'darwin') {
    throw new Error('pnpm start currently supports macOS only.');
  }
  return path.join(homeDir, 'Library', 'Application Support', 'pluto');
};

const isCanonical32ByteBase64 = (value) => {
  if (typeof value !== 'string') return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 32 && decoded.toString('base64') === value;
};

export const hasValidRecoveryKeyFile = ({
  userDataDir,
  expectedUid = process.getuid?.(),
}) => {
  const recoveryPath = path.join(userDataDir, RECOVERY_KEY_FILE_NAME);
  if (!existsSync(recoveryPath)) return false;
  try {
    const stat = lstatSync(recoveryPath);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size > 4096 ||
      (stat.mode & 0o777) !== 0o600 ||
      (expectedUid !== undefined && stat.uid !== expectedUid)
    ) {
      return false;
    }
    const parsed = JSON.parse(readFileSync(recoveryPath, 'utf8'));
    return (
      parsed?.version === 1 &&
      parsed.purpose === 'pluto-database-recovery' &&
      typeof parsed.keyId === 'string' &&
      UUID_PATTERN.test(parsed.keyId) &&
      isCanonical32ByteBase64(parsed.key) &&
      isCanonical32ByteBase64(parsed.salt) &&
      Object.keys(parsed).sort().join(',') === 'key,keyId,purpose,salt,version'
    );
  } catch {
    return false;
  }
};

export const verifySignedPlutoApp = ({
  appPath,
  exists = existsSync,
  spawn = spawnSync,
}) => {
  if (!exists(appPath)) {
    throw new Error(`Signed Pluto app not found: ${appPath}`);
  }
  run(spawn, '/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
  const details = run(
    spawn,
    '/usr/bin/codesign',
    ['--display', '--verbose=4', appPath],
    { encoding: 'utf8' },
  );
  const output = `${details.stdout || ''}\n${details.stderr || ''}`;
  const identifier = /^Identifier=(.+)$/m.exec(output)?.[1]?.trim();
  const teamIdentifier = /^TeamIdentifier=(.+)$/m.exec(output)?.[1]?.trim();
  if (
    /Signature=adhoc/i.test(output) ||
    !/^Authority=.+$/m.test(output) ||
    !teamIdentifier ||
    teamIdentifier === 'not set' ||
    identifier !== EXPECTED_IDENTIFIER
  ) {
    throw new Error(
      'Refusing to open production data with an unsigned or incorrectly identified Pluto app.',
    );
  }
  return { identifier, teamIdentifier };
};

export const launchSignedPlutoApp = ({ appPath, spawn = spawnSync }) => {
  run(spawn, '/usr/bin/open', [appPath], { stdio: 'inherit' });
};

export const launchRecoveryDevelopmentApp = ({
  userDataDir,
  environment = process.env,
  spawn = spawnSync,
}) => {
  run(spawn, 'pnpm', ['exec', 'vite'], {
    env: {
      ...environment,
      PLUTO_ALLOW_RECOVERY_PROFILE: '1',
      PLUTO_USER_DATA_DIR: userDataDir,
    },
    stdio: 'inherit',
  });
};

export const main = () => {
  const appPath = resolveInstalledPlutoApp({
    platform: process.platform,
    override: process.env.PLUTO_SIGNED_APP_PATH,
  });
  try {
    verifySignedPlutoApp({ appPath });
    console.log(`Opening signed Pluto: ${appPath}`);
    launchSignedPlutoApp({ appPath });
    return;
  } catch (signedAppError) {
    const userDataDir = resolveProductionProfile({
      platform: process.platform,
      homeDir: os.homedir(),
    });
    if (!hasValidRecoveryKeyFile({ userDataDir })) throw signedAppError;
    console.warn(
      'Opening Pluto with the temporary owner-only recovery key. Rewrap this key into signed Pluto Keychain storage before deleting the recovery file.',
    );
    launchRecoveryDevelopmentApp({ userDataDir });
  }
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
