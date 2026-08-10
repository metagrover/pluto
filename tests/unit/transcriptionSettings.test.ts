import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRANSCRIPTION_SETTINGS,
  resolveLiveChunkComputeType,
  resolveLiveChunkModel,
  resolveTranscriptionBackend,
  resolveTranscriptionLanguage,
  resolveTranscriptionPreset,
  resolveTranscriptionSettings,
} from '../../src/utils/transcriptionSettings';

describe('live chunk transcription settings', () => {
  it('uses bounded settings consistently for live and repair transcription', () => {
    expect(resolveLiveChunkModel('large-v3')).toBe('medium');
    expect(resolveLiveChunkModel('small')).toBe('small');
    expect(resolveLiveChunkComputeType('float32')).toBe('int8');
    expect(resolveLiveChunkComputeType('float16')).toBe('float16');
  });
});

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
    expect(resolved.backend).toBe(DEFAULT_TRANSCRIPTION_SETTINGS.backend);
    expect(resolved.preset).toBe(DEFAULT_TRANSCRIPTION_SETTINGS.preset);
    expect(resolved.model).toBe(DEFAULT_TRANSCRIPTION_SETTINGS.model);
    expect(resolved.device).toBe(DEFAULT_TRANSCRIPTION_SETTINGS.device);
    expect(resolved.computeType).toBe(
      DEFAULT_TRANSCRIPTION_SETTINGS.computeType,
    );
    expect(resolved.language).toBe('en');
  });

  it('normalizes backend and preset values', () => {
    expect(resolveTranscriptionBackend('whisperx_tuned')).toBe(
      'local_alt_apple_silicon',
    );
    expect(resolveTranscriptionBackend('unknown')).toBe(
      DEFAULT_TRANSCRIPTION_SETTINGS.backend,
    );
    expect(resolveTranscriptionPreset('accuracy_first')).toBe('accuracy_first');
    expect(resolveTranscriptionPreset('unknown')).toBe(
      DEFAULT_TRANSCRIPTION_SETTINGS.preset,
    );
  });
});
