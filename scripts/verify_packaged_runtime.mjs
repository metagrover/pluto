import { constants, existsSync, readFileSync, statSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { verifyMediaExecutable } from './verify_media_executable.mjs';

const requestedPath = process.argv
  .slice(2)
  .find((argument) => argument !== '--');
const appPath = path.resolve(
  requestedPath ?? 'release/0.1.0/mac-arm64/Pluto.app',
);
const resourcesRoot = path.join(appPath, 'Contents', 'Resources');
const resourcesPath = path.join(resourcesRoot, 'bin');
const iconName = execFileSync(
  'plutil',
  [
    '-extract',
    'CFBundleIconFile',
    'raw',
    '-o',
    '-',
    path.join(appPath, 'Contents', 'Info.plist'),
  ],
  { encoding: 'utf8' },
).trim();
if (iconName !== 'icon.icns') {
  throw new Error(`Packaged app has the wrong icon: ${iconName}`);
}
const packagedIcon = readFileSync(path.join(resourcesRoot, iconName));
const sourceIcon = readFileSync(path.resolve('build/pluto.icns'));
if (
  packagedIcon.subarray(0, 4).toString('ascii') !== 'icns' ||
  !packagedIcon.equals(sourceIcon)
) {
  throw new Error('Packaged app is missing the Pluto icon.');
}
const requiredExecutables = [
  'audiocap',
  'parakeet-runtime',
  'parakeet-resource-probe',
  'PlutoCalendarHelper.app/Contents/MacOS/PlutoCalendarHelper',
];

for (const retiredPath of [
  path.join(resourcesPath, 'recorder'),
  path.join(resourcesRoot, 'app.asar.unpacked', 'dist-electron', 'python'),
  path.join(
    resourcesRoot,
    'app.asar.unpacked',
    'dist-electron',
    'resources',
    'bin',
    'whisperx_server',
  ),
]) {
  if (existsSync(retiredPath)) {
    throw new Error(`Packaged app contains retired runtime: ${retiredPath}`);
  }
}

for (const relativePath of requiredExecutables) {
  const executablePath = path.join(resourcesPath, relativePath);
  if (!statSync(executablePath).isFile()) {
    throw new Error(`Packaged runtime is not a file: ${relativePath}`);
  }
  await access(executablePath, constants.X_OK);
}

const calendarInfo = readFileSync(
  path.join(resourcesPath, 'PlutoCalendarHelper.app', 'Contents', 'Info.plist'),
  'utf8',
);
if (!calendarInfo.includes('NSCalendarsFullAccessUsageDescription')) {
  throw new Error('Packaged Calendar helper is missing its purpose string.');
}

const executableSuffix = process.platform === 'win32' ? '.exe' : '';
const mediaTools = [
  ['ffmpeg', path.join('ffmpeg-static', `ffmpeg${executableSuffix}`)],
  [
    'ffprobe',
    path.join(
      '@ffprobe-installer',
      `${process.platform}-${process.arch}`,
      `ffprobe${executableSuffix}`,
    ),
  ],
];
for (const [name, relativePath] of mediaTools) {
  const executablePath = path.join(
    resourcesRoot,
    'app.asar.unpacked',
    'node_modules',
    relativePath,
  );
  if (!statSync(executablePath).isFile()) {
    throw new Error(`Packaged media tool is not a file: ${name}`);
  }
  await access(executablePath, constants.X_OK);
  await verifyMediaExecutable(executablePath, name);
}

console.log(
  `Verified Pluto icon and ${requiredExecutables.length + mediaTools.length} packaged runtimes.`,
);
