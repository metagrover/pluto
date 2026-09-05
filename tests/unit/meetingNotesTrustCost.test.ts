import { describe, expect, it } from 'vitest';

import {
  type MeetingNotesTrustCostCase,
  assertMeetingNotesTrustCostReportSafe,
  buildMeetingNotesTrustCostReport,
} from '../../scripts/lib/meeting_notes_trust_cost';

const checkpoint = (
  overrides: Partial<{
    exactEvidenceSupported: number;
    falsePositiveCount: number;
    falseNegativeCount: number;
    reviewedSemanticChecksPassed: number;
    reviewedSemanticChecksTotal: number;
    decisionCount: number;
    actionCount: number;
  }> = {},
) => ({
  exactEvidenceSupported: 3,
  falsePositiveCount: 0,
  falseNegativeCount: 0,
  reviewedSemanticChecksPassed: 8,
  reviewedSemanticChecksTotal: 8,
  decisionCount: 1,
  actionCount: 1,
  ...overrides,
});

const writerFailure = (): MeetingNotesTrustCostCase => ({
  fixtureId: 'compact-editor-baseline',
  caseId: 'writer-failure',
  model: 'gemma4:12b',
  promptVersion: null,
  terminalStatus: 'failed',
  errorCode: 'notes_writer_invalid',
  publicationBlocked: true,
  timingEvidence: {
    stopToSealedCapture: null,
    sealedToCanonicalTranscript: null,
    postPublicationCompute: null,
  },
  checkpoints: {
    writer: null,
    deterministicBoundary: null,
    audited: null,
  },
  attempts: [
    {
      task: 'notesWriter',
      recovery: 'initial',
      outcome: 'complete',
      inputTokens: 100,
      outputTokens: 20,
      modelMs: 30,
      responseDigest: 'digest-a',
      repeatsSource: false,
    },
    {
      task: 'notesWriter',
      recovery: 'malformed_contract_repair',
      outcome: 'complete',
      inputTokens: 120,
      outputTokens: 20,
      modelMs: 40,
      responseDigest: 'digest-a',
      repeatsSource: true,
    },
  ],
});

describe('meeting notes trust-cost evaluator', () => {
  it('accounts for a duplicate failed repair without exposing its response digest', () => {
    const report = buildMeetingNotesTrustCostReport([writerFailure()]);

    expect(report.cases[0]).toMatchObject({
      conclusion: 'writer_unusable',
      publicationBlocked: true,
      checkpoints: {
        writer: null,
        deterministicBoundary: null,
        audited: null,
      },
      timing_boundaries: {
        stop_to_sealed_capture: null,
        sealed_to_canonical_transcript: null,
        canonical_to_trusted_notes: {
          modelCallCount: 2,
          modelMs: 70,
          inputTokens: 220,
          outputTokens: 40,
          repeatedSourceModelCallCount: 1,
        },
        post_publication_compute: null,
      },
      recovery: {
        malformedContractRepairCount: 1,
        transientLeafRetryCount: 0,
        compactTruncationRetryCount: 0,
        repartitionCount: 0,
        contextOverflowReplanCount: 0,
        duplicateRecoveryCount: 1,
        duplicateRecoveryModelMs: 40,
      },
    });
    expect(JSON.stringify(report)).not.toContain('digest-a');
    expect(report.cases[0]?.attempts[0]).not.toHaveProperty(
      'blocksPublication',
    );
  });

  it('classifies unique audit value only when reviewed quality improves', () => {
    const deterministic = checkpoint({
      falsePositiveCount: 1,
      reviewedSemanticChecksPassed: 7,
    });
    const audited = checkpoint();
    const base = writerFailure();
    const report = buildMeetingNotesTrustCostReport([
      {
        ...base,
        caseId: 'audit-improves',
        terminalStatus: 'published',
        errorCode: null,
        publicationBlocked: false,
        checkpoints: {
          writer: deterministic,
          deterministicBoundary: deterministic,
          audited,
        },
      },
      {
        ...base,
        caseId: 'audit-neutral',
        terminalStatus: 'published',
        errorCode: null,
        publicationBlocked: false,
        checkpoints: {
          writer: audited,
          deterministicBoundary: audited,
          audited,
        },
      },
    ]);

    expect(report.cases.map((item) => item.conclusion)).toEqual([
      'audit_added_unique_value',
      'deterministic_checks_sufficient_for_fixture',
    ]);
  });

  it('reports insufficient evidence instead of inferring semantic quality', () => {
    const base = writerFailure();
    const report = buildMeetingNotesTrustCostReport([
      {
        ...base,
        errorCode: 'notes_audit_invalid',
        attempts: [base.attempts[0]],
      },
    ]);

    expect(report.cases[0]?.conclusion).toBe('insufficient_fixture_evidence');
  });

  it('keeps canonical finalization stages separate with queue and resume state', () => {
    const input = writerFailure();
    input.timingEvidence.sealedToCanonicalTranscript = {
      totalMs: 35,
      queueMs: 5,
      activeMs: 30,
      attemptCount: 2,
      resumeState: 'resumed',
      stages: [
        {
          stage: 'materialize_mic',
          queueMs: 5,
          activeMs: 30,
          attempt: 2,
          resumeState: 'resumed',
        },
      ],
    };

    const report = buildMeetingNotesTrustCostReport([input]);

    expect(
      report.cases[0]?.timing_boundaries.sealed_to_canonical_transcript,
    ).toEqual(input.timingEvidence.sealedToCanonicalTranscript);
    expect(report.totals.sealed_to_canonical_transcript).toMatchObject({
      observedCaseCount: 1,
      totalMs: 35,
      queueMs: 5,
      activeMs: 30,
      attemptCount: 2,
    });
  });

  it('rejects text-bearing fields and private sentinel values recursively', () => {
    expect(() =>
      assertMeetingNotesTrustCostReportSafe({
        cases: [{ raw: 'hidden response' }],
      }),
    ).toThrow('unsafe_meeting_notes_latency_report');
    expect(() =>
      assertMeetingNotesTrustCostReportSafe(
        { cases: [{ caseId: 'PRIVATE_SENTINEL' }] },
        ['PRIVATE_SENTINEL'],
      ),
    ).toThrow('unsafe_meeting_notes_latency_report');
  });

  it('rejects path-like identifiers and malformed timing input consistently', () => {
    expect(() =>
      buildMeetingNotesTrustCostReport([
        { ...writerFailure(), fixtureId: 'private/path' },
      ]),
    ).toThrow('invalid_meeting_notes_trust_cost_case');
    expect(() =>
      buildMeetingNotesTrustCostReport([
        {
          ...writerFailure(),
          timingEvidence: undefined,
        } as unknown as MeetingNotesTrustCostCase,
      ]),
    ).toThrow('invalid_meeting_notes_trust_cost_case');
  });
});
