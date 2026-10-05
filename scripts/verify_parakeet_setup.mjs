import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Use the application's client and validator, not a separate JSON parser.
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const app = args[0] ?? `release/${version}/mac-arm64/Pluto.app`;
const root = await mkdtemp(path.join(tmpdir(), 'pluto-packaged-setup-'));
const modelRoot = args[1] ? path.resolve(args[1]) : path.join(root, 'models');
const audioRoot = path.join(root, 'audio');

try {
  await mkdir(audioRoot);
  const clientBundle = path.join(root, 'client.mjs');
  await build({
    stdin: {
      contents:
        "export { ParakeetFinalClient } from './electron/transcription/parakeetFinalClient'; export { makeRuntimeHost } from './electron/transcription/parakeetRuntimeHost';",
      resolveDir: process.cwd(),
    },
    outfile: clientBundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  const { ParakeetFinalClient, makeRuntimeHost } = await import(
    pathToFileURL(clientBundle).href
  );
  const paths = {
    executablePath: path.resolve(
      app,
      'Contents/Resources/bin/parakeet-runtime',
    ),
    modelRoot,
    audioRoot,
  };
  async function prepare(cached) {
    const runtimeHost = makeRuntimeHost({
      paths,
      requestTimeoutMs: 15 * 60 * 1000,
    });
    const client = new ParakeetFinalClient({ paths, runtimeHost });
    let downloading = false;
    let lastPercent = -1;
    try {
      const capability = await client.prepare((event) => {
        if (event.phase === 'sizing' || event.phase === 'downloading')
          downloading = true;
        if (event.totalBytes > 0) {
          const percent =
            Math.floor((100 * event.downloadedBytes) / event.totalBytes / 10) *
            10;
          if (percent > lastPercent) {
            lastPercent = percent;
            console.log(`Model setup ${percent}% (${event.phase})`);
          }
        }
      });
      if (!capability.ready || !capability.modelVersion)
        throw new Error(
          'Packaged preparation did not return a verified capability.',
        );
      if (cached && downloading)
        throw new Error('Packaged restart tried to download a verified cache.');
    } finally {
      client.close();
      runtimeHost.shutdown();
    }
  }
  console.log(
    args[1]
      ? 'Checking supplied cache through the app client.'
      : 'Checking packaged first-run setup through the app client with an empty cache.',
  );
  await prepare(Boolean(args[1]));
  console.log(
    'Checking a separate client/runtime restart reuses the verified install.',
  );
  await prepare(true);
  console.log(
    'Packaged model setup and cached restart passed through the app IPC client.',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
