import { execFileSync } from 'node:child_process';
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
      `${sourceApp}:${sourceStats.mtimeMs}:${executableStats.size}:pluto-dev-v2-calendar-permissions`,
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
      // Some npm/archive installs expand framework symlinks into duplicate
      // directories. Restore the versioned layout in our copy before signing.
      const frameworks = path.join(stagingApp, 'Contents', 'Frameworks');
      for (const name of fs
        .readdirSync(frameworks)
        .filter((name) => name.endsWith('.framework'))) {
        const framework = path.join(frameworks, name);
        const versions = path.join(framework, 'Versions');
        if (!fs.existsSync(versions)) continue;
        const current = path.join(versions, 'Current');
        if (fs.lstatSync(current).isSymbolicLink()) continue;
        const candidates = fs
          .readdirSync(versions)
          .filter((version) => version !== 'Current');
        if (candidates.length !== 1)
          throw new Error(`Cannot resolve framework version: ${name}`);
        const version = candidates[0];
        fs.rmSync(current, { recursive: true });
        fs.symlinkSync(version, current);
        for (const member of fs.readdirSync(path.join(versions, version))) {
          if (member === '_CodeSignature') continue;
          const target = path.join(framework, member);
          fs.rmSync(target, { recursive: true, force: true });
          fs.symlinkSync(path.join('Versions', 'Current', member), target);
        }
      }
      const plist = path.join(stagingApp, 'Contents', 'Info.plist');
      for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
        execFileSync('/usr/libexec/PlistBuddy', [
          '-c',
          `Set :${key} Pluto`,
          plist,
        ]);
      }
      const purposes: Record<string, string> = {
        NSMicrophoneUsageDescription:
          'Pluto records your voice for meeting transcription.',
        NSAudioCaptureUsageDescription:
          'Pluto records system audio for meeting transcription.',
        NSCalendarsFullAccessUsageDescription:
          'Pluto reads local meeting titles, times, and participants.',
        NSCalendarsUsageDescription:
          'Pluto reads local meeting titles, times, and participants.',
      };
      for (const [key, value] of Object.entries(purposes)) {
        // Add absent keys and replace Electron's generic descriptions.
        try {
          execFileSync(
            '/usr/libexec/PlistBuddy',
            ['-c', `Delete :${key}`, plist],
            { stdio: 'ignore' },
          );
        } catch {}
        execFileSync('/usr/libexec/PlistBuddy', [
          '-c',
          `Add :${key} string ${value}`,
          plist,
        ]);
      }
      // Sign the copy after changing metadata, even if npm's original signature
      // is invalid. Never modify the original Electron bundle.
      execFileSync('codesign', [
        '--force',
        '--deep',
        '--sign',
        '-',
        '--entitlements',
        path.resolve('build/entitlements.mac.plist'),
        stagingApp,
      ]);
      execFileSync('codesign', ['--verify', '--deep', '--strict', stagingApp]);
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
