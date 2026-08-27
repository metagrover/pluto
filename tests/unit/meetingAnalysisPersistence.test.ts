import { describe, expect, it } from 'vitest';

import { buildRegeneratedAnalysisPersistence } from '../../src/components/features/meetingAnalysisPersistence';

describe('buildRegeneratedAnalysisPersistence', () => {
  it('replaces stale generation provenance and clears a stale processing marker', () => {
    const result = buildRegeneratedAnalysisPersistence(
      {
        analysis_provider: 'old-provider',
        analysis_model: 'old-model',
        analysis_generation_path: 'single_pass',
        analysis_prompt_version: 'notes-v1',
        analysis_generated_at: '2026-01-01T00:00:00.000Z',
        analysis_error_categories_json: '["old_error"]',
        downstream_processing_json: '{"state":"processing"}',
      },
      {
        provider: 'ollama',
        model: 'qwen3.5:9b',
        generation_path: 'multi_pass',
        prompt_version: 'notes-v8',
        generated_at: '2026-08-26T00:00:00.000Z',
        error_categories: ['terminology_invalid_json'],
      },
    );

    expect(result).toEqual({
      analysis_provider: 'ollama',
      analysis_model: 'qwen3.5:9b',
      analysis_generation_path: 'multi_pass',
      analysis_prompt_version: 'notes-v8',
      analysis_generated_at: '2026-08-26T00:00:00.000Z',
      analysis_error_categories_json: '["terminology_invalid_json"]',
      downstream_processing_json: null,
    });
  });
});
