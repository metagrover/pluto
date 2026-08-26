export type TranscriptionPolicyRole = 'live_preview' | 'final_validation';

export type TranscriptionEngine = 'parakeet_eou_320ms' | 'parakeet_coreml';

export type TranscriptionModel = 'parakeet-tdt-0.6b-v3';

export type TranscriptionSource = 'mic' | 'system' | 'mix';

export type TranscriptionVadStatus = 'speech' | 'no_speech' | 'failed';

export type TranscriptionWord = {
  word: string;
  start: number;
  end: number;
  confidence?: number;
};

export type TranscriptionSegment = {
  start: number;
  end: number;
  text: string;
  words?: TranscriptionWord[];
};

export type TranscriptionPolicy = {
  role: TranscriptionPolicyRole;
  engine: TranscriptionEngine;
  model: TranscriptionModel;
  languageMode: 'explicit';
  maxConcurrency: 1;
  wholeSession: boolean;
};

export type TranscriptionRequest = {
  meetingId: string;
  role: TranscriptionPolicyRole;
  source: TranscriptionSource;
  audioPath: string;
  language: string;
  vocabulary?: string[];
  vocabularyPolicyVersion?: string;
  signal?: AbortSignal;
};

export type TranscriptionResultMetadata = {
  role: TranscriptionPolicyRole;
  engine: TranscriptionEngine;
  model: TranscriptionModel;
  providerVersion: string;
  modelBundleVersion?: string;
  language: string;
  source: TranscriptionSource;
  elapsedMs: number;
  confidence?: number;
  vocabularyPolicyVersion?: string;
  vocabularyCount?: number;
};

export type TranscriptionResult = {
  segments: TranscriptionSegment[];
  language: string;
  duration: number;
  vad: {
    status: TranscriptionVadStatus;
    speechSeconds: number;
  };
  meta: TranscriptionResultMetadata;
};

export type TranscriptionRuntimeHealth = {
  ready: boolean;
  engine: TranscriptionEngine;
  liveEngine?: 'parakeet_eou_320ms';
  modelVersion?: string;
  providerVersion?: string;
  modelBundleVersion?: string;
  reason?: string;
};

export type TranscriptionRuntimePlatform = {
  platform: 'darwin' | 'linux' | 'win32' | 'unknown';
  arch: 'arm64' | 'x64' | 'unknown';
};
