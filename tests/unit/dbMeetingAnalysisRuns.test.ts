import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-meeting-analysis-runs-${process.pid}-${Math.random().toString(16).slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import {
  beginMeetingAnalysisRun,
  claimMeetingDownstreamProcessing,
  deleteMeeting,
  getMeeting,
  getMeetingAnalysisPublicationRevisions,
  getMeetingAnalysisRun,
  isMeetingAnalysisAutomaticRetryExhausted,
  listMeetingAnalysisRunMetrics,
  publishMeetingNotesIfCurrent,
  recoverInterruptedMeetingAnalysisRuns,
  restoreMeetingNotesSnapshot,
  saveMeeting,
  saveMeetingAnalysisSecondaryFieldsIfCurrent,
  updateMeetingAnalysisQueuePosition,
  updateMeetingAnalysisQueueSnapshot,
  updateMeetingAnalysisRunStatus,
  updateMeetingAnalysisRunStatusIfCurrent,
  upsertMeetingAnalysisRunMetric,
} from '../../electron/db';
import type { AnalysisDocumentV3 } from '../../electron/llm/analysisTypes';
import { createMeetingNotesRunMetrics } from '../../electron/llm/meetingNotesRunMetrics';
import { createMeetingAnalysisRunCoordinator } from '../../electron/meetingAnalysisRuns';
import { retryMeetingTranscriptValidation } from '../../src/services/retryMeetingTranscriptValidation';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

const source = (text: string) =>
  JSON.stringify({ segments: [{ speaker: 7, text }] });

const analysis = (
  overview: string,
  sourceKey?: string,
  actionItems: Array<{ text: string; sourceKey: string }> = [],
): AnalysisDocumentV3 => ({
  analysis_schema_version: 3,
  overview,
  topics: [],
  all_action_items: actionItems.map((item) => ({ text: item.text })),
  all_decisions: [],
  meeting_type: 'general',
  quality: {
    format_pass: true,
    retry_count: 0,
    fallback_used: false,
    issues: [],
  },
  generation_metadata: {
    provider: 'ollama',
    model: 'configured-model',
    generation_path: 'single_pass',
    prompt_version: 'notes-v7',
    generated_at: '2026-08-26T00:00:00.000Z',
    error_categories: [],
    ...(sourceKey
      ? {
          pipeline_version: 'writer-audit-v1' as const,
          mode: 'direct' as const,
          audit_status: 'complete' as const,
          audit_change_count: 0,
          source_provenance: {
            schema_version: 1 as const,
            source_revision: sourceKey,
            blocks: {
              overview: {
                id: sourceKey,
                sources: [{ segment: 0, start: 0, end: 1 }],
              },
              ...Object.fromEntries(
                actionItems.map((item, index) => [
                  `all_action_items:${index}`,
                  {
                    id: item.sourceKey,
                    sources: [{ segment: 0, start: 1, end: 2 }],
                  },
                ]),
              ),
            },
          },
        }
      : {}),
  },
});

const fixture = (
  id: string,
  options?: {
    analysis?: AnalysisDocumentV3;
    edits?: Record<
      string,
      { original: string; edited: string; edited_at: string }
    >;
    conflicts?: Array<{
      path: string;
      original: string;
      edited: string;
      edited_at: string;
      previousSourceKey: string | null;
    }>;
  },
) => {
  saveMeeting({
    id,
    title: 'Original title',
    transcript_json: source('We agreed to publish the update.'),
    transcript_integrity_json: JSON.stringify({ trust: 'eligible' }),
    user_notes: 'Keep the launch date.',
    folder_id: 'folder-a',
    is_favorite: true,
    analysis_json: options?.analysis ? JSON.stringify(options.analysis) : null,
    analysis_schema_version: options?.analysis?.analysis_schema_version ?? null,
    user_edits_json: options?.edits ? JSON.stringify(options.edits) : null,
    analysis_edit_conflicts_json: options?.conflicts
      ? JSON.stringify(options.conflicts)
      : null,
  });
  const current = getMeeting(id);
  const revisions = getMeetingAnalysisPublicationRevisions(current);
  if (!revisions) throw new Error('fixture revisions unavailable');
  return revisions;
};

const start = (
  meetingId: string,
  runId: string,
  inputRevision: string,
  revisions: NonNullable<
    ReturnType<typeof getMeetingAnalysisPublicationRevisions>
  >,
  reason: 'automatic' | 'manual' = 'manual',
) =>
  beginMeetingAnalysisRun({
    meetingId,
    runId,
    inputRevision,
    reason,
    ...revisions,
  });

const publish = (
  meetingId: string,
  runId: string,
  inputRevision: string,
  revisions: NonNullable<
    ReturnType<typeof getMeetingAnalysisPublicationRevisions>
  >,
  nextAnalysis = analysis('Published only when current.'),
) =>
  publishMeetingNotesIfCurrent({
    meetingId,
    runId,
    inputRevision,
    ...revisions,
    analysis: nextAnalysis,
  });

describe('meeting analysis run publication', () => {
  it('counts automatic attempts for one input revision and resets for changed input', () => {
    const meetingId = 'automatic-attempt-count';
    const revisions = fixture(meetingId);

    start(meetingId, 'automatic-1', 'fingerprint-a', revisions, 'automatic');
    expect(getMeetingAnalysisRun(meetingId)?.automatic_attempt_count).toBe(1);

    start(meetingId, 'automatic-2', 'fingerprint-a', revisions, 'automatic');
    expect(getMeetingAnalysisRun(meetingId)?.automatic_attempt_count).toBe(2);

    start(meetingId, 'automatic-3', 'fingerprint-b', revisions, 'automatic');
    expect(getMeetingAnalysisRun(meetingId)?.automatic_attempt_count).toBe(1);
  });

  it('does not consume the automatic-attempt budget for manual runs', () => {
    const meetingId = 'manual-attempt-count';
    const revisions = fixture(meetingId);

    start(meetingId, 'automatic-1', 'fingerprint-a', revisions, 'automatic');
    start(meetingId, 'manual-1', 'fingerprint-a', revisions, 'manual');

    expect(getMeetingAnalysisRun(meetingId)?.automatic_attempt_count).toBe(1);
  });

  it('derives automatic exhaustion only while the failed source revisions remain current', () => {
    const meetingId = 'automatic-exhaustion';
    const revisions = fixture(meetingId);
    start(meetingId, 'automatic-1', 'fingerprint-a', revisions, 'automatic');
    start(meetingId, 'automatic-2', 'fingerprint-a', revisions, 'automatic');
    updateMeetingAnalysisRunStatus({
      meetingId,
      runId: 'automatic-2',
      notesStatus: 'failed',
      secondaryStatus: 'pending',
      stage: 'notes_writer',
      errorCode: 'notes_writer_failed',
    });

    expect(
      isMeetingAnalysisAutomaticRetryExhausted(getMeeting(meetingId)),
    ).toBe(true);

    saveMeeting({ ...getMeeting(meetingId), user_notes: 'Changed input.' });
    expect(
      isMeetingAnalysisAutomaticRetryExhausted(getMeeting(meetingId)),
    ).toBe(false);
  });

  it('does not promote the first topic to the meeting title when the overall title is missing', () => {
    const id = 'placeholder-title';
    const revisions = fixture(id);
    saveMeeting({ ...getMeeting(id), title: 'New Meeting' });
    start(id, 'title-run', 'fp', revisions);
    const next = analysis('Reviewed outline.');
    next.topics = [
      {
        title: 'Outline review',
        summary: 'Reviewed outline.',
        key_points: [],
        decisions: [],
        action_items: [],
        open_questions: [],
      },
    ];
    expect(publish(id, 'title-run', 'fp', revisions, next)).toBe(true);
    expect(getMeeting(id)?.title).toBe('New Meeting');
  });

  it('uses analysis.title directly when meeting title is generic', () => {
    const id = 'model-title';
    const revisions = fixture(id);
    saveMeeting({ ...getMeeting(id), title: 'New Meeting' });
    start(id, 'model-title-run', 'fp', revisions);
    const next = analysis('Reviewed outline.');
    next.title = 'Quarterly Strategy & Hiring';
    next.topics = [
      {
        title: 'Outline review',
        summary: 'Reviewed outline.',
        key_points: [],
        decisions: [],
        action_items: [],
        open_questions: [],
      },
    ];
    expect(publish(id, 'model-title-run', 'fp', revisions, next)).toBe(true);
    expect(getMeeting(id)?.title).toBe('Quarterly Strategy & Hiring');
  });
  it('snapshots the last published notes and edits, records repairs, and invalidates work on undo', () => {
    const id = 'atomic-undo';
    const prior = analysis('Old notes');
    const revisions = fixture(id, {
      analysis: prior,
      edits: {
        overview: {
          original: 'Old notes',
          edited: 'My notes',
          edited_at: 'now',
        },
      },
    });
    start(id, 'new', 'fingerprint', revisions);
    const next = analysis('New notes');
    next.quality.retry_count = 1;
    expect(publish(id, 'new', 'fingerprint', revisions, next)).toBe(true);
    expect(getMeeting(id)?.analysis_retry_count).toBe(1);
    expect(restoreMeetingNotesSnapshot(id)).toBe(true);
    expect(getMeeting(id)?.analysis_json).toBe(JSON.stringify(prior));
    expect(
      JSON.parse(getMeeting(id)?.user_edits_json || '{}').overview.edited,
    ).toBe('My notes');
    expect(getMeetingAnalysisRun(id)?.notes_status).toBe('cancelled');
  });

  it('marks interrupted runs retryable while preserving already published notes', () => {
    const running = fixture('interrupted-writer');
    start('interrupted-writer', 'writer', 'fp', running);
    const published = fixture('interrupted-secondary');
    start('interrupted-secondary', 'secondary', 'fp', published);
    publish('interrupted-secondary', 'secondary', 'fp', published);
    const saved = getMeeting('interrupted-secondary')?.analysis_json;
    recoverInterruptedMeetingAnalysisRuns();
    expect(getMeetingAnalysisRun('interrupted-writer')).toMatchObject({
      notes_status: 'failed',
      error_code: 'notes_interrupted',
    });
    expect(getMeetingAnalysisRun('interrupted-secondary')).toMatchObject({
      notes_status: 'published',
      secondary_status: 'failed',
      error_code: 'secondary_interrupted',
    });
    expect(getMeeting('interrupted-secondary')?.analysis_json).toBe(saved);
  });
  it('restores only the saved notes snapshot and preserves latest unrelated fields', () => {
    const meetingId = 'restore-notes-snapshot';
    const restoredAnalysis = analysis('Restored overview.');
    const snapshot = {
      schema_version: 1,
      analysis_json: JSON.stringify(restoredAnalysis),
      user_edits_json: JSON.stringify({
        overview: {
          original: 'Restored overview.',
          edited: 'Saved edit.',
          edited_at: '2026-08-27T00:00:00.000Z',
        },
      }),
      analysis_edit_conflicts_json: '[]',
      generation_metadata: restoredAnalysis.generation_metadata,
    };
    saveMeeting({
      id: meetingId,
      title: 'Latest title',
      user_notes: 'Latest user note',
      folder_id: 'latest-folder',
      is_favorite: true,
      transcript_json: source('Current transcript.'),
      enhanced_notes: 'New notes',
      analysis_json: JSON.stringify(analysis('New overview.')),
      user_edits_json: JSON.stringify({
        __previous_generated_notes__: {
          original: 'Restored notes',
          edited: JSON.stringify(snapshot),
          edited_at: '2026-08-27T00:00:00.000Z',
        },
      }),
    });

    expect(restoreMeetingNotesSnapshot(meetingId)).toBe(true);
    expect(getMeeting(meetingId)).toMatchObject({
      title: 'Latest title',
      user_notes: 'Latest user note',
      folder_id: 'latest-folder',
      is_favorite: 1,
      enhanced_notes: 'Restored notes',
      analysis_json: JSON.stringify(restoredAnalysis),
      user_edits_json: JSON.stringify({
        overview: {
          original: 'Restored overview.',
          edited: 'Saved edit.',
          edited_at: '2026-08-27T00:00:00.000Z',
        },
      }),
    });
  });

  it('publishes an authorized partial capture gap only after its guarded lease claim', async () => {
    const meetingId = 'partial-gap-retry-publication';
    const transcriptJson = source('Recovered partial discussion.');
    const integrityJson = JSON.stringify({
      causes: [{ code: 'capture_gap_detected' }],
    });
    saveMeeting({
      id: meetingId,
      title: 'Recovered recording',
      transcript_status: 'needs_attention',
      transcript_json: transcriptJson,
      transcript_integrity_json: integrityJson,
      capture_journal_generation: 'journal-authorized',
      finalization_status: 'finalized',
    });
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting,
        getMeetingAnalysisPublicationRevisions,
        getMeetingAnalysisRun,
        beginMeetingAnalysisRun,
        updateMeetingAnalysisRunStatus,
        updateMeetingAnalysisRunStatusIfCurrent,
        isMeetingAnalysisRunCurrent: (input) => {
          const current = getMeetingAnalysisRun(input.meetingId);
          return Boolean(
            current &&
              current.run_id === input.runId &&
              current.input_revision === input.inputRevision &&
              current.notes_status ===
                (input.requirePublished ? 'published' : 'running'),
          );
        },
        publishMeetingNotesIfCurrent,
        getAllEntities: () => [],
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis: async () =>
          analysis('Published partial notes.'),
      }),
      createRunId: () => 'partial-notes-run',
    });
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'GET_MEETING') return getMeeting(args[0] as string);
      if (channel === 'CLAIM_DOWNSTREAM_PROCESSING') {
        return claimMeetingDownstreamProcessing(
          args[0] as string,
          args[1] as Parameters<typeof claimMeetingDownstreamProcessing>[1],
        );
      }
      if (channel === 'GENERATE_MEETING_NOTES') {
        return coordinator.generateAndPublishMeetingNotes(
          args[0] as Parameters<
            typeof coordinator.generateAndPublishMeetingNotes
          >[0],
        );
      }
      throw new Error(`unexpected channel: ${channel}`);
    });

    await expect(
      retryMeetingTranscriptValidation(meetingId, invoke),
    ).resolves.toEqual({ status: 'needs_attention' });
    expect(getMeetingAnalysisRun(meetingId)).toMatchObject({
      run_id: 'partial-notes-run',
      notes_status: 'published',
    });
    expect(
      JSON.parse(String(getMeeting(meetingId)?.analysis_json)),
    ).toMatchObject({
      overview: 'Published partial notes.',
    });
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'GET_MEETING',
      'CLAIM_DOWNSTREAM_PROCESSING',
      'GENERATE_MEETING_NOTES',
    ]);
  });

  it('publishes notes for a meeting with incomplete system capture when lease is claimed', async () => {
    const meetingId = 'system-incomplete-retry-publication';
    const transcriptJson = source('Preserved live meeting discussion.');
    const integrityJson = JSON.stringify({
      causes: [{ code: 'required_source_failed' }],
      reasons: ['system_capture_incomplete'],
    });
    saveMeeting({
      id: meetingId,
      title: 'Meeting with Incomplete Audio',
      transcript_status: 'needs_attention',
      transcript_json: transcriptJson,
      transcript_integrity_json: integrityJson,
      capture_journal_generation: 'journal-system-gap',
      finalization_status: 'finalized',
    });
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting,
        getMeetingAnalysisPublicationRevisions,
        getMeetingAnalysisRun,
        beginMeetingAnalysisRun,
        updateMeetingAnalysisRunStatus,
        updateMeetingAnalysisRunStatusIfCurrent,
        isMeetingAnalysisRunCurrent: (input) => {
          const current = getMeetingAnalysisRun(input.meetingId);
          return Boolean(
            current &&
              current.run_id === input.runId &&
              current.input_revision === input.inputRevision &&
              current.notes_status ===
                (input.requirePublished ? 'published' : 'running'),
          );
        },
        publishMeetingNotesIfCurrent,
        getAllEntities: () => [],
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis: async () =>
          analysis('Published system-incomplete notes.'),
      }),
      createRunId: () => 'system-incomplete-notes-run',
    });
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'GET_MEETING') return getMeeting(args[0] as string);
      if (channel === 'CLAIM_DOWNSTREAM_PROCESSING') {
        return claimMeetingDownstreamProcessing(
          args[0] as string,
          args[1] as Parameters<typeof claimMeetingDownstreamProcessing>[1],
        );
      }
      if (channel === 'GENERATE_MEETING_NOTES') {
        return coordinator.generateAndPublishMeetingNotes(
          args[0] as Parameters<
            typeof coordinator.generateAndPublishMeetingNotes
          >[0],
        );
      }
      throw new Error(`unexpected channel: ${channel}`);
    });

    await expect(
      retryMeetingTranscriptValidation(meetingId, invoke),
    ).resolves.toEqual({ status: 'needs_attention' });
    expect(getMeetingAnalysisRun(meetingId)).toMatchObject({
      run_id: 'system-incomplete-notes-run',
      notes_status: 'published',
    });
    expect(
      JSON.parse(String(getMeeting(meetingId)?.analysis_json)),
    ).toMatchObject({
      overview: 'Published system-incomplete notes.',
    });
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'GET_MEETING',
      'CLAIM_DOWNSTREAM_PROCESSING',
      'GENERATE_MEETING_NOTES',
    ]);
  });

  it('rejects a partial-gap lease after its capture generation changes', async () => {
    const meetingId = 'partial-gap-stale-generation';
    saveMeeting({
      id: meetingId,
      title: 'Recovered recording',
      transcript_status: 'needs_attention',
      transcript_json: source('Recovered partial discussion.'),
      transcript_integrity_json: JSON.stringify({
        causes: [{ code: 'capture_gap_detected' }],
      }),
      capture_journal_generation: 'journal-original',
      finalization_status: 'finalized',
    });
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'GET_MEETING') return getMeeting(args[0] as string);
      if (channel === 'CLAIM_DOWNSTREAM_PROCESSING') {
        const current = getMeeting(meetingId);
        saveMeeting({
          ...current,
          capture_journal_generation: 'journal-replaced',
        });
        return claimMeetingDownstreamProcessing(
          args[0] as string,
          args[1] as Parameters<typeof claimMeetingDownstreamProcessing>[1],
        );
      }
      if (channel === 'GENERATE_MEETING_NOTES') {
        throw new Error('coordinator must not run after a stale lease claim');
      }
      throw new Error(`unexpected channel: ${channel}`);
    });

    await expect(
      retryMeetingTranscriptValidation(meetingId, invoke),
    ).resolves.toEqual({ status: 'superseded' });
    expect(invoke).not.toHaveBeenCalledWith(
      'GENERATE_MEETING_NOTES',
      expect.anything(),
    );
  });

  it('lets only the newest run publish and preserves unrelated meeting fields', () => {
    const meetingId = 'newest-run-wins';
    const revisions = fixture(meetingId);
    start(meetingId, 'run-old', 'input-old', revisions);
    start(meetingId, 'run-new', 'input-new', revisions);

    expect(publish(meetingId, 'run-old', 'input-old', revisions)).toBe(false);
    expect(publish(meetingId, 'run-new', 'input-new', revisions)).toBe(true);

    const current = getMeeting(meetingId);
    expect(current).toMatchObject({
      title: 'Original title',
      transcript_json: source('We agreed to publish the update.'),
      user_notes: 'Keep the launch date.',
      folder_id: 'folder-a',
      is_favorite: 1,
      analysis_schema_version: 3,
      analysis_edit_conflicts_json: '[]',
    });
    expect(JSON.parse(current.analysis_json ?? '{}')).toMatchObject({
      overview: 'Published only when current.',
    });
    expect(getMeetingAnalysisRun(meetingId)).toMatchObject({
      run_id: 'run-new',
      notes_status: 'published',
    });
  });

  it.each([
    [
      'source',
      (current: Record<string, unknown>) => ({
        ...current,
        transcript_json: source('A corrected transcript changed the source.'),
      }),
    ],
    [
      'user notes',
      (current: Record<string, unknown>) => ({
        ...current,
        user_notes: 'A user changed this while notes were generating.',
      }),
    ],
    [
      'eligibility proof',
      (current: Record<string, unknown>) => ({
        ...current,
        transcript_integrity_json: JSON.stringify({ trust: 'changed' }),
      }),
    ],
  ])('rejects publication after %s drift', (_kind, mutate) => {
    const meetingId = `stale-${_kind.replace(/\s/g, '-')}`;
    const revisions = fixture(meetingId);
    start(meetingId, `run-${_kind}`, `input-${_kind}`, revisions);
    saveMeeting(mutate(getMeeting(meetingId) as Record<string, unknown>));

    expect(
      publish(meetingId, `run-${_kind}`, `input-${_kind}`, revisions),
    ).toBe(false);
    expect(getMeeting(meetingId)).toMatchObject({ analysis_json: null });
    expect(getMeetingAnalysisRun(meetingId)).toMatchObject({
      notes_status: 'running',
    });
  });

  it('rebases the latest persisted edit instead of accepting a stale renderer snapshot', () => {
    const meetingId = 'edit-written-during-generation';
    const revisions = fixture(meetingId, {
      analysis: analysis('Original overview.', 'overview-source', [
        { text: 'Original task.', sourceKey: 'action-source' },
      ]),
    });
    start(meetingId, 'run-edit', 'input-edit', revisions);
    saveMeeting({
      ...(getMeeting(meetingId) as Record<string, unknown>),
      user_edits_json: JSON.stringify({
        overview: {
          original: 'Original overview.',
          edited: 'User clarification.',
          edited_at: '2026-08-26T00:01:00.000Z',
        },
        'all_action_items:0': {
          original: 'Original task.',
          edited: '',
          edited_at: '2026-08-26T00:01:00.000Z',
        },
        'native_continuations:all_action_items:0': {
          original: '[]',
          edited: '[{"id":"follow-up","text":"Ask design to review."}]',
          edited_at: '2026-08-26T00:01:00.000Z',
        },
      }),
    });

    expect(
      publish(
        meetingId,
        'run-edit',
        'input-edit',
        revisions,
        analysis('Original overview.', 'overview-source', [
          { text: 'Original task.', sourceKey: 'action-source' },
        ]),
      ),
    ).toBe(true);
    expect(
      JSON.parse(getMeeting(meetingId).user_edits_json ?? '{}'),
    ).toMatchObject({
      overview: {
        original: 'Original overview.',
        edited: 'User clarification.',
        edited_at: '2026-08-26T00:01:00.000Z',
      },
      'all_action_items:0': {
        original: 'Original task.',
        edited: '',
        edited_at: '2026-08-26T00:01:00.000Z',
      },
      'native_continuations:all_action_items:0': {
        original: '[]',
        edited: '[{"id":"follow-up","text":"Ask design to review."}]',
        edited_at: '2026-08-26T00:01:00.000Z',
      },
    });
  });

  it('removes whitespace overlays and preserves both new and prior conflicts', () => {
    const meetingId = 'conflicts-survive-rebase';
    const priorConflict = {
      path: 'topic:0:summary',
      original: 'Prior generated text.',
      edited: 'Prior user clarification.',
      edited_at: '2026-08-26T00:00:00.000Z',
      previousSourceKey: 'prior-source',
    };
    const revisions = fixture(meetingId, {
      analysis: analysis('Original overview.', 'overview-source', [
        { text: 'Original task.', sourceKey: 'action-source' },
      ]),
      edits: {
        overview: {
          original: 'Original overview. ',
          edited: ' Original overview.\n',
          edited_at: '2026-08-26T00:01:00.000Z',
        },
        'all_action_items:0': {
          original: 'Original task.',
          edited: 'Saved user task.',
          edited_at: '2026-08-26T00:02:00.000Z',
        },
      },
      conflicts: [priorConflict],
    });
    start(meetingId, 'run-conflict', 'input-conflict', revisions);

    expect(
      publish(
        meetingId,
        'run-conflict',
        'input-conflict',
        revisions,
        analysis('Original overview.', 'overview-source', [
          { text: 'Changed generated task.', sourceKey: 'action-source' },
        ]),
      ),
    ).toBe(true);
    expect(
      Object.keys(JSON.parse(getMeeting(meetingId).user_edits_json ?? '{}')),
    ).toEqual(['__previous_generated_notes__']);
    expect(
      JSON.parse(getMeeting(meetingId).analysis_edit_conflicts_json ?? '[]'),
    ).toEqual(
      expect.arrayContaining([
        priorConflict,
        expect.objectContaining({
          path: 'all_action_items:0',
          edited: 'Saved user task.',
        }),
      ]),
    );
  });

  it('keeps ambiguous and source-mismatched edits as conflicts', () => {
    const ambiguousId = 'duplicate-edit-ambiguity';
    const ambiguousRevisions = fixture(ambiguousId, {
      analysis: analysis('Original overview.', 'overview-source', [
        { text: 'Repeated task.', sourceKey: 'shared-source' },
      ]),
      edits: {
        'all_action_items:0': {
          original: 'Repeated task.',
          edited: 'Clarified task.',
          edited_at: '2026-08-26T00:01:00.000Z',
        },
      },
    });
    start(ambiguousId, 'run-ambiguous', 'input-ambiguous', ambiguousRevisions);
    expect(
      publish(
        ambiguousId,
        'run-ambiguous',
        'input-ambiguous',
        ambiguousRevisions,
        analysis('Original overview.', 'overview-source', [
          { text: 'Repeated task.', sourceKey: 'shared-source' },
          { text: 'Repeated task.', sourceKey: 'shared-source' },
        ]),
      ),
    ).toBe(true);
    expect(
      JSON.parse(getMeeting(ambiguousId).analysis_edit_conflicts_json ?? '[]'),
    ).toEqual([expect.objectContaining({ path: 'all_action_items:0' })]);

    const mismatchId = 'source-key-mismatch';
    const mismatchRevisions = fixture(mismatchId, {
      analysis: analysis('Original overview.', 'overview-source'),
      edits: {
        overview: {
          original: 'Original overview.',
          edited: 'Clarified overview.',
          edited_at: '2026-08-26T00:01:00.000Z',
        },
      },
    });
    start(mismatchId, 'run-mismatch', 'input-mismatch', mismatchRevisions);
    expect(
      publish(
        mismatchId,
        'run-mismatch',
        'input-mismatch',
        mismatchRevisions,
        analysis('Original overview.', 'new-overview-source'),
      ),
    ).toBe(true);
    expect(
      JSON.parse(getMeeting(mismatchId).analysis_edit_conflicts_json ?? '[]'),
    ).toEqual([expect.objectContaining({ path: 'overview' })]);
  });

  it('cleans the owned run row when a meeting is deleted', () => {
    const meetingId = 'deleted-run-cleanup';
    const revisions = fixture(meetingId);
    start(meetingId, 'run-delete', 'input-delete', revisions);

    deleteMeeting(meetingId);

    expect(getMeeting(meetingId)).toBeUndefined();
    expect(getMeetingAnalysisRun(meetingId)).toBeNull();
  });

  it('persists queued position and clears it when generation starts', () => {
    const meetingId = 'queued-run-state';
    const revisions = fixture(meetingId);
    beginMeetingAnalysisRun({
      meetingId,
      runId: 'run-queued',
      inputRevision: 'input-queued',
      ...revisions,
      reason: 'manual',
      stage: 'queued',
      queuePosition: 3,
    });

    expect(getMeetingAnalysisRun(meetingId)).toMatchObject({
      stage: 'queued',
      queue_position: 3,
    });
    expect(
      updateMeetingAnalysisQueuePosition({
        meetingId,
        runId: 'run-queued',
        queuePosition: 1,
      }),
    ).toBe(true);
    expect(getMeetingAnalysisRun(meetingId)?.queue_position).toBe(1);

    expect(
      updateMeetingAnalysisRunStatus({
        meetingId,
        runId: 'run-queued',
        notesStatus: 'running',
        secondaryStatus: 'pending',
        stage: 'notes_writer',
      }),
    ).toBe(true);
    expect(getMeetingAnalysisRun(meetingId)).toMatchObject({
      stage: 'notes_writer',
      queue_position: null,
    });
  });

  it('updates a primary queue snapshot in one validated batch', () => {
    const first = fixture('queued-snapshot-first');
    const second = fixture('queued-snapshot-second');
    beginMeetingAnalysisRun({
      meetingId: 'queued-snapshot-first',
      runId: 'run-snapshot-first',
      inputRevision: 'input-first',
      ...first,
      reason: 'manual',
      stage: 'queued',
      queuePosition: 2,
    });
    beginMeetingAnalysisRun({
      meetingId: 'queued-snapshot-second',
      runId: 'run-snapshot-second',
      inputRevision: 'input-second',
      ...second,
      reason: 'manual',
      stage: 'queued',
      queuePosition: 3,
    });

    expect(
      updateMeetingAnalysisQueueSnapshot([
        {
          meetingId: 'queued-snapshot-first',
          runId: 'run-snapshot-first',
          queuePosition: null,
        },
        {
          meetingId: 'queued-snapshot-second',
          runId: 'run-snapshot-second',
          queuePosition: 1,
        },
      ]),
    ).toBe(2);
    expect(
      getMeetingAnalysisRun('queued-snapshot-first')?.queue_position,
    ).toBeNull();
    expect(
      getMeetingAnalysisRun('queued-snapshot-second')?.queue_position,
    ).toBe(1);
  });

  it('stores only validated terminal metrics and retains the newest 100 runs', () => {
    const meetingId = 'metric-history-retention';
    fixture(meetingId);
    for (let index = 0; index < 101; index += 1) {
      const metrics = createMeetingNotesRunMetrics({
        reason: 'manual',
        sourceSegmentCount: 1,
        sourceCharacterCount: 34,
        startedAtMs: 0,
      }).snapshot('published', index + 1);
      upsertMeetingAnalysisRunMetric({
        meetingId,
        runId: `metric-${index.toString().padStart(3, '0')}`,
        reason: 'manual',
        status: 'published',
        metrics,
        startedAt: new Date(index * 1_000).toISOString(),
        completedAt: new Date(index * 1_000 + 500).toISOString(),
      });
    }

    const history = listMeetingAnalysisRunMetrics({ limit: 200 });
    expect(history).toHaveLength(100);
    expect(history[0]).toMatchObject({ runId: 'metric-100' });
    expect(history.at(-1)).toMatchObject({ runId: 'metric-001' });
    expect(() =>
      upsertMeetingAnalysisRunMetric({
        meetingId,
        runId: 'private-invalid',
        reason: 'manual',
        status: 'failed',
        metrics: { ...history[0]!.metrics, prompt: 'PRIVATE' },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }),
    ).toThrow('invalid_meeting_notes_run_metric');
  });

  it('deletes bounded metric history with its meeting', () => {
    const meetingId = 'deleted-run-history';
    fixture(meetingId);
    const metrics = createMeetingNotesRunMetrics({
      reason: 'automatic',
      sourceSegmentCount: 1,
      sourceCharacterCount: 20,
      startedAtMs: 0,
    }).snapshot('failed', 5);
    upsertMeetingAnalysisRunMetric({
      meetingId,
      runId: 'deleted-history-run',
      reason: 'automatic',
      status: 'failed',
      metrics,
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(5).toISOString(),
    });

    deleteMeeting(meetingId);

    expect(
      listMeetingAnalysisRunMetrics({ limit: 200 }).some(
        (entry) => entry.runId === 'deleted-history-run',
      ),
    ).toBe(false);
  });

  it('persists a stable failure code with failed run metrics', () => {
    const meetingId = 'metric-failure-code';
    fixture(meetingId);
    const metrics = createMeetingNotesRunMetrics({
      reason: 'automatic',
      sourceSegmentCount: 1,
      sourceCharacterCount: 34,
      startedAtMs: 0,
    }).snapshot('failed', 500);

    upsertMeetingAnalysisRunMetric({
      meetingId,
      runId: 'metric-failed',
      reason: 'automatic',
      status: 'failed',
      errorCode: 'notes_context_exhausted',
      metrics,
      startedAt: '2100-01-01T00:00:00.000Z',
      completedAt: '2100-01-01T00:00:00.500Z',
    });

    expect(listMeetingAnalysisRunMetrics({ limit: 1 })[0]).toMatchObject({
      runId: 'metric-failed',
      status: 'failed',
      errorCode: 'notes_context_exhausted',
    });
  });

  it('does not write secondary fields after the source revision is stale', () => {
    const meetingId = 'stale-secondary-write';
    const revisions = fixture(meetingId);
    start(meetingId, 'run-secondary', 'input-secondary', revisions);
    expect(
      publish(meetingId, 'run-secondary', 'input-secondary', revisions),
    ).toBe(true);

    expect(
      saveMeetingAnalysisSecondaryFieldsIfCurrent({
        meetingId,
        runId: 'run-secondary',
        inputRevision: 'input-secondary',
        ...revisions,
        sourceRevision: 'stale-source',
        valueSignalsJson: JSON.stringify({ continuity: ['late'] }),
      }),
    ).toBe(false);
    expect(getMeeting(meetingId)).toMatchObject({
      value_signals_json: null,
    });
  });
});
