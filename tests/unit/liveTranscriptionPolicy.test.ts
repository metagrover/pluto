import { describe, expect, it } from 'vitest';

import {
  evaluateLiveTranscriptionAdmission,
  selectLiveTranscriptionMode,
} from '../../electron/transcription/liveTranscriptionPolicy';

describe('live transcription rollout policy', () => {
  it('admits system shadow when AEC is unavailable', () => {
    expect(
      evaluateLiveTranscriptionAdmission({
        requestedMode: 'parakeet_primary',
        aecAvailable: false,
        parakeetAvailable: true,
      }),
    ).toMatchObject({ admitted: true, mode: 'system_shadow' });
  });

  it('selects the requested eligible mode when AEC and Parakeet are available', () => {
    expect(
      selectLiveTranscriptionMode({
        requestedMode: 'dual_shadow',
        aecAvailable: true,
        parakeetAvailable: true,
      }),
    ).toBe('dual_shadow');
  });

  it('keeps MLX as the safe admission mode when Parakeet is unavailable', () => {
    expect(
      evaluateLiveTranscriptionAdmission({
        requestedMode: 'parakeet_primary',
        aecAvailable: true,
        parakeetAvailable: false,
      }),
    ).toMatchObject({ admitted: true, mode: 'mlx' });
  });

  it('fails closed to MLX when Parakeet availability is unknown', () => {
    expect(
      selectLiveTranscriptionMode({
        requestedMode: 'parakeet_primary',
        aecAvailable: true,
      }),
    ).toBe('mlx');
  });
});
