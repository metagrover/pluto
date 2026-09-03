import { assertContentFreeMeetingNotesLatencyReport } from './meeting_notes_latency_benchmark';

export type TrustCostConclusion =
  | 'audit_added_unique_value'
  | 'deterministic_checks_sufficient_for_fixture'
  | 'writer_unusable'
  | 'insufficient_fixture_evidence';

export type TrustCostRecovery =
  | 'initial'
  | 'malformed_contract_repair'
  | 'transient_leaf_retry'
  | 'compact_truncation_retry'
  | 'repartition'
  | 'context_overflow_replan';

export type TrustCostCheckpoint = {
  exactEvidenceSupported: number;
  falsePositiveCount: number;
  falseNegativeCount: number;
  reviewedSemanticChecksPassed: number;
  reviewedSemanticChecksTotal: number;
  decisionCount: number;
  actionCount: number;
};

export type MeetingNotesTrustCostAttempt = {
  task: 'notesWriter' | 'notesAudit' | 'notesMerge';
  recovery: TrustCostRecovery;
  outcome: 'complete' | 'failed' | 'truncated' | 'preempted' | 'cancelled';
  inputTokens: number | null;
  outputTokens: number | null;
  modelMs: number;
  responseDigest: string | null;
  repeatsSource: boolean;
};

export type MeetingNotesTrustCostCase = {
  fixtureId: string;
  caseId: string;
  model: string;
  promptVersion: string | null;
  terminalStatus: 'published' | 'failed' | 'cancelled';
  errorCode: string | null;
  publicationBlocked: boolean;
  checkpoints: {
    writer: TrustCostCheckpoint | null;
    deterministicBoundary: TrustCostCheckpoint | null;
    audited: TrustCostCheckpoint | null;
  };
  attempts: MeetingNotesTrustCostAttempt[];
};

const tasks = new Set(['notesWriter', 'notesAudit', 'notesMerge']);
const recoveries = new Set<TrustCostRecovery>([
  'initial',
  'malformed_contract_repair',
  'transient_leaf_retry',
  'compact_truncation_retry',
  'repartition',
  'context_overflow_replan',
]);
const outcomes = new Set([
  'complete',
  'failed',
  'truncated',
  'preempted',
  'cancelled',
]);
const terminalStatuses = new Set(['published', 'failed', 'cancelled']);

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isNullableCount = (value: unknown): value is number | null =>
  value === null || isCount(value);

const isSafeIdentifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-z0-9][a-z0-9._:@/-]{0,127}$/i.test(value);

const assertCheckpoint = (value: TrustCostCheckpoint | null): void => {
  if (value === null) return;
  if (
    !isCount(value.exactEvidenceSupported) ||
    !isCount(value.falsePositiveCount) ||
    !isCount(value.falseNegativeCount) ||
    !isCount(value.reviewedSemanticChecksPassed) ||
    !isCount(value.reviewedSemanticChecksTotal) ||
    value.reviewedSemanticChecksPassed > value.reviewedSemanticChecksTotal ||
    !isCount(value.decisionCount) ||
    !isCount(value.actionCount)
  ) {
    throw new Error('invalid_meeting_notes_trust_cost_case');
  }
};

const assertCase = (value: MeetingNotesTrustCostCase): void => {
  if (
    !isSafeIdentifier(value.fixtureId) ||
    !isSafeIdentifier(value.caseId) ||
    !isSafeIdentifier(value.model) ||
    (value.promptVersion !== null && !isSafeIdentifier(value.promptVersion)) ||
    !terminalStatuses.has(value.terminalStatus) ||
    (value.errorCode !== null && !isSafeIdentifier(value.errorCode)) ||
    typeof value.publicationBlocked !== 'boolean' ||
    !Array.isArray(value.attempts) ||
    value.attempts.length === 0 ||
    value.attempts.length > 256
  ) {
    throw new Error('invalid_meeting_notes_trust_cost_case');
  }
  assertCheckpoint(value.checkpoints.writer);
  assertCheckpoint(value.checkpoints.deterministicBoundary);
  assertCheckpoint(value.checkpoints.audited);
  for (const attempt of value.attempts) {
    if (
      !tasks.has(attempt.task) ||
      !recoveries.has(attempt.recovery) ||
      !outcomes.has(attempt.outcome) ||
      !isNullableCount(attempt.inputTokens) ||
      !isNullableCount(attempt.outputTokens) ||
      !isCount(attempt.modelMs) ||
      (attempt.responseDigest !== null &&
        !isSafeIdentifier(attempt.responseDigest)) ||
      typeof attempt.repeatsSource !== 'boolean'
    ) {
      throw new Error('invalid_meeting_notes_trust_cost_case');
    }
  }
};

const comparableCheckpoint = (value: TrustCostCheckpoint) => [
  value.exactEvidenceSupported,
  value.falsePositiveCount,
  value.falseNegativeCount,
  value.reviewedSemanticChecksPassed,
  value.reviewedSemanticChecksTotal,
  value.decisionCount,
  value.actionCount,
];

