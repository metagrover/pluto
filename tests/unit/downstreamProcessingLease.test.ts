import { describe, expect, it } from 'vitest';
import {
  buildDownstreamProcessingLease,
  buildPartialCaptureGapProcessingLease,
  completeDownstreamProcessing,
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

  it('binds partial intelligence to the exact transcript and integrity evidence', async () => {
    const lease = await buildPartialCaptureGapProcessingLease({
      runId: 'partial-run-1',
      transcriptJson: '{"segments":[]}',
      transcriptIntegrityJson: '{"causes":[{"code":"capture_gap_detected"}]}',
      captureJournalGeneration: 'journal-1',
      now: 1_000,
      stage: 'analysis',
    });

    expect(readDownstreamProcessingLease(JSON.stringify(lease))).toEqual(lease);
    expect(lease).toMatchObject({
      schemaVersion: 2,
      source: {
        kind: 'partial_capture_gap',
        captureJournalGeneration: 'journal-1',
      },
    });
    expect(completeDownstreamProcessing(lease)).toEqual({
      schemaVersion: 2,
      state: 'complete',
      source: lease.source,
    });
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
