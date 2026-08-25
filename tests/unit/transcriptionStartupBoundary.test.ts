import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('transcription startup boundary', () => {
  it('prepares the fixed Parakeet runtime before interrupted journal recovery', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const whenReady = main.indexOf('app.whenReady().then');
    const preparation = main.indexOf(
      'await prepareFinalTranscriptionBeforeRecovery({',
    );
    const windowCreation = main.indexOf('createWindow();', whenReady);
    const parakeetPrepare = main.indexOf(
      'await parakeetFinalClient.prepare()',
      preparation,
    );
    const recovery = main.indexOf('recoverInterruptedCaptureJournals(');

    expect(windowCreation).toBeGreaterThan(whenReady);
    expect(windowCreation).toBeLessThan(preparation);
    expect(preparation).toBeGreaterThan(-1);
    expect(parakeetPrepare).toBeGreaterThan(preparation);
    expect(recovery).toBeGreaterThan(parakeetPrepare);
    expect(main).not.toContain('await mlxPreview.setConfig({');
    expect(main).not.toContain('await mlxPreview.health()');
  });

  it('builds the native Parakeet runtime before starting development', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.predev).toBe('pnpm run build:parakeet');
  });

  it('keeps transcription runtime diagnostics generic and content-free', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const manager = readFileSync(
      'electron/transcription/mlxPreviewClient.ts',
      'utf8',
    );
    expect(main).not.toContain('[Pluto] Transcribing file');
    expect(main).not.toContain('[Pluto] MLX preview');
    expect(manager).not.toContain('[MLX preview]');
    expect(manager).toContain('[Transcription]');
  });
});
