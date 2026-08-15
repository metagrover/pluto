import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  loadPrivateTranscriptionBenchmarkManifest,
  summarizePrivateTranscriptionManifest,
} from '../src/services/privateTranscriptionBenchmark.ts';

const readOption = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`${name} is required.`);
  }
  return process.argv[index + 1];
};

const manifestPath = path.resolve(readOption('--manifest'));
const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
const summary = summarizePrivateTranscriptionManifest(
  loadPrivateTranscriptionBenchmarkManifest(raw),
);
console.log(JSON.stringify(summary));
