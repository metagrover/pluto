import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const EXPECTED_IDENTIFIER = 'com.pluto.app';

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

export const main = () => {
  const appPath = resolveInstalledPlutoApp({
    platform: process.platform,
    override: process.env.PLUTO_SIGNED_APP_PATH,
  });
  verifySignedPlutoApp({ appPath });
  console.log(`Opening signed Pluto: ${appPath}`);
  launchSignedPlutoApp({ appPath });
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
