import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = path.resolve('scripts/validate_release_tag.mjs');
const run = (tag: string, version = '1.2.3') => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pluto-release-tag-'),
  );
  const packagePath = path.join(directory, 'package.json');
  fs.writeFileSync(packagePath, JSON.stringify({ version }));
  const result = spawnSync(process.execPath, [script, tag, packagePath], {
    encoding: 'utf8',
  });
  fs.rmSync(directory, { recursive: true, force: true });
  return result;
};

describe('release tag validation', () => {
  it('accepts an exact stable tag and package version match', () => {
    const result = run('v1.2.3');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('1.2.3');
  });

  it('rejects mismatches, prereleases, and non-canonical versions', () => {
    expect(run('v1.2.4').status).not.toBe(0);
    expect(run('v1.2.3-beta.1').status).not.toBe(0);
    expect(run('v01.2.3').status).not.toBe(0);
  });
});
