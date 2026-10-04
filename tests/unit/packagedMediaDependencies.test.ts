import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const collectorPath = builderRequire.resolve(
  'app-builder-lib/out/node-module-collector/pnpmNodeModulesCollector',
);
const { PnpmNodeModulesCollector } = require(collectorPath);

// Dependency collection launches pnpm; allow process startup on shared CI runners.
it('includes the native ffprobe package in the actual pnpm packaging dependency graph', async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'pluto-media-deps-'),
  );
  try {
    const collector = new PnpmNodeModulesCollector(process.cwd(), {
      getTempFile: async () => path.join(temporaryRoot, 'dependencies.json'),
    });
    const { nodeModules } = await collector.getNodeModules({
      packageName: 'pluto',
    });
    expect(
      nodeModules.find(
        (dependency: { name: string }) =>
          dependency.name ===
          `@ffprobe-installer/${process.platform}-${process.arch}`,
      ),
    ).toMatchObject({ version: '5.0.1' });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}, 30_000);
