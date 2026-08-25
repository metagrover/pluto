export type WhisperModel =
  | 'tiny'
  | 'base'
  | 'small'
  | 'medium'
  | 'large-v2'
  | 'large-v3';

export type WhisperDevice = 'mlx';

export type WhisperComputeType = 'float16';

export type TranscriptionBackend = 'parakeet' | 'mlx_preview';

export type TranscriptionPreset = 'balanced' | 'accuracy_first';

export interface TranscriptionSettings {
  backend?: TranscriptionBackend | null;
  preset?: TranscriptionPreset | null;
  model?: WhisperModel | null;
  device?: WhisperDevice | null;
  computeType?: WhisperComputeType | null;
  language?: string | null;
}

export interface ResolvedTranscriptionSettings {
  backend: 'parakeet';
  preset: 'balanced';
  model: 'parakeet-tdt-0.6b-v3';
  device: 'coreml';
  computeType: 'float16';
  language: 'en';
  liveEngine: 'parakeet_eou_320ms';
  finalEngine: 'parakeet_coreml';
}

export const DEFAULT_TRANSCRIPTION_SETTINGS: ResolvedTranscriptionSettings = {
  backend: 'parakeet',
  preset: 'balanced',
  model: 'parakeet-tdt-0.6b-v3',
  device: 'coreml',
  computeType: 'float16',
  language: 'en',
  liveEngine: 'parakeet_eou_320ms',
  finalEngine: 'parakeet_coreml',
};

export const TRANSCRIPTION_BACKEND_LABELS: Record<
  TranscriptionBackend,
  string
> = {
  parakeet: 'Parakeet live and final',
  mlx_preview: 'MLX live preview',
};

export const TRANSCRIPTION_PRESET_LABELS: Record<TranscriptionPreset, string> =
  {
    balanced: 'Balanced',
    accuracy_first: 'Accuracy First',
  };

export const resolveTranscriptionLanguage = (_language?: string | null): 'en' =>
  'en';

export const resolveTranscriptionBackend = (
  _backend?: string | null,
): 'parakeet' => {
  return 'parakeet';
};

export const resolveTranscriptionPreset = (
  _preset?: string | null,
): 'balanced' => 'balanced';

export const resolveTranscriptionSettings = (
  settings?: TranscriptionSettings | null,
): ResolvedTranscriptionSettings => {
  return {
    backend: resolveTranscriptionBackend(settings?.backend),
    preset: resolveTranscriptionPreset(settings?.preset),
    model: DEFAULT_TRANSCRIPTION_SETTINGS.model,
    device: DEFAULT_TRANSCRIPTION_SETTINGS.device,
    computeType: DEFAULT_TRANSCRIPTION_SETTINGS.computeType,
    language: resolveTranscriptionLanguage(settings?.language),
    liveEngine: 'parakeet_eou_320ms',
    finalEngine: 'parakeet_coreml',
  };
};

export const resolveLiveChunkModel = (model: WhisperModel): WhisperModel =>
  model === 'tiny' ? 'tiny' : 'base';

export const resolveLiveChunkComputeType = (
  _computeType: WhisperComputeType,
): WhisperComputeType => 'float16';
