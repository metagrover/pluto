import { describe, expect, it } from 'vitest';

import {
  CLIPPING_FIXTURE,
  DELAY_0_TO_200_MS_FIXTURES,
  DOUBLE_TALK_FIXTURE,
  DRIFT_PLUS_MINUS_100_PPM_FIXTURES,
  MIC_ONLY_FIXTURE,
  REVERB_FIXTURE,
  SILENCE_FIXTURE,
  STREAMING_AEC_FIXTURES,
  STREAMING_AEC_GATES,
  SYSTEM_ONLY_FIXTURE,
  WEAK_REFERENCE_FIXTURE,
  evaluateSyntheticAecGates,
} from '../../src/services/streamingAec/syntheticFixtures';

describe('streaming AEC synthetic fixtures', () => {
  it('exports frozen exact gates and deterministic seeded fixtures', () => {
    expect(Object.isFrozen(STREAMING_AEC_GATES)).toBe(true);
    expect(STREAMING_AEC_GATES).toEqual({
      systemOnlyMedianErleDb: 15,
      systemOnlyMaxPostCorrelation: 0.2,
      systemOnlyMinCorrelationReduction: 0.7,
      micOnlyMaxLevelChangeDb: 1,
      micOnlyMaxSiSdrLossDb: 1,
      doubleTalkMinRemoteErleDb: 8,
      doubleTalkMaxLocalAttenuationDb: 3,
      maxDelayErrorMsP95: 10,
      maxAbsDriftPpm: 100,
    });
    expect(STREAMING_AEC_FIXTURES.length).toBeGreaterThanOrEqual(14);
    expect([
      SYSTEM_ONLY_FIXTURE.micSamples[0],
      SYSTEM_ONLY_FIXTURE.micSamples[1024],
      SYSTEM_ONLY_FIXTURE.micSamples[4095],
    ]).toEqual([0, -0.3042273187321894, 0.04628680857712773]);
    expect(Object.isFrozen(SYSTEM_ONLY_FIXTURE)).toBe(true);
    expect(Object.isFrozen(SYSTEM_ONLY_FIXTURE.micSamples)).toBe(true);
  });

  it('covers the requested signal conditions and delay/drift ranges', () => {
    expect(SYSTEM_ONLY_FIXTURE.kind).toBe('system_only');
    expect(MIC_ONLY_FIXTURE.kind).toBe('mic_only');
    expect(DOUBLE_TALK_FIXTURE.kind).toBe('double_talk');
    expect(REVERB_FIXTURE.reverb).toBe(true);
    expect(SILENCE_FIXTURE.silence).toBe(true);
    expect(WEAK_REFERENCE_FIXTURE.weakReference).toBe(true);
    expect(CLIPPING_FIXTURE.clipped).toBe(true);
    expect(
      DELAY_0_TO_200_MS_FIXTURES.map((fixture) => fixture.delayMs),
    ).toEqual([0, 40, 100, 160, 200]);
    expect(
      DRIFT_PLUS_MINUS_100_PPM_FIXTURES.map((fixture) => fixture.driftPpm),
    ).toEqual([-100, 0, 100]);
  });

  it('materializes each source topology in the seeded sample arrays', () => {
    const allZero = (samples: readonly number[]) =>
      samples.every((sample) => sample === 0);
    const energy = (samples: readonly number[]) =>
      samples.reduce((sum, sample) => sum + sample * sample, 0);

    expect(allZero(SYSTEM_ONLY_FIXTURE.systemSamples)).toBe(false);
    expect(allZero(SYSTEM_ONLY_FIXTURE.micSamples)).toBe(false);
    expect(allZero(MIC_ONLY_FIXTURE.systemSamples)).toBe(true);
    expect(allZero(MIC_ONLY_FIXTURE.micSamples)).toBe(false);
    expect(allZero(DOUBLE_TALK_FIXTURE.systemSamples)).toBe(false);
    expect(allZero(DOUBLE_TALK_FIXTURE.micSamples)).toBe(false);
    expect(allZero(SILENCE_FIXTURE.systemSamples)).toBe(true);
    expect(allZero(SILENCE_FIXTURE.micSamples)).toBe(true);
    expect(energy(WEAK_REFERENCE_FIXTURE.systemSamples)).toBeLessThan(
      energy(SYSTEM_ONLY_FIXTURE.systemSamples),
    );
    expect(Math.max(...CLIPPING_FIXTURE.micSamples.map(Math.abs))).toBe(1);
    expect(REVERB_FIXTURE.micSamples).not.toEqual(
      SYSTEM_ONLY_FIXTURE.micSamples,
    );
    expect(DELAY_0_TO_200_MS_FIXTURES[0].micSamples).not.toEqual(
      DELAY_0_TO_200_MS_FIXTURES.at(-1)?.micSamples,
    );
    expect(DRIFT_PLUS_MINUS_100_PPM_FIXTURES[0].micSamples).not.toEqual(
      DRIFT_PLUS_MINUS_100_PPM_FIXTURES.at(-1)?.micSamples,
    );
    for (const fixture of STREAMING_AEC_FIXTURES.filter(
      (candidate) => !candidate.clipped,
    )) {
      expect(Math.max(...fixture.micSamples.map(Math.abs))).toBeLessThanOrEqual(
        1,
      );
      expect(
        Math.max(...fixture.systemSamples.map(Math.abs)),
      ).toBeLessThanOrEqual(1);
    }
    expect(
      Math.max(...SYSTEM_ONLY_FIXTURE.micSamples.map(Math.abs)),
    ).toBeLessThan(1);
    expect(Math.max(...CLIPPING_FIXTURE.micSamples.map(Math.abs))).toBe(1);
  });

  it('passes the normal system-only, mic-only, and double-talk fixtures', () => {
    expect(evaluateSyntheticAecGates(SYSTEM_ONLY_FIXTURE).passes).toBe(true);
    expect(evaluateSyntheticAecGates(MIC_ONLY_FIXTURE).passes).toBe(true);
    expect(evaluateSyntheticAecGates(DOUBLE_TALK_FIXTURE).passes).toBe(true);
    expect(evaluateSyntheticAecGates(REVERB_FIXTURE).passes).toBe(true);
  });

  it('accepts exact and just-inside quantitative boundaries', () => {
    expect(
      evaluateSyntheticAecGates({
        ...SYSTEM_ONLY_FIXTURE,
        erleDb: 15,
        postCorrelation: 0.2,
        correlationReduction: 0.7,
        delayErrorMsP95: 10,
        driftPpm: 100,
        micLevelChangeDb: 1,
        micSiSdrLossDb: 1,
        remoteErleDb: 8,
        localAttenuationDb: 3,
      }).passes,
    ).toBe(true);
    expect(
      evaluateSyntheticAecGates({
        ...SYSTEM_ONLY_FIXTURE,
        erleDb: 15.0001,
        postCorrelation: 0.1999,
        correlationReduction: 0.7001,
        delayErrorMsP95: 9.9999,
        driftPpm: -99.9999,
        micLevelChangeDb: 0.9999,
        micSiSdrLossDb: 0.9999,
        remoteErleDb: 8.0001,
        localAttenuationDb: 2.9999,
      }).passes,
    ).toBe(true);
  });

  it('applies mic-only and double-talk gates at exact, inside, and outside boundaries', () => {
    expect(
      evaluateSyntheticAecGates({
        ...MIC_ONLY_FIXTURE,
        micLevelChangeDb: 1,
        micSiSdrLossDb: 1,
      }).passes,
    ).toBe(true);
    expect(
      evaluateSyntheticAecGates({
        ...MIC_ONLY_FIXTURE,
        micLevelChangeDb: 0.999,
        micSiSdrLossDb: 0.999,
      }).passes,
    ).toBe(true);
    expect(
      evaluateSyntheticAecGates({
        ...MIC_ONLY_FIXTURE,
        micLevelChangeDb: 1.001,
      }).passes,
    ).toBe(false);
    expect(
      evaluateSyntheticAecGates({
        ...MIC_ONLY_FIXTURE,
        micSiSdrLossDb: 1.001,
      }).passes,
    ).toBe(false);

    expect(
      evaluateSyntheticAecGates({
        ...DOUBLE_TALK_FIXTURE,
        remoteErleDb: 8,
        localAttenuationDb: 3,
      }).passes,
    ).toBe(true);
    expect(
      evaluateSyntheticAecGates({
        ...DOUBLE_TALK_FIXTURE,
        remoteErleDb: 8.001,
        localAttenuationDb: 2.999,
      }).passes,
    ).toBe(true);
    expect(
      evaluateSyntheticAecGates({
        ...DOUBLE_TALK_FIXTURE,
        remoteErleDb: 7.999,
      }).passes,
    ).toBe(false);
    expect(
      evaluateSyntheticAecGates({
        ...DOUBLE_TALK_FIXTURE,
        localAttenuationDb: 3.001,
      }).passes,
    ).toBe(false);
  });

  it('rejects just-outside boundaries and known bad fixtures', () => {
    const boundaryCases = [
      [
        { ...SYSTEM_ONLY_FIXTURE, kind: 'system_only' as const },
        { erleDb: 14.9999 },
      ],
      [
        { ...SYSTEM_ONLY_FIXTURE, kind: 'system_only' as const },
        { postCorrelation: 0.2001 },
      ],
      [
        { ...SYSTEM_ONLY_FIXTURE, kind: 'system_only' as const },
        { correlationReduction: 0.6999 },
      ],
      [
        { ...MIC_ONLY_FIXTURE, kind: 'mic_only' as const },
        { micLevelChangeDb: 1.0001 },
      ],
      [
        { ...MIC_ONLY_FIXTURE, kind: 'mic_only' as const },
        { micSiSdrLossDb: 1.0001 },
      ],
      [
        { ...DOUBLE_TALK_FIXTURE, kind: 'double_talk' as const },
        { remoteErleDb: 7.9999 },
      ],
      [
        { ...DOUBLE_TALK_FIXTURE, kind: 'double_talk' as const },
        { localAttenuationDb: 3.0001 },
      ],
      [
        { ...SYSTEM_ONLY_FIXTURE, kind: 'delay' as const },
        { delayErrorMsP95: 10.0001 },
      ],
      [
        { ...SYSTEM_ONLY_FIXTURE, kind: 'drift' as const },
        { driftPpm: 100.0001 },
      ],
      [
        { ...SYSTEM_ONLY_FIXTURE, kind: 'drift' as const },
        { driftPpm: -100.0001 },
      ],
    ];

    for (const [fixture, overrides] of boundaryCases) {
      expect(
        evaluateSyntheticAecGates({ ...fixture, ...overrides }).passes,
      ).toBe(false);
    }
    expect(evaluateSyntheticAecGates(WEAK_REFERENCE_FIXTURE).passes).toBe(
      false,
    );
    expect(evaluateSyntheticAecGates(CLIPPING_FIXTURE).passes).toBe(false);
  });

  it('never lets silence bypass clipping or weak-reference gates', () => {
    expect(
      evaluateSyntheticAecGates({
        ...SILENCE_FIXTURE,
        clipped: true,
        weakReference: true,
      }).passes,
    ).toBe(false);
  });

  it('does not apply local SI-SDR and attenuation gates without known sources', () => {
    const result = evaluateSyntheticAecGates({
      ...MIC_ONLY_FIXTURE,
      knownSources: false,
      micLevelChangeDb: 100,
      micSiSdrLossDb: 100,
      localAttenuationDb: 100,
    });

    expect(result.localSourceGatesApplied).toBe(false);
    expect(result.micOnly).toBe(true);
    expect(result.doubleTalk).toBe(true);
  });
});
