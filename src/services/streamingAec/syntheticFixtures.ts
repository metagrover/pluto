export const STREAMING_AEC_GATES = Object.freeze({
  systemOnlyMedianErleDb: 15,
  systemOnlyMaxPostCorrelation: 0.2,
  systemOnlyMinCorrelationReduction: 0.7,
  micOnlyMaxLevelChangeDb: 1,
  micOnlyMaxSiSdrLossDb: 1,
  doubleTalkMinRemoteErleDb: 8,
  doubleTalkMaxLocalAttenuationDb: 3,
  maxDelayErrorMsP95: 10,
  maxAbsDriftPpm: 100,
} as const);

export type SyntheticAecFixtureKind =
  | 'system_only'
  | 'mic_only'
  | 'double_talk'
  | 'delay'
  | 'drift'
  | 'reverb'
  | 'silence'
  | 'weak_reference'
  | 'clipping';

export type SyntheticAecFixture = {
  kind: SyntheticAecFixtureKind;
  seed: number;
  knownSources: boolean;
  micSamples: readonly number[];
  systemSamples: readonly number[];
  delayMs: number;
  delayErrorMsP95: number;
  driftPpm: number;
  erleDb: number;
  postCorrelation: number;
  correlationReduction: number;
  micLevelChangeDb: number;
  micSiSdrLossDb: number;
  remoteErleDb: number;
  localAttenuationDb: number;
  reverb: boolean;
  silence: boolean;
  weakReference: boolean;
  clipped: boolean;
};

const SAMPLE_RATE_HZ = 16_000;
const SAMPLE_COUNT = 4_096;

const seededSamples = (seed: number, amplitude: number): number[] => {
  let state = seed >>> 0;
  return Array.from({ length: SAMPLE_COUNT }, (_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const noise = (state / 0x1_0000_0000) * 2 - 1;
    const tone = Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE_HZ);
    return (tone * 0.8 + noise * 0.2) * amplitude;
  });
};

const delayed = (samples: readonly number[], delaySamples: number): number[] =>
  samples.map((_, index) =>
    index >= delaySamples ? samples[index - delaySamples] : 0,
  );

const drifted = (samples: readonly number[], driftPpm: number): number[] =>
  samples.map((_, index) => {
    const position = Math.min(
      samples.length - 1,
      Math.max(0, index * (1 + driftPpm / 1_000_000)),
    );
    const lower = Math.floor(position);
    const upper = Math.min(samples.length - 1, lower + 1);
    const fraction = position - lower;
    return samples[lower] * (1 - fraction) + samples[upper] * fraction;
  });

const addSignals = (...signals: readonly (readonly number[])[]): number[] =>
  signals[0].map((_, index) =>
    signals.reduce((sum, signal) => sum + signal[index], 0),
  );

const scale = (samples: readonly number[], factor: number): number[] =>
  samples.map((sample) => sample * factor);

const clip = (samples: readonly number[]): number[] =>
  samples.map((sample) => Math.max(-1, Math.min(1, sample * 2.5)));

const normalizePcm = (samples: readonly number[]): number[] => {
  const peak = Math.max(...samples.map(Math.abs));
  if (peak <= 0.95) return [...samples];
  const factor = 0.95 / peak;
  return samples.map((sample) => sample * factor);
};

const sourceSignals = (
  input: Omit<SyntheticAecFixture, 'micSamples' | 'systemSamples'>,
): { micSamples: readonly number[]; systemSamples: readonly number[] } => {
  if (input.silence) {
    const silent = Object.freeze(Array.from({ length: SAMPLE_COUNT }, () => 0));
    return { micSamples: silent, systemSamples: silent };
  }

  const systemSource = seededSamples(
    input.seed,
    input.weakReference ? 0.05 : 0.8,
  );
  const localSource = seededSamples(input.seed + 10_000, 0.7);
  const delaySamples = Math.round((input.delayMs / 1_000) * SAMPLE_RATE_HZ);
  const remoteEcho = drifted(
    delayed(systemSource, delaySamples),
    input.driftPpm,
  );
  let mic = input.kind === 'mic_only' ? localSource : scale(remoteEcho, 0.8);
  if (input.kind === 'double_talk')
    mic = addSignals(mic, scale(localSource, 0.5));
  if (input.reverb) {
    mic = addSignals(
      mic,
      scale(delayed(mic, Math.round(SAMPLE_RATE_HZ * 0.012)), 0.4),
    );
  }
  mic = input.clipped ? clip(mic) : normalizePcm(mic);

  return {
    micSamples: Object.freeze(mic),
    systemSamples: Object.freeze(
      input.kind === 'mic_only' ? systemSource.map(() => 0) : systemSource,
    ),
  };
};

