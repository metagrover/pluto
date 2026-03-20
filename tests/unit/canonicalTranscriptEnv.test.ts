import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readCanonicalSourceOverride,
  shouldUseMixForCanonicalTranscript,
} from '../../src/utils/canonicalTranscriptEnv';

describe('canonicalTranscriptEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('PLUTO_CANONICAL_SOURCE=mic forces no mix', () => {
    vi.stubEnv('PLUTO_CANONICAL_SOURCE', 'mic');
    expect(readCanonicalSourceOverride()).toBe('mic');
    expect(
      shouldUseMixForCanonicalTranscript({
        preferMixDefault: true,
        hasMixedAudioPath: true,
      }),
    ).toBe(false);
  });

  it('PLUTO_CANONICAL_SOURCE=mix uses mix when path exists', () => {
    vi.stubEnv('PLUTO_CANONICAL_SOURCE', 'mix');
    expect(
      shouldUseMixForCanonicalTranscript({
        preferMixDefault: false,
        hasMixedAudioPath: true,
      }),
    ).toBe(true);
    expect(
      shouldUseMixForCanonicalTranscript({
        preferMixDefault: true,
        hasMixedAudioPath: false,
      }),
    ).toBe(false);
  });

  it('auto / unset follows preferMixDefault and hasMixedAudioPath', () => {
    vi.stubEnv('PLUTO_CANONICAL_SOURCE', 'auto');
    expect(
      shouldUseMixForCanonicalTranscript({
        preferMixDefault: true,
        hasMixedAudioPath: true,
      }),
    ).toBe(true);
    vi.stubEnv('PLUTO_CANONICAL_SOURCE', '');
    expect(
      shouldUseMixForCanonicalTranscript({
        preferMixDefault: true,
        hasMixedAudioPath: true,
      }),
    ).toBe(true);
  });
});
