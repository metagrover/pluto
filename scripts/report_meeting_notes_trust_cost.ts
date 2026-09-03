#!/usr/bin/env tsx

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseNotesDraft } from '../electron/llm/meetingNotesAudit';
import { findNotesGuardrailIssues } from '../electron/llm/meetingNotesGuardrails';
import { createNotesSource } from '../electron/llm/meetingNotesSource';
import { createNotesWireRequest } from '../electron/llm/meetingNotesWire';
import { normalizeCapturedNotesDraft } from './lib/meeting_notes_recovery_replay';
import {
  type MeetingNotesTrustCostCase,
  assertMeetingNotesTrustCostReportSafe,
  buildMeetingNotesTrustCostReport,
} from './lib/meeting_notes_trust_cost';

const fixtures = [
  {
    fixtureId: 'compact-editor-baseline',
    relativePath:
      'tests/manual/fixtures/meetingNotesCompactEditorBaseline.json',
  },
  {
    fixtureId: 'compact-editor-candidate',
    relativePath:
      'tests/manual/fixtures/meetingNotesCompactEditorCandidate.json',
  },
] as const;

type CapturedDuplicateRepair = {
  fixtureId: string;
  caseId: string;
  task: 'notesWriter' | 'notesAudit' | 'notesMerge';
  initialRaw: string;
  repairModelMs: number;
};

type LoadedFixture = {
  costCases: MeetingNotesTrustCostCase[];
  duplicateRepairs: CapturedDuplicateRepair[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const requiredString = (
  value: unknown,
  code = 'invalid_meeting_notes_trust_cost_fixture',
): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value;
};

const requiredCount = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('invalid_meeting_notes_trust_cost_fixture');
  }
  return value;
};

const stableErrorCode = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (value.includes('notes_writer_invalid')) return 'notes_writer_invalid';
  if (value.includes('notes_audit_invalid')) return 'notes_audit_invalid';
  if (value.includes('narrative coverage scorer')) {
    return 'independent_quality_rejection';
  }
  return 'meeting_notes_fixture_failure';
};

const loadFixture = (
  root: string,
  fixture: (typeof fixtures)[number],
): LoadedFixture => {
  const parsed = JSON.parse(
    readFileSync(path.join(root, fixture.relativePath), 'utf8'),
  ) as unknown;
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.cases) ||
    parsed.cases.length === 0
  ) {
    throw new Error('invalid_meeting_notes_trust_cost_fixture');
  }
  const model = requiredString(parsed.model);
  const duplicateRepairs: CapturedDuplicateRepair[] = [];
  const costCases = parsed.cases.map((candidate): MeetingNotesTrustCostCase => {
    if (
      !isRecord(candidate) ||
      typeof candidate.gatePass !== 'boolean' ||
      !Array.isArray(candidate.requests) ||
      candidate.requests.length === 0
    ) {
      throw new Error('invalid_meeting_notes_trust_cost_fixture');
    }
    const capturedRequests = candidate.requests.map((request) => {
      if (
        !isRecord(request) ||
        !isRecord(request.metrics) ||
        (request.task !== 'notesWriter' &&
          request.task !== 'notesAudit' &&
          request.task !== 'notesMerge') ||
        typeof request.repair !== 'boolean'
      ) {
        throw new Error('invalid_meeting_notes_trust_cost_fixture');
      }
      return {
        task: request.task,
        repair: request.repair,
        raw: requiredString(request.raw),
        digest: requiredString(request.sha256),
        inputTokens: requiredCount(request.metrics.inputTokens),
        outputTokens: requiredCount(request.metrics.outputTokens),
        modelMs: requiredCount(request.metrics.elapsedMs),
      };
    });
    const caseId = requiredString(candidate.case);
    for (const [index, request] of capturedRequests.entries()) {
      if (!request.repair) continue;
      const original = capturedRequests
        .slice(0, index)
        .reverse()
        .find((entry) => entry.task === request.task && !entry.repair);
      if (!original || original.digest !== request.digest) continue;
      duplicateRepairs.push({
        fixtureId: fixture.fixtureId,
        caseId,
        task: request.task,
        initialRaw: original.raw,
        repairModelMs: request.modelMs,
      });
    }
    const attempts = capturedRequests.map((request, index) => {
      return {
        task: request.task,
        recovery: request.repair
          ? ('malformed_contract_repair' as const)
          : ('initial' as const),
        outcome: 'complete' as const,
        inputTokens: request.inputTokens,
        outputTokens: request.outputTokens,
        modelMs: request.modelMs,
        responseDigest: request.digest,
        repeatsSource: index > 0,
      };
    });
    const errorCode = stableErrorCode(candidate.error);
    return {
      fixtureId: fixture.fixtureId,
      caseId,
      model,
      promptVersion: null,
      terminalStatus: candidate.gatePass ? 'published' : 'failed',
      errorCode,
      publicationBlocked: !candidate.gatePass,
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
      attempts,
    };
  });
  return { costCases, duplicateRepairs };
};

