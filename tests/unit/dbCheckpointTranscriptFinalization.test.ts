import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-checkpoint-finalization-db-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => testDatabase.directory,
  },
}));

import {
  claimMeetingDownstreamProcessing,
  claimMeetingTranscriptValidationRetry,
  finalizeCheckpointTranscript,
  getMeeting,
  getMeetingMid,
  saveMeeting,
  saveMeetingMid,
  saveMeetingIfDownstreamRunCurrent,
} from '../../electron/db';
import { buildDownstreamProcessingLease } from '../../src/services/downstreamProcessingLease';
import { parseMeetingDownstreamProcessing } from '../../src/utils/transcriptTrustState';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

const validatedAt = '2026-07-31T08:00:00.000Z';
const journalGeneration = 'journal-generation-1';
const validationRunId = 'validation-run-1';
const downstreamRunId = 'downstream-run-1';
const canonicalTranscriptJson = JSON.stringify({
  schemaVersion: 2,
  lifecycleStatus: 'validated',
  segments: [{ speaker: 'Me', text: 'Checkpoint transcript' }],
});
const transcriptIntegrityJson = JSON.stringify({
  recovery: {
    source: 'capture_journal',
    journalGeneration,
    gapDetected: false,
  },
  validationProof: {
    gateVersion: 'canonical_integrity_v1',
    validatedAt,
  },
});

const seedValidatingMeeting = (id: string) => {
  saveMeeting({
    id,
    title: 'Recovered recording',
    transcript_status: 'needs_attention',
    transcript_json: JSON.stringify({
      schemaVersion: 2,
      lifecycleStatus: 'needs_attention',
      segments: [],
    }),
    transcript_integrity_json: JSON.stringify({
      causes: [{ code: 'recovered_awaiting_validation' }],
      recovery: {
        source: 'capture_journal',
        journalGeneration,
        gapDetected: false,
      },
    }),
    transcript_validated_at: null,
    finalization_status: 'recovery_required',
    capture_journal_generation: journalGeneration,
  });
  expect(
    claimMeetingTranscriptValidationRetry(id, {
      runId: validationRunId,
      startedAt: '2026-07-31T07:59:00.000Z',
      deadlineAt: '2099-07-31T08:10:00.000Z',
      stage: 'saving',
    }),
  ).toBe(true);
  expect(getMeeting(id)).toMatchObject({
    transcript_status: 'validating',
    capture_journal_generation: journalGeneration,
  });
};

it('allows only one durable downstream owner and fences stale saves', () => {
  const id = 'downstream-single-flight';
  saveMeeting({
    id,
    title: 'Meeting',
    transcript_status: 'validated',
    transcript_validated_at: validatedAt,
    transcript_json: canonicalTranscriptJson,
    transcript_integrity_json: transcriptIntegrityJson,
  });
  const first = buildDownstreamProcessingLease({
    runId: 'downstream-first',
    transcriptValidatedAt: validatedAt,
    now: Date.parse('2026-08-04T00:00:00.000Z'),
    stage: 'analysis',
  });
  const second = buildDownstreamProcessingLease({
    runId: 'downstream-second',
    transcriptValidatedAt: validatedAt,
    now: Date.parse('2026-08-04T00:00:01.000Z'),
    stage: 'analysis',
  });

  expect(claimMeetingDownstreamProcessing(id, first)).toBe(true);
  expect(claimMeetingDownstreamProcessing(id, second)).toBe(false);
  const claimed = getMeeting(id) as Parameters<
    typeof saveMeetingIfDownstreamRunCurrent
  >[0];
  expect(
    saveMeetingIfDownstreamRunCurrent(
      {
        ...claimed,
        downstream_processing_json: JSON.stringify({
          schemaVersion: 1,
          state: 'complete',
          transcriptValidatedAt: validatedAt,
        }),
      },
      second.runId,
    ),
  ).toBe(false);
  expect(
    saveMeetingIfDownstreamRunCurrent(
      {
        ...claimed,
        downstream_processing_json: JSON.stringify({
          schemaVersion: 1,
          state: 'complete',
          transcriptValidatedAt: validatedAt,
        }),
      },
      first.runId,
    ),
  ).toBe(true);
});