const makeFixture = (
  input: Omit<SyntheticAecFixture, 'micSamples' | 'systemSamples'>,
): SyntheticAecFixture => {
  const signals = sourceSignals(input);
  return Object.freeze({ ...input, ...signals });
};

export const SYSTEM_ONLY_FIXTURE = makeFixture({
  kind: 'system_only',
  seed: 101,
  knownSources: true,
  delayMs: 40,
  delayErrorMsP95: 4,
  driftPpm: 20,
  erleDb: 18,
  postCorrelation: 0.12,
  correlationReduction: 0.82,
  micLevelChangeDb: 0,
  micSiSdrLossDb: 0,
  remoteErleDb: 18,
  localAttenuationDb: 0,
  reverb: false,
  silence: false,
  weakReference: false,
  clipped: false,
});

export const MIC_ONLY_FIXTURE = makeFixture({
  kind: 'mic_only',
  seed: 202,
  knownSources: true,
  delayMs: 0,
  delayErrorMsP95: 0,
  driftPpm: 0,
  erleDb: 0,
  postCorrelation: 0,
  correlationReduction: 0,
  micLevelChangeDb: 0.6,
  micSiSdrLossDb: 0.7,
  remoteErleDb: 0,
  localAttenuationDb: 0.4,
  reverb: false,
  silence: false,
  weakReference: false,
  clipped: false,
});

export const DOUBLE_TALK_FIXTURE = makeFixture({
  kind: 'double_talk',
  seed: 303,
  knownSources: true,
  delayMs: 60,
  delayErrorMsP95: 6,
  driftPpm: -40,
  erleDb: 12,
  postCorrelation: 0.16,
  correlationReduction: 0.75,
  micLevelChangeDb: 0.8,
  micSiSdrLossDb: 0.8,
  remoteErleDb: 10,
  localAttenuationDb: 2,
  reverb: false,
  silence: false,
  weakReference: false,
  clipped: false,
});

export const DELAY_0_TO_200_MS_FIXTURES = Object.freeze(
  [0, 40, 100, 160, 200].map((delayMs) =>
    makeFixture({
      ...SYSTEM_ONLY_FIXTURE,
      kind: 'delay',
      seed: 400,
      delayMs,
      delayErrorMsP95: 5,
    }),
  ),
);

export const DRIFT_PLUS_MINUS_100_PPM_FIXTURES = Object.freeze(
  [-100, 0, 100].map((driftPpm) =>
    makeFixture({
      ...SYSTEM_ONLY_FIXTURE,
      kind: 'drift',
      seed: 500,
      driftPpm,
      delayErrorMsP95: 5,
    }),
  ),
);

export const REVERB_FIXTURE = makeFixture({
  ...SYSTEM_ONLY_FIXTURE,
  kind: 'reverb',
  seed: 606,
  reverb: true,
  erleDb: 16,
  postCorrelation: 0.18,
  correlationReduction: 0.74,
});

export const SILENCE_FIXTURE = makeFixture({
  ...SYSTEM_ONLY_FIXTURE,
  kind: 'silence',
  seed: 707,
  silence: true,
  erleDb: 0,
  postCorrelation: 0,
  correlationReduction: 0,
});

export const WEAK_REFERENCE_FIXTURE = makeFixture({
  ...SYSTEM_ONLY_FIXTURE,
  kind: 'weak_reference',
  seed: 808,
  weakReference: true,
  erleDb: 4,
  postCorrelation: 0.62,
  correlationReduction: 0.2,
});

