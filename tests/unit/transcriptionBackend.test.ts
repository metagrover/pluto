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
    ).toEqual([{ backend: 'local_alt_apple_silicon', available: true }]);
  });

  it('marks the product unsupported outside Apple Silicon without offering a CPU fallback', () => {
    expect(
      listTranscriptionBackends({ platform: 'linux', arch: 'x64' }),
    ).toEqual([
      expect.objectContaining({
        backend: 'local_alt_apple_silicon',
        available: false,
        supportedDevices: ['mlx'],
        supportedComputeTypes: ['float16'],
      }),
    ]);
  });

  it('migrates persisted legacy backend choices to MLX', () => {
    expect(
      resolvePreferredTranscriptionBackend({
        configuredBackend: 'whisperx_current',
        runtime: { platform: 'darwin', arch: 'arm64' },
        health: { mlxAvailable: true },
      }),
    ).toEqual({ backend: 'local_alt_apple_silicon', shouldPersist: true });
  });

  it('never falls back to WhisperX when MLX health is unavailable', () => {
    expect(
      resolvePreferredTranscriptionBackend({
        configuredBackend: null,
        runtime: { platform: 'darwin', arch: 'arm64' },
        health: { mlxAvailable: false },
      }),
    ).toEqual({ backend: 'local_alt_apple_silicon', shouldPersist: true });
  });

  it('coerces legacy device and compute values to the MLX runtime contract', () => {
    expect(
      resolveBackendOptions(
        {
          backend: 'whisperx_current',
          preset: 'accuracy_first',
          model: 'large-v3',
          device: 'cpu',
          computeType: 'int8',
        },
        { platform: 'darwin', arch: 'arm64' },
      ),
    ).toMatchObject({
      backend: 'local_alt_apple_silicon',
      preset: 'accuracy_first',
      model: 'large-v3',
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
