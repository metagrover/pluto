import { evaluateSyntheticAecGates } from '../src/services/streamingAec/syntheticFixtures';

export type WebRtcApmSpikeRecord = {
  kind: 'delay' | 'drift';
  delayMs: number;
  driftPpm: number;
  inputEnergy: number;
  outputEnergy: number;
  preCorrelation: number;
  postCorrelation: number;
  firstResidualDigest: string;
  secondResidualDigest: string;
  measuredDelayErrorMsP95?: number;
  measuredDriftErrorPpm?: number;
  measuredMicLevelChangeDb?: number;
  measuredMicSiSdrLossDb?: number;
  measuredLocalAttenuationDb?: number;
};

export type WebRtcApmSpikeScore = {
  decision: 'webrtc_aec3_selected_for_spike_only' | 'no_backend_selected';
  passes: boolean;
  productionWiringChanged: false;
  records: readonly (WebRtcApmSpikeRecord & {
    erleDb: number;
    correlationReduction: number;
    gatePasses: boolean;
    deterministic: boolean;
  })[];
};

const finite = (value: number): boolean => Number.isFinite(value);

export const scoreWebRtcApmSpikeResults = (
  records: readonly WebRtcApmSpikeRecord[],
): WebRtcApmSpikeScore => {
  const scored = records.map((record) => {
    const erleDb =
      record.inputEnergy > 0 && record.outputEnergy > 0
        ? 10 * Math.log10(record.inputEnergy / record.outputEnergy)
        : Number.NEGATIVE_INFINITY;
    const correlationReduction =
      Math.abs(record.preCorrelation) > 0
        ? 1 - Math.abs(record.postCorrelation / record.preCorrelation)
        : 0;
    const deterministic =
      /^[a-f0-9]{64}$/.test(record.firstResidualDigest) &&
      record.firstResidualDigest === record.secondResidualDigest;
    const hasCompleteMeasurements =
      finite(record.measuredDelayErrorMsP95 ?? Number.NaN) &&
      finite(record.measuredDriftErrorPpm ?? Number.NaN) &&
      finite(record.measuredMicLevelChangeDb ?? Number.NaN) &&
      finite(record.measuredMicSiSdrLossDb ?? Number.NaN) &&
      finite(record.measuredLocalAttenuationDb ?? Number.NaN);
    const gatePasses =
      hasCompleteMeasurements &&
      finite(erleDb) &&
      finite(correlationReduction) &&
      finite(record.postCorrelation) &&
      evaluateSyntheticAecGates({
        kind: record.kind,
        knownSources: true,
        erleDb,
        postCorrelation: Math.abs(record.postCorrelation),
        correlationReduction,
        micLevelChangeDb: record.measuredMicLevelChangeDb ?? Number.NaN,
        micSiSdrLossDb: record.measuredMicSiSdrLossDb ?? Number.NaN,
        remoteErleDb: erleDb,
        localAttenuationDb: record.measuredLocalAttenuationDb ?? Number.NaN,
        delayErrorMsP95: record.measuredDelayErrorMsP95 ?? Number.NaN,
        driftPpm: record.measuredDriftErrorPpm ?? Number.NaN,
        clipped: false,
        weakReference: false,
      }).passes;

    return {
      ...record,
      erleDb,
      correlationReduction,
      gatePasses,
      deterministic,
    };
  });
  const passes =
    scored.length > 0 &&
    scored.some((record) => record.kind === 'delay') &&
    scored.some((record) => record.kind === 'drift') &&
    scored.every((record) => record.gatePasses && record.deterministic);

  return {
    decision: passes
      ? 'webrtc_aec3_selected_for_spike_only'
      : 'no_backend_selected',
    passes,
    productionWiringChanged: false,
    records: scored,
  };
};
