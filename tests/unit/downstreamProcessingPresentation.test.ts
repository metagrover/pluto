import { describe, expect, it } from 'vitest';
import { getDownstreamProcessingPresentation } from '../../src/components/features/downstreamProcessingPresentation';

describe('downstream processing presentation', () => {
  it('maps ordinary analysis work to a copy-free loading state', () => {
    expect(
      getDownstreamProcessingPresentation({
        transcript_status: 'validated',
        downstream_processing_json: JSON.stringify({
          schemaVersion: 1,
          state: 'processing',
          stage: 'analysis',
        }),
      }),
    ).toEqual({ state: 'loading' });

    expect(
      getDownstreamProcessingPresentation({
        transcript_status: 'provisional',
        transcript_json: JSON.stringify({
          lifecycleStatus: 'provisional',
          segments: [{ speaker: 'Me', text: 'Ready transcript text' }],
        }),
      }),
    ).toEqual({ state: 'loading' });
  });

  it('uses plain artifact language for a terminal analysis failure', () => {
    const presentation = getDownstreamProcessingPresentation({
      transcript_status: 'validated',
      downstream_processing_json: JSON.stringify({
        schemaVersion: 1,
        state: 'failed',
        stage: 'analysis',
        failure: 'stage_timeout',
      }),
    });

    expect(presentation).toEqual({
      state: 'failed',
      title: "Couldn't finish the analysis",
      detail:
        'Your transcript is available. Pluto will try again automatically.',
    });
    expect(JSON.stringify(presentation)).not.toMatch(
      /validat|needs attention|recovery|retry meeting/i,
    );
  });

  it('keeps showing a skeleton when completion has no analysis artifact', () => {
    expect(
      getDownstreamProcessingPresentation({
        transcript_status: 'validated',
        downstream_processing_json: JSON.stringify({
          schemaVersion: 1,
          state: 'complete',
        }),
      })?.state,
    ).toBe('loading');
  });

  it('returns ready as soon as analysis exists even if later work continues', () => {
    expect(
      getDownstreamProcessingPresentation({
        transcript_status: 'validated',
        analysis_json: '{"analysis_schema_version":3}',
        downstream_processing_json: JSON.stringify({
          schemaVersion: 1,
          state: 'processing',
          stage: 'knowledge_synthesis',
        }),
      })?.state,
    ).toBe('ready');
  });
});
