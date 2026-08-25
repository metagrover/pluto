import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRANSCRIPTION_SETTINGS,
  resolveTranscriptionBackend,
  resolveTranscriptionLanguage,
  resolveTranscriptionPreset,
  resolveTranscriptionSettings,
} from '../../src/utils/transcriptionSettings';

describe('transcription settings', () => {
  it('defaults language to English when unset', () => {
    expect(resolveTranscriptionLanguage(undefined)).toBe('en');
    expect(resolveTranscriptionLanguage('')).toBe('en');
    expect(resolveTranscriptionLanguage('  ')).toBe('en');
  });

  it('normalizes every legacy language value to English', () => {
    expect(resolveTranscriptionLanguage('es')).toBe('en');
    expect(resolveTranscriptionLanguage(' fr ')).toBe('en');
  });

  it('resolves transcription settings with defaults', () => {
    const resolved = resolveTranscriptionSettings({});
    expect(resolved.backend).toBe(DEFAULT_TRANSCRIPTION_SETTINGS.backend);
    expect(resolved.preset).toBe(DEFAULT_TRANSCRIPTION_SETTINGS.preset);
    expect(resolved.model).toBe(DEFAULT_TRANSCRIPTION_SETTINGS.model);
    expect(resolved.device).toBe(DEFAULT_TRANSCRIPTION_SETTINGS.device);
    expect(resolved.computeType).toBe(
      DEFAULT_TRANSCRIPTION_SETTINGS.computeType,
    );
    expect(resolved.language).toBe('en');
    expect(resolved.model).toBe('parakeet-tdt-0.6b-v3');
    expect(resolved.device).toBe('coreml');
    expect(resolved.liveEngine).toBe('parakeet_eou_320ms');
    expect(resolved.finalEngine).toBe('parakeet_coreml');
  });

  it('normalizes backend and preset values', () => {
    expect(resolveTranscriptionBackend('mlx_preview')).toBe('parakeet');
    expect(resolveTranscriptionBackend('obsolete')).toBe('parakeet');
    expect(resolveTranscriptionBackend('unknown')).toBe(
      DEFAULT_TRANSCRIPTION_SETTINGS.backend,
    );
    expect(resolveTranscriptionPreset('accuracy_first')).toBe('balanced');
    expect(resolveTranscriptionPreset('unknown')).toBe(
      DEFAULT_TRANSCRIPTION_SETTINGS.preset,
    );
  });
});
