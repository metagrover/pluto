#!/usr/bin/env tsx

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type MeetingNotesTrustCostCase,
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
): MeetingNotesTrustCostCase[] => {
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
  return parsed.cases.map((candidate): MeetingNotesTrustCostCase => {
    if (
      !isRecord(candidate) ||
      typeof candidate.gatePass !== 'boolean' ||
      !Array.isArray(candidate.requests) ||
      candidate.requests.length === 0
    ) {
      throw new Error('invalid_meeting_notes_trust_cost_fixture');
    }
    const attempts = candidate.requests.map((request, index) => {
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
        recovery: request.repair
          ? ('malformed_contract_repair' as const)
          : ('initial' as const),
        outcome: 'complete' as const,
        inputTokens: requiredCount(request.metrics.inputTokens),
        outputTokens: requiredCount(request.metrics.outputTokens),
        modelMs: requiredCount(request.metrics.elapsedMs),
        responseDigest: requiredString(request.sha256),
        repeatsSource: index > 0,
      };
    });
    const errorCode = stableErrorCode(candidate.error);
    return {
      fixtureId: fixture.fixtureId,
      caseId: requiredString(candidate.case),
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
};

export const buildCommittedMeetingNotesTrustCostReport = (root: string) =>
  buildMeetingNotesTrustCostReport(
    fixtures.flatMap((fixture) => loadFixture(root, fixture)),
  );

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
