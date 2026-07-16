import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  buildPrivateSpeakerAttributionManifestSummary,
  loadPrivateSpeakerAttributionManifest,
} from '../src/services/privateSpeakerAttributionBenchmark.ts';

type CliOptions = {
  manifest: string;
  out: string;
};

const parseArgs = (args: string[], cwd: string): CliOptions => {
  const options: CliOptions = {
    manifest: path.join(
      cwd,
      'scripts',
      'recording-quality',
      'private-speaker-attribution-manifest.json',
    ),
    out: path.join(
      cwd,
      'tmp',
      'private-speaker-attribution-manifest-summary.json',
    ),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if ((arg === '--manifest' || arg === '--out') && index + 1 < args.length) {
      const value = args[index + 1];
      if (arg === '--manifest') options.manifest = value;
      if (arg === '--out') options.out = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
};

const main = () => {
  const options = parseArgs(process.argv.slice(2), process.cwd());
  const manifestPath = path.resolve(options.manifest);
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
  const manifest = loadPrivateSpeakerAttributionManifest(raw);
  const summary = buildPrivateSpeakerAttributionManifestSummary(manifest);

  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(
    options.out,
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );

  console.log(
    `[PrivateSpeakerAttributionBenchmark] validated ${summary.totalCases} cases`,
  );
  console.log(
    `[PrivateSpeakerAttributionBenchmark] speakers=${summary.speakerSet.join(',')}`,
  );
  console.log(`[PrivateSpeakerAttributionBenchmark] wrote ${options.out}`);
};

main();