const loadSyntheticSources = (root: string) => {
  const parsed = JSON.parse(
    readFileSync(
      path.join(
        root,
        'scripts/baselines/meeting-notes-trust-cost/synthetic-sources.json',
      ),
      'utf8',
    ),
  ) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('invalid_meeting_notes_trust_cost_sources');
  }
  return parsed;
};

const buildDeterministicRecoveryReplay = (
  root: string,
  repairs: CapturedDuplicateRepair[],
) => {
  const sources = loadSyntheticSources(root);
  let writerCandidateCount = 0;
  let auditRepairRefusalCount = 0;
  let strictParseRecoveredCount = 0;
  let guardrailPassedCount = 0;
  let capturedAvoidableModelMs = 0;
  let unsupportedDuplicateRepairMs = 0;
  let flattenedTextFields = 0;
  let discussionKindsMapped = 0;
  const cases = repairs.map((repair) => {
    if (repair.task !== 'notesWriter') {
      auditRepairRefusalCount += 1;
      unsupportedDuplicateRepairMs += repair.repairModelMs;
      return {
        fixtureId: repair.fixtureId,
        caseId: repair.caseId,
        task: repair.task,
        status: 'not_normalizable' as const,
        reason: 'audit_response' as const,
        capturedRepairModelMs: repair.repairModelMs,
      };
    }
    writerCandidateCount += 1;
    const segments = sources[repair.caseId];
    if (!Array.isArray(segments)) {
      throw new Error('invalid_meeting_notes_trust_cost_sources');
    }
    const source = createNotesSource(JSON.stringify({ segments }));
    const spans = source.segments.map((segment) => ({
      segment: segment.index,
      start: 0,
      end: segment.text.length,
    }));
    const decoded = createNotesWireRequest('', spans).decode(repair.initialRaw);
    const normalized = normalizeCapturedNotesDraft(decoded);
    if (normalized.status !== 'normalized') {
      unsupportedDuplicateRepairMs += repair.repairModelMs;
      return {
        fixtureId: repair.fixtureId,
        caseId: repair.caseId,
        task: repair.task,
        status: normalized.status,
        reason: normalized.reason,
        capturedRepairModelMs: repair.repairModelMs,
      };
    }
    flattenedTextFields += normalized.transformations.flattenedTextFields;
    discussionKindsMapped += normalized.transformations.discussionKindsMapped;
    try {
      const draft = parseNotesDraft(normalized.normalizedJson);
      strictParseRecoveredCount += 1;
      const issueCodes = [
        ...new Set(
          findNotesGuardrailIssues(source, draft, spans).map(
            (issue) => issue.code,
          ),
        ),
      ].sort();
      if (issueCodes.length === 0) {
        guardrailPassedCount += 1;
        capturedAvoidableModelMs += repair.repairModelMs;
      } else {
        unsupportedDuplicateRepairMs += repair.repairModelMs;
      }
      return {
        fixtureId: repair.fixtureId,
        caseId: repair.caseId,
        task: repair.task,
        status:
          issueCodes.length === 0
            ? ('guardrail_passed' as const)
            : ('guardrail_rejected' as const),
        capturedRepairModelMs: repair.repairModelMs,
        transformations: normalized.transformations,
        guardrailIssueCodes: issueCodes,
      };
    } catch {
      unsupportedDuplicateRepairMs += repair.repairModelMs;
      return {
        fixtureId: repair.fixtureId,
        caseId: repair.caseId,
        task: repair.task,
        status: 'strict_parse_failed' as const,
        capturedRepairModelMs: repair.repairModelMs,
        transformations: normalized.transformations,
      };
    }
  });
  return {
    duplicateRepairCount: repairs.length,
    writerCandidateCount,
    auditRepairRefusalCount,
    strictParseRecoveredCount,
    guardrailPassedCount,
    capturedAvoidableModelMs,
    unsupportedDuplicateRepairMs,
    transformations: { flattenedTextFields, discussionKindsMapped },
    cases,
  };
};

export const buildCommittedMeetingNotesTrustCostReport = (root: string) => {
  const loaded = fixtures.map((fixture) => loadFixture(root, fixture));
  const report = {
    ...buildMeetingNotesTrustCostReport(
      loaded.flatMap((fixture) => fixture.costCases),
    ),
    deterministic_recovery_replay: buildDeterministicRecoveryReplay(
      root,
      loaded.flatMap((fixture) => fixture.duplicateRepairs),
    ),
  };
  assertMeetingNotesTrustCostReportSafe(report);
  return report;
};

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryPath === import.meta.url) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );
  process.stdout.write(
    `${JSON.stringify(buildCommittedMeetingNotesTrustCostReport(repositoryRoot), null, 2)}\n`,
  );
}
