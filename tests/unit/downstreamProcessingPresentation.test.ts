import { describe, expect, it } from 'vitest';
import { getDownstreamProcessingPresentation } from '../../src/components/features/downstreamProcessingPresentation';

it('retains published notes and a durable failed-regeneration status after navigation', () => {
  expect(
    getDownstreamProcessingPresentation({
      analysis_json: '{}',
      analysis_run_json: JSON.stringify({ notes_status: 'failed' }),
    }),
  ).toEqual({ state: 'ready', notesUpdateFailed: true });
});

it('keeps notes visible while reporting independently retryable secondary failure', () => {
  expect(
    getDownstreamProcessingPresentation({
      analysis_json: '{}',
      analysis_run_json: JSON.stringify({
        notes_status: 'published',
        secondary_status: 'failed',
      }),
    }),
  ).toEqual({ state: 'ready', secondaryStatus: 'failed' });
});

it('reports an interrupted notes run rather than preparing forever', () => {
  expect(
    getDownstreamProcessingPresentation({
      analysis_run_json: JSON.stringify({
        notes_status: 'failed',
        error_code: 'notes_interrupted',
      }),
    }),
  ).toMatchObject({ state: 'failed' });
});

it('retains the stable capacity failure for truthful retry presentation', () => {
  expect(
    getDownstreamProcessingPresentation({
      analysis_run_json: JSON.stringify({
        notes_status: 'failed',
        error_code: 'notes_bounded_plan_exceeded',
      }),
    }),
  ).toEqual({
    state: 'failed',
    title: 'Notes need another pass',
    detail: 'Your transcript is ready. Try again to continue.',
    failureCode: 'notes_bounded_plan_exceeded',
  });
});

it('presents a valid persisted local queue position without claiming generation started', () => {
  expect(
    getDownstreamProcessingPresentation({
      analysis_run_json: JSON.stringify({
        notes_status: 'running',
        stage: 'queued',
        queue_position: 1,
      }),
    }),
  ).toEqual({
    state: 'queued',
    title: 'Notes are next',
    detail: 'Waiting for the current local notes run to finish.',
    position: 1,
  });
  expect(
    getDownstreamProcessingPresentation({
      analysis_run_json: JSON.stringify({
        notes_status: 'running',
        stage: 'queued',
        queue_position: 3,
      }),
    }),
  ).toMatchObject({
    state: 'queued',
    title: 'Position 3 in the local notes queue',
    position: 3,
  });
});

it('keeps existing notes ready while exposing their queued update position', () => {
  expect(
    getDownstreamProcessingPresentation({
      analysis_json: '{}',
      analysis_run_json: JSON.stringify({
        notes_status: 'running',
        stage: 'queued',
        queue_position: 2,
      }),
    }),
  ).toEqual({ state: 'ready', notesUpdateQueuePosition: 2 });
});

it.each([0, -1, 1.5, '2'])(
  'ignores malformed queue position %j',
  (position) => {
    expect(
      getDownstreamProcessingPresentation({
        analysis_run_json: JSON.stringify({
          notes_status: 'running',
          stage: 'queued',
          queue_position: position,
        }),
      }).state,
    ).toBe('loading');
  },
);

it('replaces queued copy with generating copy when admission clears position', () => {
  expect(
    getDownstreamProcessingPresentation({
      analysis_run_json: JSON.stringify({
        notes_status: 'running',
        stage: 'notesWriter',
        queue_position: null,
      }),
    }),
  ).toEqual({
    state: 'loading',
    title: 'Analyzing conversation',
    detail: 'Building grounded meeting notes.',
  });
});

describe('downstream processing presentation', () => {
  it('maps persisted stages to truthful loading copy', () => {
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
      state: 'loading',
      title: 'Analyzing conversation',
      detail: 'Building grounded meeting notes.',
    });

    expect(
      getDownstreamProcessingPresentation({
        transcript_status: 'provisional',
        transcript_json: JSON.stringify({
          lifecycleStatus: 'provisional',
          segments: [{ speaker: 'Me', text: 'Ready transcript text' }],
        }),
      }),
    ).toEqual({
      state: 'loading',
      title: 'Preparing notes',
      detail: 'The transcript is ready for analysis.',
    });
  });

  it('keeps the preparation state visible when legacy notes exist', () => {
    expect(
      getDownstreamProcessingPresentation({
        transcript_status: 'validated',
        enhanced_notes: 'An older notes snapshot',
        downstream_processing_json: JSON.stringify({
          schemaVersion: 1,
          state: 'processing',
          stage: 'analysis',
        }),
      }),
    ).toEqual({
      state: 'loading',
      title: 'Analyzing conversation',
      detail: 'Building grounded meeting notes.',
    });
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
      title: 'Analysis needs another pass',
      detail: 'Your transcript is ready.',
    });
    expect(JSON.stringify(presentation)).not.toMatch(
      /validat|needs attention|recovery|retry meeting/i,
    );
  });

  it('does not present a failed Parakeet finalization as pending analysis', () => {
    expect(
      getDownstreamProcessingPresentation({
        transcript_status: 'needs_attention',
        transcript_integrity_json: JSON.stringify({
          schemaVersion: 2,
          state: 'needs_attention',
          finalTranscription: {
            policy: 'parakeet_final_v1',
            state: 'needs_attention',
            failure: 'required_source_failed',
          },
        }),
      }),
    ).toEqual({
      state: 'failed',
      title: "Couldn't finish the transcript",
      detail: 'Your recording is safe. Try again to continue.',
    });
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

  it('surfaces a fallback analysis as retryable instead of ready', () => {
    expect(
      getDownstreamProcessingPresentation({
        transcript_status: 'validated',
        analysis_json: JSON.stringify({
          analysis_schema_version: 3,
          quality: { fallback_used: true },
        }),
      }),
    ).toEqual({
      state: 'failed',
      title: 'Analysis needs another pass',
      detail: 'Your transcript is ready.',
    });
  });
});
