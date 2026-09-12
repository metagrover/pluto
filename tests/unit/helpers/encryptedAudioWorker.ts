import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'vite';

export async function buildTestAudioWorker() {
  // Keep external dependencies resolvable without touching the app's build.
  const directory = await mkdtemp(
    join(process.cwd(), 'node_modules/.pluto-worker-test-'),
  );
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        outDir: directory,
        minify: false,
        lib: {
          entry: join(process.cwd(), 'electron/crypto/encryptedAudioWorker.ts'),
          formats: ['cjs'],
          fileName: () => 'encryptedAudioWorker.js',
        },
        rollupOptions: { external: [/^node:/, 'ffmpeg-static'] },
      },
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    path: join(directory, 'encryptedAudioWorker.js'),
    directory,
    close: () => rm(directory, { recursive: true, force: true }),
  };
}
