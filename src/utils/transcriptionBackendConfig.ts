import { resolveTranscriptionLanguage } from './transcriptionSettings.ts';
import type {
  TranscriptionBackend,
  TranscriptionPreset,
  WhisperComputeType,
  WhisperDevice,
  WhisperModel,
} from './transcriptionSettings.ts';

export interface TranscriptionCapabilities {
  backend: TranscriptionBackend;
  available: boolean;
  providerLabel: string;
  supportedDevices: WhisperDevice[];
  supportedComputeTypes: WhisperComputeType[];
  supportedModels: WhisperModel[];
  supportedPresets: TranscriptionPreset[];
  reason?: string;
}

export interface ResolvedBackendOptions {
  backend: TranscriptionBackend;
  preset: TranscriptionPreset;
  providerLabel: string;
  model: WhisperModel;
  device: WhisperDevice;
  computeType: WhisperComputeType;
  language: string;
  warnings: string[];
}

export type PlutoRuntimePlatform = {
  platform: 'darwin' | 'linux' | 'win32' | 'unknown';
  arch: 'arm64' | 'x64' | 'unknown';
};

type RuntimePlatformInput = {
  platform?: unknown;
  arch?: unknown;
};

const ALL_MODELS: WhisperModel[] = [
  'tiny',
  'base',
  'small',
  'medium',
  'large-v2',
  'large-v3',
];

export const normalizePlutoRuntimePlatform = (
  value?: RuntimePlatformInput,
): PlutoRuntimePlatform => ({
  platform:
    value?.platform === 'darwin' ||
    value?.platform === 'linux' ||
    value?.platform === 'win32'
      ? value.platform
      : 'unknown',
  arch:
    value?.arch === 'arm64' || value?.arch === 'x64' ? value.arch : 'unknown',
});

const resolveRuntimePlatform = (
  value?: RuntimePlatformInput,
): PlutoRuntimePlatform => {
  if (value) return normalizePlutoRuntimePlatform(value);
  if (typeof window !== 'undefined' && window.plutoRuntimePlatform) {
    return normalizePlutoRuntimePlatform(window.plutoRuntimePlatform);
  }
  if (typeof process !== 'undefined') {
    return normalizePlutoRuntimePlatform(process);
  }
  return normalizePlutoRuntimePlatform();
};

export const TRANSCRIPTION_BACKEND_LABELS: Record<
  TranscriptionBackend,
  string
> = {
  whisperx_current: 'WhisperX Current',
  whisperx_tuned: 'WhisperX Tuned',
  local_alt_apple_silicon: 'Local Alt (Apple Silicon)',
};

const getSupportedDevices = (
  backend: TranscriptionBackend,
  runtimePlatform: PlutoRuntimePlatform,
): WhisperDevice[] => {
  if (backend === 'local_alt_apple_silicon') {
    return ['cpu'];
  }
  return runtimePlatform.platform === 'linux' ||
    runtimePlatform.platform === 'win32'
    ? ['cpu', 'cuda']
    : ['cpu'];
};

const getSupportedPresets = (
  backend: TranscriptionBackend,
): TranscriptionPreset[] => {
  if (backend === 'whisperx_current') return ['balanced'];
  return ['balanced', 'accuracy_first'];
};

export const getTranscriptionCapabilities = (
  backend: TranscriptionBackend,
  runtime?: RuntimePlatformInput,
): TranscriptionCapabilities => {
  const runtimePlatform = resolveRuntimePlatform(runtime);
  const isAppleSilicon =
    runtimePlatform.platform === 'darwin' && runtimePlatform.arch === 'arm64';
  if (backend === 'local_alt_apple_silicon' && !isAppleSilicon) {
    return {
      backend,
      available: false,
      providerLabel: TRANSCRIPTION_BACKEND_LABELS[backend],
      supportedDevices: ['cpu'],
      supportedComputeTypes: ['int8', 'float32'],
      supportedModels: ALL_MODELS,
      supportedPresets: getSupportedPresets(backend),
      reason: 'Requires Apple Silicon hardware for benchmarking.',
    };
  }

  return {
    backend,
    available: true,
    providerLabel: TRANSCRIPTION_BACKEND_LABELS[backend],
    supportedDevices: getSupportedDevices(backend, runtimePlatform),
    supportedComputeTypes: ['int8', 'float32'],
    supportedModels: ALL_MODELS,
    supportedPresets: getSupportedPresets(backend),
    reason:
      backend === 'local_alt_apple_silicon'
        ? 'Runs on the current WhisperX sidecar until a dedicated Apple Silicon runtime is added.'
        : undefined,
  };
};

const getPresetDefaults = (
  backend: TranscriptionBackend,
  preset: TranscriptionPreset,
): Pick<ResolvedBackendOptions, 'model' | 'device' | 'computeType'> => {
  if (backend === 'whisperx_current') {
    return { model: 'small', device: 'cpu', computeType: 'int8' };
  }
  if (backend === 'whisperx_tuned') {
    if (preset === 'accuracy_first') {
      return { model: 'large-v3', device: 'cpu', computeType: 'float32' };
    }
    return { model: 'medium', device: 'cpu', computeType: 'int8' };
  }
  if (preset === 'accuracy_first') {
    return { model: 'large-v3', device: 'cpu', computeType: 'float32' };
  }
  return { model: 'medium', device: 'cpu', computeType: 'int8' };
};

export const resolveBackendOptions = (
  options: {
    backend: TranscriptionBackend;
    preset: TranscriptionPreset;
    model?: WhisperModel | null;
    device?: WhisperDevice | null;
    computeType?: WhisperComputeType | null;
    language?: string | null;
  },
  runtime?: RuntimePlatformInput,
): ResolvedBackendOptions => {
  const capabilities = getTranscriptionCapabilities(options.backend, runtime);
  const preset = capabilities.supportedPresets.includes(options.preset)
    ? options.preset
    : capabilities.supportedPresets[0];
  const defaults = getPresetDefaults(options.backend, preset);
  const warnings: string[] = [];

  let device = (options.device ?? defaults.device) as WhisperDevice;
  if (!capabilities.supportedDevices.includes(device)) {
    warnings.push(
      `Device "${device}" is not supported by ${TRANSCRIPTION_BACKEND_LABELS[options.backend]}; using ${capabilities.supportedDevices[0]}.`,
    );
    device = capabilities.supportedDevices[0];
  }

  let computeType = (options.computeType ??
    defaults.computeType) as WhisperComputeType;
  if (device === 'cpu' && computeType === 'float16') {
    const fallback = preset === 'accuracy_first' ? 'float32' : 'int8';
    warnings.push(
      `Compute type "float16" is not supported on CPU for ${TRANSCRIPTION_BACKEND_LABELS[options.backend]}; using ${fallback}.`,
    );
    computeType = fallback;
  }

  return {
    backend: options.backend,
    preset,
    providerLabel: TRANSCRIPTION_BACKEND_LABELS[options.backend],
    model: (options.model ?? defaults.model) as WhisperModel,
    device,
    computeType,
    language: resolveTranscriptionLanguage(options.language),
    warnings,
  };
};

export const listTranscriptionBackends = (
  runtime?: RuntimePlatformInput,
): TranscriptionCapabilities[] => {
  return (
    [
      'whisperx_current',
      'whisperx_tuned',
      'local_alt_apple_silicon',
    ] as TranscriptionBackend[]
  ).map((backend) => getTranscriptionCapabilities(backend, runtime));
};
