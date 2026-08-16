import { describe, expect, it } from 'vitest';

import { scoreWebRtcApmSpikeResults } from '../../scripts/run_webrtc_audio_processing_spike';

describe('WebRTC AudioProcessing spike scoring', () => {
  it('requires actual deterministic delay and drift residual metrics before a spike-only recommendation', () => {
    const result = scoreWebRtcApmSpikeResults([
      {
        kind: 'delay',
        delayMs: 200,
        driftPpm: 0,
        inputEnergy: 100,
        outputEnergy: 1,
        preCorrelation: 0.9,
        postCorrelation: 0.01,
        firstResidualDigest: 'a'.repeat(64),
        secondResidualDigest: 'a'.repeat(64),
        measuredDelayErrorMsP95: 1,
        measuredDriftErrorPpm: 0,
        measuredMicLevelChangeDb: 0,
        measuredMicSiSdrLossDb: 0,
        measuredLocalAttenuationDb: 0,
      },
      {
        kind: 'drift',
        delayMs: 40,
        driftPpm: -100,
        inputEnergy: 100,
        outputEnergy: 1,
        preCorrelation: 0.9,
        postCorrelation: 0.01,
        firstResidualDigest: 'b'.repeat(64),
        secondResidualDigest: 'b'.repeat(64),
        measuredDelayErrorMsP95: 1,
        measuredDriftErrorPpm: -100,
        measuredMicLevelChangeDb: 0,
        measuredMicSiSdrLossDb: 0,
        measuredLocalAttenuationDb: 0,
      },
    ]);

    expect(result.passes).toBe(true);
    expect(result.decision).toBe('webrtc_aec3_selected_for_spike_only');
    expect(result.productionWiringChanged).toBe(false);
  });

  it('fails closed when a residual changes between repeated real upstream runs', () => {
    const result = scoreWebRtcApmSpikeResults([
      {
        kind: 'delay',
        delayMs: 40,
        driftPpm: 0,
        inputEnergy: 100,
        outputEnergy: 1,
        preCorrelation: 0.9,
        postCorrelation: 0.01,
        firstResidualDigest: 'a'.repeat(64),
        secondResidualDigest: 'b'.repeat(64),
      },
    ]);

    expect(result.passes).toBe(false);
    expect(result.decision).toBe('no_backend_selected');
  });

  it('fails closed when the native runner does not report measured delay, drift, and preservation metrics', () => {
    const result = scoreWebRtcApmSpikeResults([
      {
        kind: 'delay',
        delayMs: 40,
        driftPpm: 0,
        inputEnergy: 100,
        outputEnergy: 1,
        preCorrelation: 0.9,
        postCorrelation: 0.01,
        firstResidualDigest: 'a'.repeat(64),
        secondResidualDigest: 'a'.repeat(64),
      },
    ]);

    expect(result.passes).toBe(false);
    expect(result.decision).toBe('no_backend_selected');
  });
});
