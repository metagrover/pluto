import { createHash } from 'node:crypto';

import {
  AEC_FAILURES,
  type AecAlgorithmConfig,
  type AecAudioReceipt,
  type AecFailure,
  type AecReceiptBase,
  type AecWorkerRequest,
  STREAMING_AEC_TRUSTED_ADMISSION_POLICY,
  type TrustedAecAudioReceipt,
  type UntrustedAecAudioReceipt,
  isAecFailure,
} from './contracts';

const BASE_KEYS = [
  'schemaVersion',
  'captureGeneration',
  'captureSequence',
  'intervalStartSeconds',
  'intervalEndSeconds',
  'micChecksum',
  'algorithmVersion',
  'backendRevision',
  'algorithmConfigDigest',
  'sampleRateHz',
  'channelCount',
  'resamplerVersion',
] as const;

const TRUSTED_KEYS = [
  ...BASE_KEYS,
  'verdict',
  'systemChecksum',
  'derivedChecksum',
  'derivedAudioRelativePath',
  'referenceCoverage',
  'estimatedDelayMs',
  'driftPpm',
  'preCorrelation',
  'postCorrelation',
  'erleDb',
  'doubleTalk',
  'clipped',
  'weakReference',
  'confidence',
] as const;

const UNTRUSTED_KEYS = [
  ...BASE_KEYS,
  'verdict',
  'failure',
  'systemChecksum',
  'derivedChecksum',
  'derivedAudioRelativePath',
  'metrics',
] as const;

const METRIC_KEYS = [
  'referenceCoverage',
  'estimatedDelayMs',
  'driftPpm',
  'preCorrelation',
  'postCorrelation',
  'erleDb',
  'confidence',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => Object.keys(value).every((key) => keys.includes(key));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isOpaqueIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value);

const isDerivedArtifactPath = (
  value: unknown,
  captureSequence: unknown,
): value is string =>
  typeof value === 'string' &&
  typeof captureSequence === 'number' &&
  Number.isSafeInteger(captureSequence) &&
  captureSequence >= 0 &&
  value === `aec/${captureSequence}.wav`;

const isChecksum = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

const validBoundaries = (value: Record<string, unknown>): boolean =>
  isFiniteNumber(value.captureSequence) &&
  Number.isSafeInteger(value.captureSequence) &&
  value.captureSequence >= 0 &&
  isFiniteNumber(value.intervalStartSeconds) &&
  value.intervalStartSeconds >= 0 &&
  isFiniteNumber(value.intervalEndSeconds) &&
  value.intervalEndSeconds > value.intervalStartSeconds;

const validBase = (
  value: Record<string, unknown>,
): value is AecReceiptBase & Record<string, unknown> =>
  hasOnlyKeys(value, [...TRUSTED_KEYS, ...UNTRUSTED_KEYS]) &&
  value.schemaVersion === 1 &&
  isOpaqueIdentifier(value.captureGeneration) &&
  validBoundaries(value) &&
  isChecksum(value.micChecksum) &&
  isOpaqueIdentifier(value.algorithmVersion) &&
  isOpaqueIdentifier(value.backendRevision) &&
  isChecksum(value.algorithmConfigDigest) &&
  value.sampleRateHz === 16000 &&
  value.channelCount === 1 &&
  isOpaqueIdentifier(value.resamplerVersion);

const validMetric = (
  key: (typeof METRIC_KEYS)[number],
  value: unknown,
): boolean => {
  if (!isFiniteNumber(value)) return false;
  if (key === 'referenceCoverage' || key === 'confidence')
    return value >= 0 && value <= 1;
  if (key === 'preCorrelation' || key === 'postCorrelation')
    return value >= -1 && value <= 1;
  if (key === 'estimatedDelayMs') return value >= 0 && value <= 200;
  if (key === 'driftPpm') return value >= -1000 && value <= 1000;
  if (key === 'erleDb') return value >= -100 && value <= 200;
  return true;
};

const validMetrics = (value: unknown): value is Record<string, number> => {
  if (!isRecord(value) || !hasOnlyKeys(value, METRIC_KEYS)) return false;
  return Object.entries(value).every(([key, metric]) =>
    validMetric(key as (typeof METRIC_KEYS)[number], metric),
  );
};

const trustedAdmissionFailure = (
  value: Record<string, unknown>,
): AecFailure | undefined => {
  if (value.clipped === true) return 'clipping';
  if (value.weakReference === true) return 'weak_reference';
  if (
    isFiniteNumber(value.referenceCoverage) &&
    value.referenceCoverage <
      STREAMING_AEC_TRUSTED_ADMISSION_POLICY.minimumReferenceCoverage
  ) {
    return 'coverage_mismatch';
  }
  if (
    isFiniteNumber(value.confidence) &&
    value.confidence < STREAMING_AEC_TRUSTED_ADMISSION_POLICY.minimumConfidence
  ) {
    return 'low_confidence';
  }
  return undefined;
};

