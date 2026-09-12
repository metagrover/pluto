import { rm } from 'node:fs/promises';
import path from 'node:path';

const generatedPaths = [
  path.resolve('dist-electron-package'),
  path.resolve('resources/bin/recorder'),
];

for (const generatedPath of generatedPaths) {
  await rm(generatedPath, { recursive: true, force: true });
  console.log(`Cleaned generated output: ${generatedPath}`);
}
