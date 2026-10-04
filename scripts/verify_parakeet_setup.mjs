import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const app =
  process.argv.slice(2).find((arg) => arg !== '--') ??
  `release/${version}/mac-arm64/Pluto.app`;
const executable = path.resolve(app, 'Contents/Resources/bin/parakeet-runtime');
const root = await mkdtemp(path.join(tmpdir(), 'pluto-packaged-setup-'));
const modelRoot = path.join(root, 'models');
const audioRoot = path.join(root, 'audio');
await mkdir(audioRoot);

async function prepare(cached) {
  const child = spawn(
    executable,
    ['--model-root', modelRoot, '--audio-root', audioRoot],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let buffer = '';
  let response;
  let stderr = '';
  let downloading = false;
  let lastPercent = -1;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          child.kill();
          reject(new Error('Packaged model setup timed out after 15 minutes.'));
        },
        15 * 60 * 1000,
      );
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-4096);
      });
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        while (buffer.includes('\n')) {
          const end = buffer.indexOf('\n');
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const event = JSON.parse(line);
            if (event.id === 'setup-smoke') response = event;
            if (event.phase === 'sizing' || event.phase === 'downloading')
              downloading = true;
            if (event.totalBytes > 0) {
              const percent =
                Math.floor(
                  (100 * event.downloadedBytes) / event.totalBytes / 10,
                ) * 10;
              if (percent > lastPercent) {
                lastPercent = percent;
                console.log(`Model setup ${percent}% (${event.phase})`);
              }
            }
          } catch {
            child.kill();
            clearTimeout(timer);
            reject(new Error('Packaged runtime emitted invalid JSON.'));
          }
        }
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        if (
          code !== 0 ||
          signal ||
          response?.ok !== true ||
          !response?.result?.modelVersion
        ) {
          reject(
            new Error(
              `Packaged setup failed: ${response?.error?.code ?? response?.code ?? `exit=${code} signal=${signal}`}\n${stderr}`,
            ),
          );
        } else if (cached && downloading) {
          reject(
            new Error('Packaged restart tried to download a verified cache.'),
          );
        } else resolve();
      });
      // Native runtime settles queued requests before exiting on stdin EOF.
      child.stdin.end(
        `${JSON.stringify({ schemaVersion: 1, id: 'setup-smoke', method: 'prepare', modelRoot })}\n`,
      );
    });
  } finally {
    if (child.exitCode === null) child.kill();
  }
}

try {
  console.log(
    'Checking the packaged runtime with a completely empty model cache.',
  );
  await prepare(false);
  console.log(
    'Checking a separate runtime restart reuses the verified install.',
  );
  await prepare(true);
  console.log('Packaged first-run model setup and cached restart passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
