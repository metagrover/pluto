import type {
  TranscriptionPolicy,
  TranscriptionPolicyRole,
  TranscriptionRuntimePlatform,
} from './contracts.ts';

const LIVE_PREVIEW_POLICY: TranscriptionPolicy = {
  role: 'live_preview',
  engine: 'parakeet_eou_320ms',
  model: 'parakeet-tdt-0.6b-v3',
  languageMode: 'explicit',
  maxConcurrency: 1,
  wholeSession: false,
};

const FINAL_VALIDATION_POLICY: TranscriptionPolicy = {
  role: 'final_validation',
  engine: 'parakeet_coreml',
  model: 'parakeet-tdt-0.6b-v3',
  languageMode: 'explicit',
  maxConcurrency: 1,
  wholeSession: true,
};

export const resolveTranscriptionPolicy = (
  role: TranscriptionPolicyRole,
): TranscriptionPolicy =>
  role === 'live_preview' ? LIVE_PREVIEW_POLICY : FINAL_VALIDATION_POLICY;

export const assertTranscriptionPolicySupported = (
  _role: TranscriptionPolicyRole,
  runtime: TranscriptionRuntimePlatform,
): void => {
  if (runtime.platform !== 'darwin' || runtime.arch !== 'arm64') {
    throw new Error('transcription_platform_unsupported');
  }
};
