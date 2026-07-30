import { describe, expect, it } from 'vitest';

import { isAlertEligible } from '../../src/activeCall/alertDecision';

describe('isAlertEligible', () => {
  it('rejects silent Zoom process fallback', () => {
    expect(
      isAlertEligible({
        active: true,
        appName: 'Zoom',
        confidence: 'medium',
      }),
    ).toBe(false);
  });

  it('accepts confirmed Zoom audio', () => {
    expect(
      isAlertEligible({
        active: true,
        appName: 'Zoom',
        confidence: 'high',
      }),
    ).toBe(true);
  });
});
