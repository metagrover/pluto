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
  mlx_preview: 'MLX live preview',
};

const getSupportedDevices = (): WhisperDevice[] => ['mlx'];

const getSupportedComputeTypes = (): WhisperComputeType[] => ['float16'];

const getSupportedPresets = (): TranscriptionPreset[] => ['balanced'];

export const getTranscriptionCapabilities = (
  _backend: TranscriptionBackend,
  runtime?: RuntimePlatformInput,
): TranscriptionCapabilities => {
  const backend: TranscriptionBackend = 'mlx_preview';
  const runtimePlatform = resolveRuntimePlatform(runtime);
  const isAppleSilicon =
    runtimePlatform.platform === 'darwin' && runtimePlatform.arch === 'arm64';
  if (backend === 'mlx_preview' && !isAppleSilicon) {
    return {
      backend,
      available: false,
      providerLabel: TRANSCRIPTION_BACKEND_LABELS[backend],
      supportedDevices: ['mlx'],
      supportedComputeTypes: ['float16'],
      supportedModels: ALL_MODELS,
      supportedPresets: getSupportedPresets(),
      reason: 'Pluto transcription requires an Apple Silicon Mac.',
    };
  }

  return {
    backend,
    available: true,
    providerLabel: TRANSCRIPTION_BACKEND_LABELS[backend],
    supportedDevices: getSupportedDevices(),
    supportedComputeTypes: getSupportedComputeTypes(),
    supportedModels: ALL_MODELS,
    supportedPresets: getSupportedPresets(),
    reason:
      backend === 'mlx_preview'
        ? 'Runs locally with MLX Whisper on Apple Silicon.'
        : undefined,
  };
};

const getPresetDefaults = (
  _backend: TranscriptionBackend,
  preset: TranscriptionPreset,
): Pick<ResolvedBackendOptions, 'model' | 'device' | 'computeType'> => {
  void preset;
  return { model: 'base', device: 'mlx', computeType: 'float16' };
};

export const resolvePreferredTranscriptionBackend = ({
  configuredBackend,
  runtime,
  health,
}: {
  configuredBackend?: string | null;
  runtime?: RuntimePlatformInput;
  health: { mlxAvailable: boolean };
}): { backend: TranscriptionBackend; shouldPersist: boolean } => {
  void runtime;
  void health;
  return {
    backend: 'mlx_preview',
    shouldPersist:
      configuredBackend != null && configuredBackend !== 'mlx_preview',
  };
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
  void runtime;
  const backend: TranscriptionBackend = 'mlx_preview';
  const preset = 'balanced';
  const defaults = getPresetDefaults(backend, preset);
  const warnings: string[] = [];

  if (
    options.backend !== backend ||
    (options.device !== undefined && options.device !== 'mlx') ||
    (options.computeType !== undefined && options.computeType !== 'float16')
  )
    warnings.push('Applied the fixed MLX live-preview configuration.');
  const device: WhisperDevice = 'mlx';
  const computeType: WhisperComputeType = 'float16';

  return {
    backend,
    preset,
    providerLabel: TRANSCRIPTION_BACKEND_LABELS[backend],
    model: defaults.model,
    device,
    computeType,
    language: resolveTranscriptionLanguage(options.language),
    warnings,
  };
};

export const listTranscriptionBackends = (
  runtime?: RuntimePlatformInput,
): TranscriptionCapabilities[] => {
  return [getTranscriptionCapabilities('mlx_preview', runtime)];
};
