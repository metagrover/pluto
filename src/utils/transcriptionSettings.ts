export type WhisperModel =
  | 'tiny'
  | 'base'
  | 'small'
  | 'medium'
  | 'large-v2'
  | 'large-v3';

export type WhisperDevice = 'mlx';

export type WhisperComputeType = 'float16';

export type TranscriptionBackend = 'mlx_preview';

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
  backend: TranscriptionBackend;
  preset: TranscriptionPreset;
  model: WhisperModel;
  device: WhisperDevice;
  computeType: WhisperComputeType;
  language: string;
}

export const DEFAULT_TRANSCRIPTION_SETTINGS: ResolvedTranscriptionSettings = {
  backend: 'mlx_preview',
  preset: 'balanced',
  model: 'base',
  device: 'mlx',
  computeType: 'float16',
  language: 'en',
};

export const TRANSCRIPTION_BACKEND_LABELS: Record<
  TranscriptionBackend,
  string
> = {
  mlx_preview: 'MLX live preview',
};

export const TRANSCRIPTION_PRESET_LABELS: Record<TranscriptionPreset, string> =
  {
    balanced: 'Balanced',
    accuracy_first: 'Accuracy First',
  };

export const resolveTranscriptionLanguage = (
  language?: string | null,
): string => {
  const trimmed = typeof language === 'string' ? language.trim() : '';
  return trimmed.length > 0 ? trimmed : DEFAULT_TRANSCRIPTION_SETTINGS.language;
};

export const resolveTranscriptionBackend = (
  _backend?: string | null,
): TranscriptionBackend => {
  return 'mlx_preview';
};

export const resolveTranscriptionPreset = (
  _preset?: string | null,
): TranscriptionPreset => 'balanced';

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
  };
};

export const resolveLiveChunkModel = (model: WhisperModel): WhisperModel =>
  model === 'tiny' ? 'tiny' : 'base';

export const resolveLiveChunkComputeType = (
  _computeType: WhisperComputeType,
): WhisperComputeType => 'float16';
