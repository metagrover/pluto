/** The private IPC request sent to the AEC worker. */
export type AecWorkerRequest = {
  schemaVersion: 1;
  captureGeneration: string;
  captureSequence: number;
  intervalStartSeconds: number;
  intervalEndSeconds: number;
  micPath: string;
  systemPath: string;
  outputPath: string;
};

export type AecReceiptBase = {
  schemaVersion: 1;
  captureGeneration: string;
  captureSequence: number;
  intervalStartSeconds: number;
  intervalEndSeconds: number;
  micChecksum: string;
  algorithmVersion: string;
  backendRevision: string;
  algorithmConfigDigest: string;
  sampleRateHz: 16000;
  channelCount: 1;
  resamplerVersion: string;
};

export type TrustedAecAudioReceipt = AecReceiptBase & {
  verdict: 'trusted';
  systemChecksum: string;
  derivedChecksum: string;
  derivedAudioRelativePath: string;
  referenceCoverage: number;
  estimatedDelayMs: number;
  driftPpm: number;
  preCorrelation: number;
  postCorrelation: number;
  erleDb: number;
  doubleTalk: boolean;
  clipped: boolean;
  weakReference: boolean;
  confidence: number;
  failure?: never;
};

export const AEC_FAILURES = Object.freeze([
  'missing_reference',
  'coverage_mismatch',
  'weak_reference',
  'clipping',
  'low_confidence',
  'sequence_gap',
  'timeout',
  'worker_exit',
  'queue_overflow',
  'owner_destroyed',
  'cancelled',
  'shutdown',
  'path_rejected',
  'unsupported_audio',
  'duration_mismatch',
  'output_invalid',
  'checksum_mismatch',
  'backend_failed',
] as const);

export type AecFailure = (typeof AEC_FAILURES)[number];

export type UntrustedAecAudioReceipt = AecReceiptBase & {
  verdict: 'untrusted';
  failure: AecFailure;
  systemChecksum?: string;
  derivedChecksum?: string;
  derivedAudioRelativePath?: string;
  metrics?: Partial<
    Pick<
      TrustedAecAudioReceipt,
      | 'referenceCoverage'
      | 'estimatedDelayMs'
      | 'driftPpm'
      | 'preCorrelation'
      | 'postCorrelation'
      | 'erleDb'
      | 'confidence'
    >
  >;
};

export type AecAudioReceipt = TrustedAecAudioReceipt | UntrustedAecAudioReceipt;

/** Immutable minimums for promoting an interval to a trusted receipt. */
export const STREAMING_AEC_TRUSTED_ADMISSION_POLICY = Object.freeze({
  minimumReferenceCoverage: 0.95,
  minimumConfidence: 0.8,
} as const);

export type AecTrustedAdmissionPolicy = {
  readonly minimumReferenceCoverage: number;
  readonly minimumConfidence: number;
};

export type AecAlgorithmConfig = {
  backendRevision: string;
  algorithmVersion: string;
  algorithmParameters: Readonly<Record<string, boolean | number | string>>;
  sampleRateHz: 16000;
  channelCount: 1;
  resamplerVersion: string;
};

export const isAecFailure = (value: unknown): value is AecFailure =>
  typeof value === 'string' &&
  (AEC_FAILURES as readonly string[]).includes(value);
