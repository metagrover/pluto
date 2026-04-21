import { describe, expect, it } from 'vitest';

import {
  listTranscriptionBackends,
  resolveBackendOptions,
} from '../../src/utils/transcriptionBackendConfig';

describe('transcription backend registry', () => {
  it('lists available backend descriptors', () => {
    const backends = listTranscriptionBackends();
    expect(
      backends.some((backend) => backend.backend === 'whisperx_current'),
    ).toBe(true);
    expect(
      backends.some((backend) => backend.backend === 'whisperx_tuned'),
    ).toBe(true);
  });

  it('clamps unsupported presets for current backend', () => {
    const resolved = resolveBackendOptions({
      backend: 'whisperx_current',
      preset: 'accuracy_first',
    });
    expect(resolved.backend).toBe('whisperx_current');
    expect(resolved.preset).toBe('balanced');
  });

  it('downgrades float16 CPU requests to a supported compute type', () => {
    const resolved = resolveBackendOptions({
      backend: 'whisperx_tuned',
      preset: 'accuracy_first',
      device: 'cpu',
      computeType: 'float16',
    });
    expect(resolved.computeType).toBe('float32');
    expect(resolved.warnings).toHaveLength(1);
  });
});
