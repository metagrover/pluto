import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('transcription startup boundary', () => {
  it('prepares and persists the fixed MLX runtime before interrupted journal recovery', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const preparation = main.indexOf('await whisperX.setConfig({');
    const mlxDevice = main.indexOf("device: 'mlx'", preparation);
    const mlxCompute = main.indexOf("computeType: 'float16'", preparation);
    const activeHealth = main.indexOf(
      'const activeHealth = await whisperX.health()',
      preparation,
    );
    const persistence = main.indexOf(
      "db.setSetting('transcription_backend', startupBackend.backend)",
    );
    const recovery = main.indexOf('recoverInterruptedCaptureJournals(');

    expect(preparation).toBeGreaterThan(-1);
    expect(mlxDevice).toBeGreaterThan(preparation);
    expect(mlxCompute).toBeGreaterThan(mlxDevice);
    expect(activeHealth).toBeGreaterThan(preparation);
    expect(persistence).toBeGreaterThan(activeHealth);
    expect(recovery).toBeGreaterThan(persistence);
  });

  it('keeps transcription runtime diagnostics generic and content-free', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const manager = readFileSync('electron/whisperx.ts', 'utf8');
    expect(main).not.toContain('[Pluto] Transcribing file');
    expect(main).not.toContain('[Pluto] WhisperX');
    expect(manager).not.toContain('[WhisperX]');
    expect(manager).toContain('[Transcription]');
  });
});
