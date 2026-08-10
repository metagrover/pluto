import { describe, expect, it } from 'vitest';

import {
  listTranscriptionBackends,
  normalizePlutoRuntimePlatform,
  resolveBackendOptions,
  resolvePreferredTranscriptionBackend,
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

  it('selects MLX for an unset backend only when Apple Silicon runtime health proves it is available', () => {
    expect(
      resolvePreferredTranscriptionBackend({
        configuredBackend: null,
        runtime: { platform: 'darwin', arch: 'arm64' },
        health: { mlxAvailable: true },
      }),
    ).toEqual({
      backend: 'local_alt_apple_silicon',
      shouldPersist: true,
    });

    expect(
      resolvePreferredTranscriptionBackend({
        configuredBackend: null,
        runtime: { platform: 'darwin', arch: 'arm64' },
        health: { mlxAvailable: false },
      }),
    ).toEqual({ backend: 'whisperx_current', shouldPersist: false });
  });

  it('preserves an explicit backend choice instead of overriding it with MLX', () => {
    expect(
      resolvePreferredTranscriptionBackend({
        configuredBackend: 'whisperx_current',
        runtime: { platform: 'darwin', arch: 'arm64' },
        health: { mlxAvailable: true },
      }),
    ).toEqual({ backend: 'whisperx_current', shouldPersist: false });
  });

  it('models MLX as the actual Apple Silicon device and compute contract', () => {
    const capabilities = listTranscriptionBackends({
      platform: 'darwin',
      arch: 'arm64',
    }).find((backend) => backend.backend === 'local_alt_apple_silicon');
    const resolved = resolveBackendOptions(
      {
        backend: 'local_alt_apple_silicon',
        preset: 'balanced',
      },
      { platform: 'darwin', arch: 'arm64' },
    );

    expect(capabilities?.supportedDevices).toEqual(['mlx']);
    expect(capabilities?.supportedComputeTypes).toEqual(['float16']);
    expect(resolved.device).toBe('mlx');
    expect(resolved.computeType).toBe('float16');
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
