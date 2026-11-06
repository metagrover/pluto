import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'vite';

// Builds the worker the way the app ships it, so tests run the real entry.
export async function buildTestDatabaseIntegrityWorker() {
  // Inside node_modules so the external SQLite binding still resolves.
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
          entry: join(
            process.cwd(),
            'electron/database/integrityCheckWorker.ts',
          ),
          formats: ['cjs'],
          fileName: () => 'databaseIntegrityWorker.js',
        },
        rollupOptions: {
          external: [/^node:/, 'better-sqlite3-multiple-ciphers'],
        },
      },
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    path: join(directory, 'databaseIntegrityWorker.js'),
    close: () => rm(directory, { recursive: true, force: true }),
  };
}
