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

  it('ensures a current native Parakeet runtime before starting development', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const ensureScript = readFileSync(
      'scripts/ensure_parakeet_runtime.sh',
      'utf8',
    );

    expect(packageJson.scripts?.predev).toBe('pnpm run ensure:parakeet');
    expect(packageJson.scripts?.['ensure:parakeet']).toBe(
      './scripts/ensure_parakeet_runtime.sh',
    );
    expect(ensureScript).toContain('-newer "${output}"');
    expect(ensureScript).toContain('exec "${SCRIPT_DIR}/build_parakeet.sh"');
  });

  it('excludes FluidAudio benchmark notes from Swift source discovery', () => {
    const manifest = readFileSync(
      'native/parakeet-runtime/vendor/FluidAudio/Package.swift',
      'utf8',
    );

    expect(manifest).toContain(
      'exclude: ["ASR/Parakeet/Unified/benchmark.md"]',
    );
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
