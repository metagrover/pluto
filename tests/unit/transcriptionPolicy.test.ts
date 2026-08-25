import { describe, expect, it } from 'vitest';

import {
  assertTranscriptionPolicySupported,
  resolveTranscriptionPolicy,
} from '../../src/services/transcription/policy.ts';

describe('transcription policy roles', () => {
  it('uses English Parakeet EOU recognition on the live preview role', () => {
    expect(resolveTranscriptionPolicy('live_preview')).toEqual({
      role: 'live_preview',
      engine: 'parakeet_eou_320ms',
      model: 'parakeet-tdt-0.6b-v3',
      languageMode: 'explicit',
      maxConcurrency: 1,
      wholeSession: false,
    });
  });

  it('uses one Parakeet v3 request at a time for final validation', () => {
    expect(resolveTranscriptionPolicy('final_validation')).toEqual({
      role: 'final_validation',
      engine: 'parakeet_coreml',
      model: 'parakeet-tdt-0.6b-v3',
      languageMode: 'explicit',
      maxConcurrency: 1,
      wholeSession: true,
    });
  });

  it('supports both roles on Apple Silicon', () => {
    expect(() =>
      assertTranscriptionPolicySupported('live_preview', {
        platform: 'darwin',
        arch: 'arm64',
      }),
    ).not.toThrow();
    expect(() =>
      assertTranscriptionPolicySupported('final_validation', {
        platform: 'darwin',
        arch: 'arm64',
      }),
    ).not.toThrow();
  });

  it.each([
    { platform: 'darwin' as const, arch: 'x64' as const },
    { platform: 'linux' as const, arch: 'x64' as const },
    { platform: 'win32' as const, arch: 'arm64' as const },
  ])('rejects unsupported runtime $platform/$arch', (runtime) => {
    expect(() =>
      assertTranscriptionPolicySupported('final_validation', runtime),
    ).toThrowError('transcription_platform_unsupported');
  });
});
