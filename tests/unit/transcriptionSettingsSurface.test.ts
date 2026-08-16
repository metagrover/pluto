import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('transcription settings surface', () => {
  it('does not expose backend, device, or compute controls', () => {
    const settings = readFileSync(
      'src/components/overlays/SettingsOverlay.tsx',
      'utf8',
    );
    expect(settings).not.toContain('settings-transcription-backend');
    expect(settings).not.toContain('MLX preview Current');
    expect(settings).not.toContain('MLX preview Tuned');
    expect(settings).not.toContain('whisperDevice');
    expect(settings).not.toContain('whisperComputeType');
    expect(settings).toContain('Parakeet produces the');
    expect(settings).not.toContain('settings-transcription-preset');
    expect(settings).not.toContain('settings-whisper-model');
    expect(settings).toContain('settings-transcription-language');
  });
});
