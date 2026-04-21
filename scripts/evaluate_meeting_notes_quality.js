#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import {
  scoreMeetingNotesQuality,
  summarizeQualityResults,
} from './lib/meeting_notes_quality.js';

const cwd = process.cwd();

const readJson = (targetPath) => {
  const raw = fs.readFileSync(targetPath, 'utf8');
  return JSON.parse(raw);
};

const parseArgs = (argv) => {
  const args = { fixture: null, fixturesDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fixture') {
      args.fixture = argv[i + 1] || null;
      i += 1;
    } else if (arg === '--fixtures-dir') {
      args.fixturesDir = argv[i + 1] || null;
      i += 1;
    }
  }
  return args;
};

const collectFixturePaths = ({ fixture, fixturesDir }) => {
  if (fixture) {
    return [path.resolve(cwd, fixture)];
  }

  const targetDir = path.resolve(
    cwd,
    fixturesDir || 'scripts/baselines/meeting-notes-quality',
  );
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Fixtures directory not found: ${targetDir}`);
  }
  return fs
    .readdirSync(targetDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => path.join(targetDir, entry));
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const fixturePaths = collectFixturePaths(args);
  const results = fixturePaths.map((fixturePath) =>
    scoreMeetingNotesQuality(readJson(fixturePath)),
  );

  const output = {
    generated_at: new Date().toISOString(),
    fixtures: fixturePaths,
    summary: summarizeQualityResults(results),
    results,
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
};

main();
