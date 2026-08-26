import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

describe('packaged runtime resources', () => {
  it('copies every production runtime from resources/bin', () => {
    const config = readFileSync(
      path.join(projectRoot, 'electron-builder.json5'),
      'utf8',
    );

    expect(config).toMatch(
      /"from": "resources\/bin"[^}]*"to": "bin"[^}]*"filter": \["\*\*\/\*"\]/,
    );
  });

  it('provides a packaged artifact verifier', () => {
    const verifier = readFileSync(
      path.join(projectRoot, 'scripts/verify_packaged_runtime.mjs'),
      'utf8',
    );

    for (const runtime of [
      'recorder',
      'audiocap',
      'parakeet-runtime',
      'parakeet-resource-probe',
    ]) {
      expect(verifier).toContain(runtime);
    }
  });

  it('accepts the conventional separator before an app path', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'pluto-app-'));
    const appPath = path.join(temporaryRoot, 'Pluto.app');
    const binPath = path.join(appPath, 'Contents', 'Resources', 'bin');
    for (const relativePath of [
      'recorder',
      'audiocap',
      'parakeet-runtime',
      'parakeet-resource-probe',
    ]) {
      const executable = path.join(binPath, relativePath);
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(executable, 'fixture');
      await chmod(executable, 0o755);
    }

    await expect(
      execFileAsync(process.execPath, [
        path.join(projectRoot, 'scripts/verify_packaged_runtime.mjs'),
        '--',
        appPath,
      ]),
    ).resolves.toMatchObject({ stdout: 'Verified 4 packaged runtimes.\n' });
  });
});