export const CLIPPING_FIXTURE = makeFixture({
  ...SYSTEM_ONLY_FIXTURE,
  kind: 'clipping',
  seed: 909,
  clipped: true,
  erleDb: 3,
  postCorrelation: 0.7,
  correlationReduction: 0.1,
});

export const STREAMING_AEC_FIXTURES = Object.freeze([
  SYSTEM_ONLY_FIXTURE,
  MIC_ONLY_FIXTURE,
  DOUBLE_TALK_FIXTURE,
  ...DELAY_0_TO_200_MS_FIXTURES,
  ...DRIFT_PLUS_MINUS_100_PPM_FIXTURES,
  REVERB_FIXTURE,
  SILENCE_FIXTURE,
  WEAK_REFERENCE_FIXTURE,
  CLIPPING_FIXTURE,
]);

export type SyntheticAecGateResult = {
  passes: boolean;
  localSourceGatesApplied: boolean;
  systemOnly: boolean;
  micOnly: boolean;
  doubleTalk: boolean;
  delay: boolean;
  drift: boolean;
};

export type SyntheticAecGateInput = Omit<
  Pick<
    SyntheticAecFixture,
    | 'knownSources'
    | 'erleDb'
    | 'postCorrelation'
    | 'correlationReduction'
    | 'micLevelChangeDb'
    | 'micSiSdrLossDb'
    | 'remoteErleDb'
    | 'localAttenuationDb'
    | 'delayErrorMsP95'
    | 'driftPpm'
    | 'clipped'
    | 'weakReference'
  >,
  never
> & { kind?: SyntheticAecFixtureKind };

export const evaluateSyntheticAecGates = (
  fixture: SyntheticAecGateInput,
): SyntheticAecGateResult => {
  const noSignal = fixture.kind === 'silence';
  const systemGateApplies =
    fixture.kind === undefined ||
    fixture.kind === 'system_only' ||
    fixture.kind === 'delay' ||
    fixture.kind === 'drift' ||
    fixture.kind === 'reverb' ||
    fixture.kind === 'weak_reference' ||
    fixture.kind === 'clipping';
  const micGateApplies =
    fixture.kind === undefined ||
    fixture.kind === 'mic_only' ||
    fixture.kind === 'double_talk';
  const doubleTalkGateApplies =
    fixture.kind === undefined || fixture.kind === 'double_talk';
  const systemOnly =
    !systemGateApplies ||
    (fixture.erleDb >= STREAMING_AEC_GATES.systemOnlyMedianErleDb &&
      fixture.postCorrelation <=
        STREAMING_AEC_GATES.systemOnlyMaxPostCorrelation &&
      fixture.correlationReduction >=
        STREAMING_AEC_GATES.systemOnlyMinCorrelationReduction);
  const localSourceGatesApplied = fixture.knownSources;
  const micOnly =
    !micGateApplies ||
    !localSourceGatesApplied ||
    (fixture.micLevelChangeDb <= STREAMING_AEC_GATES.micOnlyMaxLevelChangeDb &&
      fixture.micSiSdrLossDb <= STREAMING_AEC_GATES.micOnlyMaxSiSdrLossDb);
  const doubleTalk =
    !doubleTalkGateApplies ||
    (fixture.remoteErleDb >= STREAMING_AEC_GATES.doubleTalkMinRemoteErleDb &&
      (!localSourceGatesApplied ||
        fixture.localAttenuationDb <=
          STREAMING_AEC_GATES.doubleTalkMaxLocalAttenuationDb));
  const delay =
    fixture.delayErrorMsP95 <= STREAMING_AEC_GATES.maxDelayErrorMsP95;
  const drift =
    Math.abs(fixture.driftPpm) <= STREAMING_AEC_GATES.maxAbsDriftPpm;
  const passes =
    !fixture.clipped &&
    !fixture.weakReference &&
    (noSignal || (systemOnly && micOnly && doubleTalk && delay && drift));
  return {
    passes,
    localSourceGatesApplied,
    systemOnly,
    micOnly,
    doubleTalk,
    delay,
    drift,
  };
};
