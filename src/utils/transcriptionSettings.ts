export interface TranscriptionSettings {
  backend?: string | null;
  preset?: string | null;
  model?: string | null;
  device?: string | null;
  computeType?: string | null;
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
