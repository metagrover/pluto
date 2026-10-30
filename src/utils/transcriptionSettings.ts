export type TranscriptionLanguage = 'en' | 'auto';

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
  language: TranscriptionLanguage;
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

export const resolveTranscriptionLanguage = (
  language?: string | null,
): TranscriptionLanguage => {
  return language?.trim().toLowerCase() === 'auto' ? 'auto' : 'en';
};

export const TRANSCRIPTION_LANGUAGE_SETTING_KEY = 'transcription_language';

/**
 * Reads the user's saved final-transcription language. The saved setting is
 * authoritative for every final run (automatic, retry, speaker labels), so a
 * user who chooses Auto-detect gets a null native hint on every run. Missing
 * or unreadable settings fall back to any stored meeting language or English.
 */
export const readConfiguredTranscriptionLanguage = async (
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  fallbackLanguage?: string | null,
): Promise<TranscriptionLanguage> => {
  try {
    const value = await invoke(
      'GET_SETTING',
      TRANSCRIPTION_LANGUAGE_SETTING_KEY,
    );
    if (typeof value === 'string' && value.trim()) {
      return resolveTranscriptionLanguage(value);
    }
  } catch {
    // Fall back when GET_SETTING is unavailable in narrow test harnesses.
  }
  return resolveTranscriptionLanguage(fallbackLanguage);
};

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
