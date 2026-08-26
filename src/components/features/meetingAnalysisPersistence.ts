import type { AnalysisGenerationMetadata } from '../../types';

interface ExistingAnalysisPersistence {
  analysis_provider?: string | null;
  analysis_model?: string | null;
  analysis_generation_path?: string | null;
  analysis_prompt_version?: string | null;
  analysis_generated_at?: string | null;
  analysis_error_categories_json?: string | null;
  downstream_processing_json?: string | null;
}

export const buildRegeneratedAnalysisPersistence = (
  existing: ExistingAnalysisPersistence,
  metadata?: AnalysisGenerationMetadata,
): ExistingAnalysisPersistence => ({
  analysis_provider: metadata?.provider ?? existing.analysis_provider ?? null,
  analysis_model: metadata?.model ?? existing.analysis_model ?? null,
  analysis_generation_path:
    metadata?.generation_path ?? existing.analysis_generation_path ?? null,
  analysis_prompt_version:
    metadata?.prompt_version ?? existing.analysis_prompt_version ?? null,
  analysis_generated_at:
    metadata?.generated_at ?? existing.analysis_generated_at ?? null,
  analysis_error_categories_json: metadata
    ? JSON.stringify(metadata.error_categories)
    : (existing.analysis_error_categories_json ?? null),
  downstream_processing_json: null,
});
