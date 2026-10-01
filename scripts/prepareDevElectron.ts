import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/** Return a module that vite-plugin-electron can use as its Electron executable. */
export function prepareDevElectron(): string {
  if (process.platform !== 'darwin') return 'electron';

  const electronExecutable = require('electron') as string;
  const sourceApp = path.resolve(electronExecutable, '../../../');
  const sourceInfo = path.join(sourceApp, 'Contents', 'Info.plist');
  const sourceStats = fs.statSync(sourceInfo);
  const executableStats = fs.statSync(electronExecutable);
  const fingerprint = createHash('sha256')
    .update(
      `${sourceApp}:${sourceStats.mtimeMs}:${executableStats.size}:pluto-dev-v1`,
    )
    .digest('hex')
    .slice(0, 12);
  const cacheDir = path.join(
    path.dirname(sourceApp),
    '..',
    '..',
    '.cache',
    'pluto-electron',
    fingerprint,
  );
  const brandedApp = path.join(cacheDir, 'Pluto.app');
  const brandedExecutable = path.join(
    brandedApp,
    'Contents',
    'MacOS',
    'Electron',
  );
  const entry = path.join(cacheDir, 'electron-entry.mjs');
  if (!fs.existsSync(brandedExecutable)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const stagingApp = path.join(cacheDir, `Pluto-staging-${process.pid}.app`);
    try {
      try {
        execFileSync('cp', ['-cR', sourceApp, stagingApp]);
      } catch {
        fs.rmSync(stagingApp, { recursive: true, force: true });
        fs.cpSync(sourceApp, stagingApp, { recursive: true });
      }
      const plist = path.join(stagingApp, 'Contents', 'Info.plist');
      for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
        execFileSync('/usr/libexec/PlistBuddy', [
          '-c',
          `Set :${key} Pluto`,
          plist,
        ]);
      }
      // npm's development Electron.app may itself have an unverifiable signature.
      // Re-sign only when its original bundle verifies; always leave it untouched.
      if (spawnSync('codesign', ['--verify', sourceApp]).status === 0) {
        execFileSync('codesign', [
          '--force',
          '--deep',
          '--sign',
          '-',
          '--preserve-metadata=entitlements',
          stagingApp,
        ]);
        execFileSync('codesign', ['--verify', '--deep', stagingApp]);
      }
      fs.renameSync(stagingApp, brandedApp);
    } catch (error) {
      fs.rmSync(stagingApp, { recursive: true, force: true });
      throw error;
    }
  }
  fs.writeFileSync(
    entry,
    `export default ${JSON.stringify(brandedExecutable)};\n`,
  );
  return entry;
}
