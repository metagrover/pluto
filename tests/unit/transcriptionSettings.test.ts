import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRANSCRIPTION_SETTINGS,
  resolveTranscriptionLanguage,
  resolveTranscriptionSettings,
} from '../../src/utils/transcriptionSettings';

describe('transcription settings', () => {
  it('defaults language to English when unset', () => {
    expect(resolveTranscriptionLanguage(undefined)).toBe('en');
    expect(resolveTranscriptionLanguage('')).toBe('en');
    expect(resolveTranscriptionLanguage('  ')).toBe('en');
  });

  it('keeps explicit language overrides', () => {
    expect(resolveTranscriptionLanguage('es')).toBe('es');
    expect(resolveTranscriptionLanguage(' fr ')).toBe('fr');
  });

  it('resolves transcription settings with defaults', () => {
    const resolved = resolveTranscriptionSettings({});
    expect(resolved.model).toBe(DEFAULT_TRANSCRIPTION_SETTINGS.model);
    expect(resolved.device).toBe(DEFAULT_TRANSCRIPTION_SETTINGS.device);
    expect(resolved.computeType).toBe(
      DEFAULT_TRANSCRIPTION_SETTINGS.computeType,
    );
    expect(resolved.language).toBe('en');
  });
});
