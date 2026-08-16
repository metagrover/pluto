import { describe, expect, it } from 'vitest';

import {
  listTranscriptionBackends,
  normalizePlutoRuntimePlatform,
  resolveBackendOptions,
  resolvePreferredTranscriptionBackend,
} from '../../src/utils/transcriptionBackendConfig';

describe('Apple Silicon transcription contract', () => {
  it('exposes MLX as the only transcription backend', () => {
    expect(
      listTranscriptionBackends({ platform: 'darwin', arch: 'arm64' }).map(
        ({ backend, available }) => ({ backend, available }),
      ),
    ).toEqual([{ backend: 'mlx_preview', available: true }]);
  });

  it('marks the product unsupported outside Apple Silicon without offering a CPU fallback', () => {
    expect(
      listTranscriptionBackends({ platform: 'linux', arch: 'x64' }),
    ).toEqual([
      expect.objectContaining({
        backend: 'mlx_preview',
        available: false,
        supportedDevices: ['mlx'],
        supportedComputeTypes: ['float16'],
      }),
    ]);
  });

  it('normalizes obsolete persisted backend values to MLX preview', () => {
    expect(
      resolvePreferredTranscriptionBackend({
        configuredBackend: 'obsolete_backend',
        runtime: { platform: 'darwin', arch: 'arm64' },
        health: { mlxAvailable: true },
      }),
    ).toEqual({ backend: 'mlx_preview', shouldPersist: true });
  });

  it('never falls back to MLX preview when MLX health is unavailable', () => {
    expect(
      resolvePreferredTranscriptionBackend({
        configuredBackend: null,
        runtime: { platform: 'darwin', arch: 'arm64' },
        health: { mlxAvailable: false },
      }),
    ).toEqual({ backend: 'mlx_preview', shouldPersist: false });
  });

  it('uses the fixed MLX live-preview runtime contract', () => {
    expect(
      resolveBackendOptions(
        {
          backend: 'mlx_preview',
          preset: 'accuracy_first',
          model: 'large-v3',
          device: 'mlx',
          computeType: 'float16',
        },
        { platform: 'darwin', arch: 'arm64' },
      ),
    ).toMatchObject({
      backend: 'mlx_preview',
      preset: 'balanced',
      model: 'base',
      device: 'mlx',
      computeType: 'float16',
    });
  });

  it('normalizes unexpected runtime values to unknown', () => {
    expect(
      normalizePlutoRuntimePlatform({ platform: 'freebsd', arch: 'riscv64' }),
    ).toEqual({ platform: 'unknown', arch: 'unknown' });
  });
});
