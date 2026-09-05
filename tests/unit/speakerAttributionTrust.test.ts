import { describe, expect, it } from 'vitest';

import { isVerifiedSpeakerAttribution } from '../../src/utils/speakerAttributionTrust';

describe('speaker attribution trust', () => {
  it('does not treat anonymous microphone separation as verified identity', () => {
    const attribution = {
      source: 'recovered_channel_acoustic_v3' as const,
      confidence: 0.94,
      diarizationAttempted: true,
      mappingApplied: false,
      speakerSeparation: 'verified' as const,
      selfIdentity: 'unresolved' as const,
    };

    expect(isVerifiedSpeakerAttribution(attribution)).toBe(false);
  });
});
