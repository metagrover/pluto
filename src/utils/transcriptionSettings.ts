export type WhisperModel =
  | 'tiny'
  | 'base'
  | 'small'
  | 'medium'
  | 'large-v2'
  | 'large-v3';

export type WhisperDevice = 'cpu' | 'cuda' | 'mps' | 'mlx';

export type WhisperComputeType = 'float16' | 'float32' | 'int8';

export type TranscriptionBackend =
  | 'whisperx_current'
  | 'whisperx_tuned'
  | 'local_alt_apple_silicon';

export type TranscriptionPreset = 'balanced' | 'accuracy_first';

export interface TranscriptionSettings {
  backend?: TranscriptionBackend | null;
  preset?: TranscriptionPreset | null;
  model?: WhisperModel | null;
  device?: WhisperDevice | null;
  computeType?: WhisperComputeType | null;
  language?: string | null;
}

export const DEFAULT_TRANSCRIPTION_SETTINGS: Required<
  Omit<TranscriptionSettings, 'language'>
> & { language: string } = {
  backend: 'local_alt_apple_silicon',
  preset: 'balanced',
  model: 'small',
  device: 'mlx',
  computeType: 'float16',
  language: 'en',
};

export const TRANSCRIPTION_BACKEND_LABELS: Record<
  TranscriptionBackend,
  string
> = {
  whisperx_current: 'WhisperX Current',
  whisperx_tuned: 'WhisperX Tuned',
  local_alt_apple_silicon: 'Local Alt (Apple Silicon)',
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
  return 'local_alt_apple_silicon';
};

export const resolveTranscriptionPreset = (
  preset?: string | null,
): TranscriptionPreset => {
  return preset === 'accuracy_first' || preset === 'balanced'
    ? preset
    : 'balanced';
};

export const resolveTranscriptionSettings = (
  settings?: TranscriptionSettings | null,
): Required<TranscriptionSettings> => {
  return {
    backend: resolveTranscriptionBackend(settings?.backend),
    preset: resolveTranscriptionPreset(settings?.preset),
    model: settings?.model ?? DEFAULT_TRANSCRIPTION_SETTINGS.model,
    device: settings?.device ?? DEFAULT_TRANSCRIPTION_SETTINGS.device,
    computeType:
      settings?.computeType ?? DEFAULT_TRANSCRIPTION_SETTINGS.computeType,
    language: resolveTranscriptionLanguage(settings?.language),
  };
};

export const resolveLiveChunkModel = (model: WhisperModel): WhisperModel =>
  model === 'large-v2' || model === 'large-v3' ? 'medium' : model;

export const resolveLiveChunkComputeType = (
  computeType: WhisperComputeType,
): WhisperComputeType => (computeType === 'float32' ? 'int8' : computeType);
