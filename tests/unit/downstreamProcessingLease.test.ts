import { describe, expect, it } from 'vitest';
import {
  buildDownstreamProcessingLease,
  readDownstreamProcessingLease,
  selectDownstreamResumeStage,
} from '../../src/services/downstreamProcessingLease';

describe('downstream processing lease', () => {
  it('round-trips a durable processing owner and deadline', () => {
    const lease = buildDownstreamProcessingLease({
      runId: 'run-1',
      transcriptValidatedAt: '2026-08-04T00:00:00.000Z',
      now: 1_000,
      stage: 'analysis',
    });

    expect(readDownstreamProcessingLease(JSON.stringify(lease))).toEqual(lease);
    expect(Date.parse(lease.deadlineAt)).toBeGreaterThan(1_000);
  });

  it('resumes from durable analysis and MID evidence', () => {
    expect(selectDownstreamResumeStage({})).toBe('analysis');
    expect(selectDownstreamResumeStage({ analysis_json: '{}' })).toBe(
      'knowledge_extraction',
    );
    expect(
      selectDownstreamResumeStage({ analysis_json: '{}', mid_json: '{}' }),
    ).toBe('knowledge_synthesis');
  });

  it('rejects incomplete processing records as leases', () => {
    expect(
      readDownstreamProcessingLease(
        JSON.stringify({ state: 'processing', runId: 'legacy' }),
      ),
    ).toBeNull();
  });
});
