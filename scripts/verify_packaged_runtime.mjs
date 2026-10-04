import { execFileSync } from 'node:child_process';
import { constants, existsSync, readFileSync, statSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { verifyMediaExecutable } from './verify_media_executable.mjs';

const requestedPath = process.argv
  .slice(2)
  .find((argument) => argument !== '--');
const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
const appPath = path.resolve(
  requestedPath ?? `release/${packageVersion}/mac-arm64/Pluto.app`,
);
const resourcesRoot = path.join(appPath, 'Contents', 'Resources');
const resourcesPath = path.join(resourcesRoot, 'bin');
const plistValue = (plist, key) =>
  execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', plist], {
    encoding: 'utf8',
  }).trim();
const appInfo = path.join(appPath, 'Contents', 'Info.plist');
for (const key of [
  'NSMicrophoneUsageDescription',
  'NSAudioCaptureUsageDescription',
  'NSCalendarsFullAccessUsageDescription',
]) {
  if (!plistValue(appInfo, key))
    throw new Error(`Missing permission purpose: ${key}`);
}
execFileSync('codesign', ['--verify', '--deep', '--strict', appPath]);
const entitlements = execFileSync(
  'codesign',
  ['--display', '--entitlements', ':-', appPath],
  { encoding: 'utf8' },
);
if (
  !/<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\s*\/>/.test(
    entitlements,
  )
) {
  throw new Error('Packaged app lacks microphone entitlement.');
}
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
