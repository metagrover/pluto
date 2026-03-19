export type WhisperModel =
  | 'tiny'
  | 'base'
  | 'small'
  | 'medium'
  | 'large-v2'
  | 'large-v3';

export type WhisperDevice = 'cpu' | 'cuda' | 'mps';

export type WhisperComputeType = 'float16' | 'float32' | 'int8';

export interface TranscriptionSettings {
  model?: WhisperModel | null;
  device?: WhisperDevice | null;
  computeType?: WhisperComputeType | null;
  language?: string | null;
}

export const DEFAULT_TRANSCRIPTION_SETTINGS: Required<
  Omit<TranscriptionSettings, 'language'>
> & { language: string } = {
  model: 'small',
  device: 'cpu',
  computeType: 'int8',
  language: 'en',
};

export const resolveTranscriptionLanguage = (
  language?: string | null,
): string => {
  const trimmed = typeof language === 'string' ? language.trim() : '';
  return trimmed.length > 0 ? trimmed : DEFAULT_TRANSCRIPTION_SETTINGS.language;
};

export const resolveTranscriptionSettings = (
  settings?: TranscriptionSettings | null,
): Required<TranscriptionSettings> => {
  return {
    model: settings?.model ?? DEFAULT_TRANSCRIPTION_SETTINGS.model,
    device: settings?.device ?? DEFAULT_TRANSCRIPTION_SETTINGS.device,
    computeType:
      settings?.computeType ?? DEFAULT_TRANSCRIPTION_SETTINGS.computeType,
    language: resolveTranscriptionLanguage(settings?.language),
  };
};
