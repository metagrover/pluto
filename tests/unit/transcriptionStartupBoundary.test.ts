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

  it('ensures current native recording runtimes before starting development', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const ensureParakeetScript = readFileSync(
      'scripts/ensure_parakeet_runtime.sh',
      'utf8',
    );
    const ensureAudioCapScript = readFileSync(
      'scripts/ensure_audio_cap_runtime.sh',
      'utf8',
    );

    expect(packageJson.scripts?.predev).toBe('pnpm run ensure:dev-runtime');
    expect(packageJson.scripts?.['ensure:dev-runtime']).toBe(
      'pnpm run ensure:parakeet && pnpm run ensure:audio-cap',
    );
    expect(packageJson.scripts?.['ensure:parakeet']).toBe(
      './scripts/ensure_parakeet_runtime.sh',
    );
    expect(packageJson.scripts?.['ensure:audio-cap']).toBe(
      './scripts/ensure_audio_cap_runtime.sh',
    );
    expect(ensureParakeetScript).toContain('-newer "${output}"');
    expect(ensureParakeetScript).toContain(
      'exec "${SCRIPT_DIR}/build_parakeet.sh"',
    );
    expect(ensureAudioCapScript).toContain('-newer "${OUTPUT_PATH}"');
    expect(ensureAudioCapScript).toContain(
      'swiftc "${SOURCE_DIRECTORY}"/*.swift',
    );
    expect(ensureAudioCapScript).toContain(
      'codesign --sign - --force "${OUTPUT_PATH}"',
    );
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
