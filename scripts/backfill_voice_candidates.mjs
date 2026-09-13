#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory =
  process.env.PLUTO_USER_DATA_DIR ||
  path.join(os.homedir(), 'Library', 'Application Support', 'pluto');
const requestPath = path.join(
  directory,
  'voice-candidate-backfill-request.json',
);
const reportPath = path.join(directory, 'voice-candidate-backfill-report.json');
const action = process.argv[2];
if (!['--start', '--status'].includes(action) || process.argv.length !== 3) {
  throw new Error(
    'Usage: node scripts/backfill_voice_candidates.mjs --start|--status',
  );
}
if (action === '--start') {
  if (!fs.existsSync(path.join(directory, 'pluto.db')))
    throw new Error('Pluto profile not found');
  const request = {
    requestId: randomUUID(),
    version: 'single-pass-v2',
    requestedAt: new Date().toISOString(),
  };
  fs.writeFileSync(`${requestPath}.tmp`, JSON.stringify(request), {
    mode: 0o600,
  });
  fs.renameSync(`${requestPath}.tmp`, requestPath);
  console.log(JSON.stringify({ ...request, status: 'requested', reportPath }));
} else if (fs.existsSync(reportPath)) {
  const { meetings, ...summary } = JSON.parse(
    fs.readFileSync(reportPath, 'utf8'),
  );
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  console.log(
    JSON.stringify(
      {
        ...summary,
        stale: summary.requestId !== request.requestId,
        reportPath,
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    'No report yet. Pluto must be running with the backfill consumer.',
  );
}
