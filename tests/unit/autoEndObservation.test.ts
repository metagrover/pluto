import { describe, expect, it } from 'vitest';

import { toObservationEvent } from '../../src/autoEnd/observation';

describe('toObservationEvent', () => {
  it('maps a new high-confidence observation', () => {
    expect(
      toObservationEvent(null, {
        active: true,
        appName: 'Zoom',
        confidence: 'high',
        reason: 'call-app-running-with-active-audio',
      }),
    ).toEqual({
      signature: 'Zoom|high|call-app-running-with-active-audio',
      reasonCode: 'call_observation_high',
      appName: 'Zoom',
    });
  });

  it('suppresses an unchanged observation', () => {
    expect(
      toObservationEvent('Zoom|high|call-app-running-with-active-audio', {
        active: true,
        appName: 'Zoom',
        confidence: 'high',
        reason: 'call-app-running-with-active-audio',
      }),
    ).toBeNull();
  });

  it.each([
    ['medium', 'call_observation_medium'],
    ['low', 'call_observation_low'],
  ] as const)('maps %s confidence transitions', (confidence, reasonCode) => {
    expect(
      toObservationEvent(null, {
        active: confidence !== 'low',
        appName: 'Zoom',
        confidence,
        reason: 'probe-result',
      }),
    ).toEqual({
      signature: `Zoom|${confidence}|probe-result`,
      reasonCode,
      appName: 'Zoom',
    });
  });
});
