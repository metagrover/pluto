import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRANSCRIPTION_SETTINGS,
  readConfiguredTranscriptionLanguage,
  resolveTranscriptionBackend,
  resolveTranscriptionLanguage,
  resolveTranscriptionPreset,
  resolveTranscriptionSettings,
} from '../../src/utils/transcriptionSettings';

describe('transcription settings', () => {
  it.each([
    ['auto', 'en', 'auto'],
    ['en', 'auto', 'en'],
    ['invalid', 'auto', 'en'],
    [null, 'auto', 'auto'],
    [null, null, 'en'],
  ])(
    'reads saved preference %j before stored language %j',
    async (saved, stored, expected) => {
      expect(
        await readConfiguredTranscriptionLanguage(async () => saved, stored),
      ).toBe(expected);
    },
  );

  it('uses the stored language when settings cannot be read', async () => {
    expect(
      await readConfiguredTranscriptionLanguage(async () => {
        throw new Error('unavailable');
      }, 'auto'),
    ).toBe('auto');
  });

  it('defaults language to English when unset', () => {
    expect(resolveTranscriptionLanguage(undefined)).toBe('en');
    expect(resolveTranscriptionLanguage('')).toBe('en');
    expect(resolveTranscriptionLanguage('  ')).toBe('en');
  });

  it('normalizes legacy language values to English while preserving auto-detect', () => {
    expect(resolveTranscriptionLanguage('en')).toBe('en');
    expect(resolveTranscriptionLanguage(' EN ')).toBe('en');
    expect(resolveTranscriptionLanguage('auto')).toBe('auto');
    expect(resolveTranscriptionLanguage(' AUTO ')).toBe('auto');
    expect(resolveTranscriptionLanguage('es')).toBe('en');
    expect(resolveTranscriptionLanguage(' fr ')).toBe('en');
  });

  it('resolves transcription settings with defaults and supports auto language', () => {
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

    const autoResolved = resolveTranscriptionSettings({ language: 'auto' });
    expect(autoResolved.language).toBe('auto');
  });

  it('normalizes backend and preset values', () => {
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
