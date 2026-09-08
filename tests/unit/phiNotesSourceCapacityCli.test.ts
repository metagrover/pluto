import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('retains invalid sources and admits short sources without provider requests', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phi-capacity-cli-unit-'));
  try {
    const input = path.join(root, 'sources.json');
    const original = JSON.stringify({
      source: 'readonly_production_sources',
      databaseSha256: 'a'.repeat(64),
      rows: [
        {
          id: 'invalid-synthetic',
          transcript_json: 'invalid JSON',
          duration_seconds: 0,
        },
        {
          id: 'short-synthetic',
          transcript_json: JSON.stringify({
            segments: [
              { speaker: 7, text: 'The project remains in planning.' },
            ],
          }),
          duration_seconds: 30,
        },
      ],
    });
    fs.writeFileSync(input, original, { mode: 0o600 });
    const cli = createRequire(import.meta.url).resolve('tsx/cli');
    const output = execFileSync(
      process.execPath,
      [cli, 'scripts/check_phi_notes_source_capacity.ts', input],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 15_000 },
    );
    expect(JSON.parse(output)).toMatchObject({
      physicalRequests: 0,
      counts: { invalid_notes_source: 1, preflight_admitted_no_inference: 1 },
    });
    const report = JSON.parse(
      fs.readFileSync(path.join(root, 'capacity.json'), 'utf8'),
    );
    expect(report.results).toHaveLength(2);
    expect(report.results[0].sourceCharacters).toBeNull();
    expect(fs.readFileSync(input, 'utf8')).toBe(original);
    expect(fs.statSync(path.join(root, 'capacity.json')).mode & 0o777).toBe(
      0o600,
    );
    expect(JSON.stringify(report)).not.toContain('The project remains');
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
