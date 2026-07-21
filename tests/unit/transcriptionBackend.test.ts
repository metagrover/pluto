import { describe, expect, it } from 'vitest';

import {
  listTranscriptionBackends,
  normalizePlutoRuntimePlatform,
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

  it('only enables the Apple Silicon backend with explicit matching runtime evidence', () => {
    const appleSilicon = listTranscriptionBackends({
      platform: 'darwin',
      arch: 'arm64',
    });
    const unknownArchitecture = listTranscriptionBackends({
      platform: 'darwin',
      arch: 'unknown',
    });

    expect(
      appleSilicon.find(
        (backend) => backend.backend === 'local_alt_apple_silicon',
      )?.available,
    ).toBe(true);
    expect(
      unknownArchitecture.find(
        (backend) => backend.backend === 'local_alt_apple_silicon',
      )?.available,
    ).toBe(false);
  });

  it('only exposes CUDA with an explicit supported operating system', () => {
    const linux = listTranscriptionBackends({
      platform: 'linux',
      arch: 'x64',
    });
    const unknown = listTranscriptionBackends({
      platform: 'unknown',
      arch: 'unknown',
    });

    expect(linux[0].supportedDevices).toContain('cuda');
    expect(unknown[0].supportedDevices).toEqual(['cpu']);
  });

  it('normalizes unexpected runtime values to unknown', () => {
    expect(
      normalizePlutoRuntimePlatform({ platform: 'freebsd', arch: 'riscv64' }),
    ).toEqual({ platform: 'unknown', arch: 'unknown' });
  });
});
