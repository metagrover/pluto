import { resolveTranscriptionLanguage } from './transcriptionSettings';
import type {
  TranscriptionBackend,
  TranscriptionPreset,
  WhisperComputeType,
  WhisperDevice,
  WhisperModel,
} from './transcriptionSettings';

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

const ALL_MODELS: WhisperModel[] = [
  'tiny',
  'base',
  'small',
  'medium',
  'large-v2',
  'large-v3',
];

const IS_APPLE_SILICON =
  process.platform === 'darwin' && process.arch === 'arm64';
const HAS_CUDA_HINT =
  process.platform === 'linux' || process.platform === 'win32';

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
): WhisperDevice[] => {
  if (backend === 'local_alt_apple_silicon') {
    return ['cpu'];
  }
  return HAS_CUDA_HINT ? ['cpu', 'cuda'] : ['cpu'];
};

const getSupportedPresets = (
  backend: TranscriptionBackend,
): TranscriptionPreset[] => {
  if (backend === 'whisperx_current') return ['balanced'];
  return ['balanced', 'accuracy_first'];
};

export const getTranscriptionCapabilities = (
  backend: TranscriptionBackend,
): TranscriptionCapabilities => {
  if (backend === 'local_alt_apple_silicon' && !IS_APPLE_SILICON) {
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
    supportedDevices: getSupportedDevices(backend),
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

export const resolveBackendOptions = (options: {
  backend: TranscriptionBackend;
  preset: TranscriptionPreset;
  model?: WhisperModel | null;
  device?: WhisperDevice | null;
  computeType?: WhisperComputeType | null;
  language?: string | null;
}): ResolvedBackendOptions => {
  const capabilities = getTranscriptionCapabilities(options.backend);
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

export const listTranscriptionBackends = (): TranscriptionCapabilities[] => {
  return (
    [
      'whisperx_current',
      'whisperx_tuned',
      'local_alt_apple_silicon',
    ] as TranscriptionBackend[]
  ).map((backend) => getTranscriptionCapabilities(backend));
};
