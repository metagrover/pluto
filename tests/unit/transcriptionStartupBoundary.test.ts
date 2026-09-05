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
    const buildParakeetScript = readFileSync(
      'scripts/build_parakeet.sh',
      'utf8',
    );

    expect(packageJson.scripts?.predev).toBe('pnpm run ensure:dev-runtime');
    const developmentGates = packageJson.scripts?.['ensure:dev-runtime']
      ?.split('&&')
      .map((command) => command.trim());
    expect(developmentGates).toEqual([
      'pnpm run ensure:media-tools',
      'pnpm run ensure:sqlite-abi',
      'pnpm run ensure:parakeet',
      'pnpm run ensure:audio-cap',
      'pnpm run ensure:calendar-helper',
    ]);
    expect(packageJson.scripts?.['ensure:media-tools']).toBe(
      'node scripts/verify_media_runtime.mjs',
    );
    expect(packageJson.scripts?.['ensure:sqlite-abi']).toBe(
      'node scripts/ensure_sqlite_abi.mjs',
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
    expect(buildParakeetScript).toContain(
      'node "${SCRIPT_DIR}/lib/swift_bin_path.mjs"',
    );
    expect(buildParakeetScript).not.toContain(
      'SWIFT_BIN_DIRECTORY="$(swift build',
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

  it('keeps transcription runtime diagnostics content-free', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    expect(main).not.toContain('[Pluto] Transcribing file');
    expect(main).not.toContain('request.audioPath');
  });
});