const validTrusted = (
  value: Record<string, unknown>,
): value is TrustedAecAudioReceipt =>
  hasOnlyKeys(value, TRUSTED_KEYS) &&
  validBase(value) &&
  value.verdict === 'trusted' &&
  isChecksum(value.systemChecksum) &&
  isChecksum(value.derivedChecksum) &&
  isDerivedArtifactPath(
    value.derivedAudioRelativePath,
    value.captureSequence,
  ) &&
  isFiniteNumber(value.referenceCoverage) &&
  value.referenceCoverage >= 0 &&
  value.referenceCoverage <= 1 &&
  isFiniteNumber(value.estimatedDelayMs) &&
  isFiniteNumber(value.driftPpm) &&
  isFiniteNumber(value.preCorrelation) &&
  value.preCorrelation >= -1 &&
  value.preCorrelation <= 1 &&
  isFiniteNumber(value.postCorrelation) &&
  value.postCorrelation >= -1 &&
  value.postCorrelation <= 1 &&
  isFiniteNumber(value.erleDb) &&
  typeof value.doubleTalk === 'boolean' &&
  typeof value.clipped === 'boolean' &&
  typeof value.weakReference === 'boolean' &&
  isFiniteNumber(value.confidence) &&
  value.confidence >= 0 &&
  value.confidence <= 1 &&
  value.referenceCoverage >=
    STREAMING_AEC_TRUSTED_ADMISSION_POLICY.minimumReferenceCoverage &&
  value.confidence >=
    STREAMING_AEC_TRUSTED_ADMISSION_POLICY.minimumConfidence &&
  value.clipped === false &&
  value.weakReference === false &&
  value.estimatedDelayMs >= 0 &&
  value.estimatedDelayMs <= 200 &&
  value.driftPpm >= -1000 &&
  value.driftPpm <= 1000 &&
  value.erleDb >= -100 &&
  value.erleDb <= 200;

const validUntrusted = (
  value: Record<string, unknown>,
): value is UntrustedAecAudioReceipt => {
  if (
    !hasOnlyKeys(value, UNTRUSTED_KEYS) ||
    !validBase(value) ||
    value.verdict !== 'untrusted'
  ) {
    return false;
  }
  if (!isAecFailure(value.failure)) return false;
  if (value.systemChecksum !== undefined && !isChecksum(value.systemChecksum))
    return false;
  if (value.derivedChecksum !== undefined && !isChecksum(value.derivedChecksum))
    return false;
  if (
    value.derivedAudioRelativePath !== undefined &&
    !isDerivedArtifactPath(
      value.derivedAudioRelativePath,
      value.captureSequence,
    )
  ) {
    return false;
  }
  return value.metrics === undefined || validMetrics(value.metrics);
};

export type AecEvidenceValidation =
  | { valid: true; receipt: AecAudioReceipt }
  | { valid: false; reason: 'invalid_receipt'; failure?: AecFailure };

export const validateAecAudioReceipt = (
  value: unknown,
): AecEvidenceValidation => {
  if (!isRecord(value)) return { valid: false, reason: 'invalid_receipt' };
  if (value.verdict === 'trusted') {
    const failure = trustedAdmissionFailure(value);
    if (failure) return { valid: false, reason: 'invalid_receipt', failure };
    if (validTrusted(value)) return { valid: true, receipt: value };
  }
  if (value.verdict === 'untrusted' && validUntrusted(value)) {
    return { valid: true, receipt: value };
  }
  return { valid: false, reason: 'invalid_receipt' };
};

export const isAecAudioReceipt = (value: unknown): value is AecAudioReceipt =>
  validateAecAudioReceipt(value).valid;

export const assertAecAudioReceipt = (value: unknown): AecAudioReceipt => {
  const validation = validateAecAudioReceipt(value);
  if (!validation.valid) throw new Error('invalid AEC receipt');
  return validation.receipt;
};

/** Worker requests are private and may carry approved absolute paths. */
export const isAecWorkerRequest = (
  value: unknown,
): value is AecWorkerRequest => {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).length === 8 &&
    value.schemaVersion === 1 &&
    isNonEmptyString(value.captureGeneration) &&
    isFiniteNumber(value.captureSequence) &&
    Number.isSafeInteger(value.captureSequence) &&
    value.captureSequence >= 0 &&
    isFiniteNumber(value.intervalStartSeconds) &&
    value.intervalStartSeconds >= 0 &&
    isFiniteNumber(value.intervalEndSeconds) &&
    value.intervalEndSeconds > value.intervalStartSeconds &&
    isNonEmptyString(value.micPath) &&
    isNonEmptyString(value.systemPath) &&
    isNonEmptyString(value.outputPath)
  );
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`;
};

/**
 * Produces the receipt-bound digest. The canonical input includes the backend,
 * algorithm parameters, the 16 kHz mono policy, resampler revision, and the
 * immutable trusted-admission thresholds.
 */
export const createAecAlgorithmConfigDigest = (
  config: AecAlgorithmConfig,
): string => {
  if (config.sampleRateHz !== 16000 || config.channelCount !== 1) {
    throw new Error('AEC configuration must be 16 kHz mono');
  }
  if (
    'trustedAdmissionPolicy' in (config as unknown as Record<string, unknown>)
  ) {
    throw new Error('immutable trusted admission policy');
  }
  const canonical = stableJson({
    algorithmParameters: config.algorithmParameters,
    algorithmVersion: config.algorithmVersion,
    backendRevision: config.backendRevision,
    channelCount: config.channelCount,
    resamplerVersion: config.resamplerVersion,
    sampleRateHz: config.sampleRateHz,
    trustedAdmissionPolicy: STREAMING_AEC_TRUSTED_ADMISSION_POLICY,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
};

export const isAecAlgorithmConfigDigest = (
  receipt: Pick<
    AecReceiptBase,
    | 'algorithmConfigDigest'
    | 'algorithmVersion'
    | 'backendRevision'
    | 'sampleRateHz'
    | 'channelCount'
    | 'resamplerVersion'
  >,
  config: AecAlgorithmConfig,
): boolean =>
  receipt.algorithmConfigDigest === createAecAlgorithmConfigDigest(config) &&
  receipt.algorithmVersion === config.algorithmVersion &&
  receipt.backendRevision === config.backendRevision &&
  receipt.sampleRateHz === 16000 &&
  receipt.channelCount === 1 &&
  receipt.resamplerVersion === config.resamplerVersion;

export { AEC_FAILURES };
