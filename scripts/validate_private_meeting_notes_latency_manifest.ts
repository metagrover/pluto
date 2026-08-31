import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  parsePrivateMeetingNotesLatencyManifest,
  summarizePrivateMeetingNotesLatencyManifest,
} from './lib/meeting_notes_latency_benchmark.ts';

const option = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const manifestPath = path.resolve(option('--manifest'));
const manifest = parsePrivateMeetingNotesLatencyManifest(
  JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown,
);
console.log(
  JSON.stringify(summarizePrivateMeetingNotesLatencyManifest(manifest)),
);