it('preserves the MID across later whole-meeting saves', () => {
  const id = 'mid-survives-save';
  saveMeeting({ id, title: 'Meeting' });
  saveMeetingMid(id, {
    mid_version: 1,
    meeting_id: id,
    title: 'Meeting intelligence',
    occurred_at: null,
    duration_seconds: 0,
    participants: [],
    projects: [],
    topics: [],
    action_items: [],
    decisions: [],
    signals: {
      continuity: [],
      accountability_risks: [],
      decision_impacts: [],
    },
    evidence_spans: [],
  });

  saveMeeting(getMeeting(id) as Parameters<typeof saveMeeting>[0]);

  expect(getMeetingMid(id)).toMatchObject({ meeting_id: id });
});

const input = (meetingId: string) => ({
  meetingId,
  journalGeneration,
  expectedTranscriptStatus: 'validating' as const,
  expectedValidationRunId: validationRunId,
  canonicalTranscriptJson,
  transcriptIntegrityJson,
  transcriptValidatedAt: validatedAt,
  downstreamRunId,
});

describe('checkpoint transcript database finalization', () => {
  it('atomically commits the checkpoint transcript and claims downstream work', () => {
    seedValidatingMeeting('checkpoint-commit');

    expect(finalizeCheckpointTranscript(input('checkpoint-commit'))).toBe(
      'committed_and_claimed',
    );

    const saved = getMeeting('checkpoint-commit') as Record<string, unknown>;
    expect(saved).toMatchObject({
      transcript_status: 'validated',
      transcript_json: canonicalTranscriptJson,
      transcript_integrity_json: transcriptIntegrityJson,
      transcript_validated_at: validatedAt,
      finalization_status: 'finalized',
      finalization_error_category: null,
    });
    expect(JSON.parse(String(saved.downstream_processing_json))).toMatchObject({
      schemaVersion: 1,
      state: 'processing',
      transcriptValidatedAt: validatedAt,
      runId: downstreamRunId,
      stage: 'analysis',
      startedAt: expect.any(String),
      deadlineAt: expect.any(String),
    });
    expect(
      parseMeetingDownstreamProcessing(
        String(saved.downstream_processing_json),
        validatedAt,
      ),
    ).toMatchObject({ ok: true });
  });

  it('returns already_committed only for the identical proof and downstream run', () => {
    seedValidatingMeeting('checkpoint-replay');
    expect(finalizeCheckpointTranscript(input('checkpoint-replay'))).toBe(
      'committed_and_claimed',
    );
    expect(finalizeCheckpointTranscript(input('checkpoint-replay'))).toBe(
      'already_committed',
    );
    expect(
      finalizeCheckpointTranscript({
        ...input('checkpoint-replay'),
        downstreamRunId: 'different-downstream-run',
      }),
    ).toBe('superseded');
  });

  it.each([
    ['journal generation', { journalGeneration: 'stale-generation' }],
    ['transcript status', { expectedTranscriptStatus: 'provisional' as const }],
    ['validation run', { expectedValidationRunId: 'stale-validation-run' }],
  ])('rejects a stale %s without mutating the meeting', (_label, override) => {
    const id = `checkpoint-stale-${_label.replaceAll(' ', '-')}`;
    seedValidatingMeeting(id);
    const before = getMeeting(id);

    expect(
      finalizeCheckpointTranscript({
        ...input(id),
        ...override,
      }),
    ).toBe('superseded');
    expect(getMeeting(id)).toEqual(before);
  });

  it('rejects a stale lease after a newer retry takes ownership', () => {
    seedValidatingMeeting('checkpoint-newer-lease');
    const claimed = getMeeting('checkpoint-newer-lease') as Record<
      string,
      unknown
    >;
    saveMeeting({
      ...claimed,
      id: 'checkpoint-newer-lease',
      title: String(claimed.title),
      transcript_integrity_json: JSON.stringify({
        causes: [],
        retry: {
          runId: 'newer-validation-run',
          startedAt: '2026-07-31T08:01:00.000Z',
          deadlineAt: '2026-07-31T08:11:00.000Z',
          stage: 'transcribing',
        },
      }),
    });
    const before = getMeeting('checkpoint-newer-lease');

    expect(finalizeCheckpointTranscript(input('checkpoint-newer-lease'))).toBe(
      'superseded',
    );
    expect(getMeeting('checkpoint-newer-lease')).toEqual(before);
  });
});
