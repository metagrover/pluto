import { describe, expect, it } from 'vitest';
import { getDownstreamProcessingPresentation } from '../../src/components/features/downstreamProcessingPresentation';

describe('downstream processing presentation', () => {
  it('shows analysis progress separately from transcript validation', () => {
    expect(
      getDownstreamProcessingPresentation({
        transcript_status: 'validated',
        downstream_processing_json: JSON.stringify({
          schemaVersion: 1,
          state: 'processing',
          stage: 'analysis',
        }),
      }),
    ).toEqual({
      state: 'processing',
      title: 'Building meeting analysis',
      detail:
        'Pluto is turning the validated transcript into grounded meeting intelligence.',
      canRetry: false,
    });
  });

  it('shows a truthful retryable failure', () => {
    expect(
      getDownstreamProcessingPresentation({
        transcript_status: 'validated',
        downstream_processing_json: JSON.stringify({
          schemaVersion: 1,
          state: 'failed',
          stage: 'analysis',
          failure: 'stage_timeout',
        }),
      }),
    ).toEqual({
      state: 'failed',
      title: 'Meeting analysis stopped safely',
      detail:
        'The validated transcript is safe. Pluto can retry the analysis without recording again.',
      canRetry: true,
    });
  });

  it('does not claim synthesis is ready without derived artifacts', () => {
    expect(
      getDownstreamProcessingPresentation({
        transcript_status: 'validated',
        downstream_processing_json: JSON.stringify({
          schemaVersion: 1,
          state: 'complete',
        }),
      })?.state,
    ).toBe('missing');
  });

  it('returns ready only when complete analysis exists', () => {
    expect(
      getDownstreamProcessingPresentation({
        transcript_status: 'validated',
        analysis_json: '{"analysis_schema_version":3}',
        downstream_processing_json: JSON.stringify({
          schemaVersion: 1,
          state: 'complete',
        }),
      })?.state,
    ).toBe('ready');
  });
});
