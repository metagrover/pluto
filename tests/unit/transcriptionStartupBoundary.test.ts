import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('transcription startup boundary', () => {
  it('prepares the fixed MLX runtime before interrupted journal recovery', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const preparation = main.indexOf('await mlxPreview.setConfig({');
    const mlxDevice = main.indexOf("device: 'mlx'", preparation);
    const mlxCompute = main.indexOf("computeType: 'float16'", preparation);
    const activeHealth = main.indexOf(
      'const activeHealth = await mlxPreview.health()',
      preparation,
    );
    const recovery = main.indexOf('recoverInterruptedCaptureJournals(');

    expect(preparation).toBeGreaterThan(-1);
    expect(mlxDevice).toBeGreaterThan(preparation);
    expect(mlxCompute).toBeGreaterThan(mlxDevice);
    expect(activeHealth).toBeGreaterThan(preparation);
    expect(recovery).toBeGreaterThan(activeHealth);
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
