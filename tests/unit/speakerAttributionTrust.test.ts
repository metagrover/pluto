import { describe, expect, it } from 'vitest';

import {
  isSpeakerSeparatedAttribution,
  isVerifiedSpeakerAttribution,
} from '../../src/utils/speakerAttributionTrust';

describe('speaker attribution trust', () => {
  it('allows safe anonymous separation without claiming owner identity', () => {
    const attribution = {
      source: 'recovered_channel_acoustic_v3' as const,
      confidence: 0.94,
      diarizationAttempted: true,
      mappingApplied: false,
      speakerSeparation: 'verified' as const,
      selfIdentity: 'unresolved' as const,
    };

    expect(isSpeakerSeparatedAttribution(attribution)).toBe(true);
    expect(isVerifiedSpeakerAttribution(attribution)).toBe(false);
  });
});
