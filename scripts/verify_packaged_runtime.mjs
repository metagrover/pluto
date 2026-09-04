import { constants, readFileSync, statSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const requestedPath = process.argv
  .slice(2)
  .find((argument) => argument !== '--');
const appPath = path.resolve(
  requestedPath ?? 'release/0.1.0/mac-arm64/Pluto.app',
);
const resourcesPath = path.join(appPath, 'Contents', 'Resources', 'bin');
const requiredExecutables = [
  'recorder',
  'audiocap',
  'parakeet-runtime',
  'parakeet-resource-probe',
  'PlutoCalendarHelper.app/Contents/MacOS/PlutoCalendarHelper',
];

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

console.log(`Verified ${requiredExecutables.length} packaged runtimes.`);
