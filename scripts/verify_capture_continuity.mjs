// Isolated synthetic capture: real Electron IPC and journal writes; no production DB.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const root = await mkdtemp(path.join(tmpdir(), 'pluto-capture-continuity-'));
try {
  const host = path.join(root, 'main.cjs');
  const renderer = path.join(root, 'renderer.cjs');
  await build({
    entryPoints: ['scripts/lib/captureContinuityHost.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: host,
  });
  await build({
    entryPoints: ['scripts/lib/captureContinuityRenderer.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: renderer,
  });
  const env = { ...process.env, PLUTO_CAPTURE_TEST_ROOT: root };
  env.ELECTRON_RUN_AS_NODE = undefined;
  const child = spawn(require('electron'), [host], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => {
    process.stdout.write(data);
  });
  // No private source is accessed; preserve diagnostics for harness failures only.
  let errors = '';
  child.stderr.on('data', (data) => {
    errors = (errors + data).slice(-4000);
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 90000);
  const code = await new Promise((resolve) => child.on('close', resolve));
  clearTimeout(timeout);
  assert.equal(code, 0, errors);
  const result = JSON.parse(
    await readFile(path.join(root, 'result.json'), 'utf8'),
  );
  console.log(JSON.stringify(result, null, 2));
  if (process.argv[2])
    await writeFile(
      path.resolve(process.argv[2]),
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
} finally {
  await rm(root, { recursive: true, force: true });
}
