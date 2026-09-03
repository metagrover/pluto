import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { assertMeetingNotesTrustCostReportSafe } from '../../scripts/lib/meeting_notes_trust_cost';
import { buildCommittedMeetingNotesTrustCostReport } from '../../scripts/report_meeting_notes_trust_cost';

describe('committed meeting notes trust-cost report', () => {
  it('reports captured recovery cost without retaining source or response text', () => {
    const report = buildCommittedMeetingNotesTrustCostReport(path.resolve('.'));

    expect(report.totals).toMatchObject({
      caseCount: 6,
      writerUnusableCount: 4,
      insufficientFixtureEvidenceCount: 2,
      stop_to_sealed_capture: null,
      sealed_to_canonical_transcript: null,
      canonical_to_trusted_notes: {
        modelCallCount: 13,
        modelMs: 506_363,
        duplicateRecoveryModelMs: 209_622,
      },
      post_publication_compute: null,
    });
    expect(report.cases).toHaveLength(6);
    expect(report.deterministic_recovery_replay).toMatchObject({
      duplicateRepairCount: 5,
      writerCandidateCount: 4,
      auditRepairRefusalCount: 1,
      strictParseRecoveredCount: 4,
      guardrailPassedCount: 4,
      capturedAvoidableModelMs: 177_875,
      unsupportedDuplicateRepairMs: 31_747,
      transformations: {
        flattenedTextFields: 9,
        discussionKindsMapped: 8,
      },
    });
    expect(
      report.cases.reduce(
        (total, item) => total + item.recovery.duplicateRecoveryCount,
        0,
      ),
    ).toBe(5);
    expect(
      report.cases.every(
        (item) =>
          item.timing_boundaries.stop_to_sealed_capture === null &&
          item.timing_boundaries.sealed_to_canonical_transcript === null &&
          item.timing_boundaries.post_publication_compute === null,
      ),
    ).toBe(true);
    expect(() => assertMeetingNotesTrustCostReportSafe(report)).not.toThrow();

    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(
      /"(?:raw|finalDocument|transcript|speaker|sourceText)"/i,
    );
    expect(serialized).not.toContain('Writer and editor');
    expect(serialized).not.toContain('Ava');
  });

  it('is deterministic across repeated builds', () => {
    const root = path.resolve('.');
    expect(
      JSON.stringify(buildCommittedMeetingNotesTrustCostReport(root)),
    ).toBe(JSON.stringify(buildCommittedMeetingNotesTrustCostReport(root)));
  });
});
