import { constants, statSync } from 'node:fs';
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
];

for (const relativePath of requiredExecutables) {
  const executablePath = path.join(resourcesPath, relativePath);
  if (!statSync(executablePath).isFile()) {
    throw new Error(`Packaged runtime is not a file: ${relativePath}`);
  }
  await access(executablePath, constants.X_OK);
}

console.log(`Verified ${requiredExecutables.length} packaged runtimes.`);