const classifyConclusion = (
  input: MeetingNotesTrustCostCase,
): TrustCostConclusion => {
  const { writer, deterministicBoundary, audited } = input.checkpoints;
  if (!writer && input.errorCode === 'notes_writer_invalid') {
    return 'writer_unusable';
  }
  if (!writer || !deterministicBoundary || !audited) {
    return 'insufficient_fixture_evidence';
  }
  if (
    comparableCheckpoint(deterministicBoundary).every(
      (value, index) => value === comparableCheckpoint(audited)[index],
    )
  ) {
    return 'deterministic_checks_sufficient_for_fixture';
  }
  const auditImproved =
    audited.falsePositiveCount < deterministicBoundary.falsePositiveCount ||
    audited.falseNegativeCount < deterministicBoundary.falseNegativeCount ||
    audited.exactEvidenceSupported >
      deterministicBoundary.exactEvidenceSupported ||
    audited.reviewedSemanticChecksPassed >
      deterministicBoundary.reviewedSemanticChecksPassed;
  const auditRegressed =
    audited.falsePositiveCount > deterministicBoundary.falsePositiveCount ||
    audited.falseNegativeCount > deterministicBoundary.falseNegativeCount ||
    audited.exactEvidenceSupported <
      deterministicBoundary.exactEvidenceSupported ||
    audited.reviewedSemanticChecksPassed <
      deterministicBoundary.reviewedSemanticChecksPassed;
  return auditImproved && !auditRegressed
    ? 'audit_added_unique_value'
    : 'insufficient_fixture_evidence';
};

const sumNullable = (
  values: Array<number | null>,
): number | null =>
  values.every((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0);

const recoveryCount = (
  attempts: MeetingNotesTrustCostAttempt[],
  recovery: TrustCostRecovery,
) => attempts.filter((attempt) => attempt.recovery === recovery).length;

export const assertMeetingNotesTrustCostReportSafe = (
  value: unknown,
  privateSentinels: readonly string[] = [],
): void => assertContentFreeMeetingNotesLatencyReport(value, privateSentinels);

export const buildMeetingNotesTrustCostReport = (
  inputs: readonly MeetingNotesTrustCostCase[],
) => {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 128) {
    throw new Error('invalid_meeting_notes_trust_cost_case');
  }
  inputs.forEach(assertCase);
  const cases = inputs.map((input) => {
    const previousDigestsByTask = new Map<string, Set<string>>();
    let duplicateRecoveryCount = 0;
    let duplicateRecoveryModelMs = 0;
    const attempts = input.attempts.map((attempt) => {
      const previous = previousDigestsByTask.get(attempt.task) ?? new Set();
      const duplicateRecovery =
        attempt.recovery !== 'initial' &&
        attempt.responseDigest !== null &&
        previous.has(attempt.responseDigest);
      if (duplicateRecovery) {
        duplicateRecoveryCount += 1;
        duplicateRecoveryModelMs += attempt.modelMs;
      }
      if (attempt.responseDigest) previous.add(attempt.responseDigest);
      previousDigestsByTask.set(attempt.task, previous);
      return {
        zone: 'primary_notes' as const,
        task: attempt.task,
        recovery: attempt.recovery,
        outcome: attempt.outcome,
        modelCall: true as const,
        modelMs: attempt.modelMs,
        inputTokens: attempt.inputTokens,
        outputTokens: attempt.outputTokens,
        repeatsSource: attempt.repeatsSource,
        duplicateRecovery,
        blocksPublication: input.publicationBlocked,
      };
    });
    return {
      fixtureId: input.fixtureId,
      caseId: input.caseId,
      model: input.model,
      promptVersion: input.promptVersion,
      terminalStatus: input.terminalStatus,
      errorCode: input.errorCode,
      publicationBlocked: input.publicationBlocked,
      conclusion: classifyConclusion(input),
      checkpoints: input.checkpoints,
      stopToTrustedNotes: {
        modelCallCount: attempts.length,
        modelMs: attempts.reduce((total, item) => total + item.modelMs, 0),
        inputTokens: sumNullable(attempts.map((item) => item.inputTokens)),
        outputTokens: sumNullable(attempts.map((item) => item.outputTokens)),
        repeatedSourceModelCallCount: attempts.filter(
          (item) => item.repeatsSource,
        ).length,
      },
      postPublicationCompute: null,
      recovery: {
        malformedContractRepairCount: recoveryCount(
          input.attempts,
          'malformed_contract_repair',
        ),
        transientLeafRetryCount: recoveryCount(
          input.attempts,
          'transient_leaf_retry',
        ),
        compactTruncationRetryCount: recoveryCount(
          input.attempts,
          'compact_truncation_retry',
        ),
        repartitionCount: recoveryCount(input.attempts, 'repartition'),
        contextOverflowReplanCount: recoveryCount(
          input.attempts,
          'context_overflow_replan',
        ),
        duplicateRecoveryCount,
        duplicateRecoveryModelMs,
      },
      attempts,
    };
  });
  const report = {
    schemaVersion: 1 as const,
    cases,
    totals: {
      caseCount: cases.length,
      writerUnusableCount: cases.filter(
        (item) => item.conclusion === 'writer_unusable',
      ).length,
      insufficientFixtureEvidenceCount: cases.filter(
        (item) => item.conclusion === 'insufficient_fixture_evidence',
      ).length,
      stopToTrustedNotes: {
        modelCallCount: cases.reduce(
          (total, item) => total + item.stopToTrustedNotes.modelCallCount,
          0,
        ),
        modelMs: cases.reduce(
          (total, item) => total + item.stopToTrustedNotes.modelMs,
          0,
        ),
        inputTokens: sumNullable(
          cases.map((item) => item.stopToTrustedNotes.inputTokens),
        ),
        outputTokens: sumNullable(
          cases.map((item) => item.stopToTrustedNotes.outputTokens),
        ),
        repeatedSourceModelCallCount: cases.reduce(
          (total, item) =>
            total + item.stopToTrustedNotes.repeatedSourceModelCallCount,
          0,
        ),
        duplicateRecoveryModelMs: cases.reduce(
          (total, item) => total + item.recovery.duplicateRecoveryModelMs,
          0,
        ),
      },
      postPublicationCompute: null,
    },
  };
  assertMeetingNotesTrustCostReportSafe(report);
  return report;
};
