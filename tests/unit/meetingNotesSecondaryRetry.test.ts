import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  applyNotesAudit,
  projectAuditedNotes,
} from '../../electron/llm/meetingNotesAudit';
import { NOTES_PROMPT_VERSION } from '../../electron/llm/meetingNotesTypes';
import {
  type MeetingAnalysisRunCoordinatorDb,
  createMeetingAnalysisRunCoordinator,
} from '../../electron/meetingAnalysisRuns';
import { makeDirectNotesFixture } from '../fixtures/meeting-notes-v10';

it('retries failed secondary work for a published revision without regenerating notes', async () => {
  const fixture = makeDirectNotesFixture();
  const analysis = projectAuditedNotes(applyNotesAudit(fixture));
  let run: Record<string, unknown> | null = null;
  const meeting = {
    id: 'retry',
    transcript_json: JSON.stringify(fixture.source.segments),
    transcript_status: 'validated',
    analysis_json: '',
  };
  const update = (input: Record<string, unknown>) => {
    Object.assign(run!, {
      notes_status: input.notesStatus,
      secondary_status: input.secondaryStatus,
    });
    return true;
  };
  const db = {
    getMeeting: () => meeting,
    getAllEntities: () => [],
    getMeetingAnalysisPublicationRevisions: () => ({
      sourceRevision: fixture.source.revision,
      eligibilityRevision: 'proof',
      userNotesHash: 'notes',
    }),
    getMeetingAnalysisRun: () => run,
    beginMeetingAnalysisRun: (input: Record<string, unknown>) => {
      run = {
        run_id: input.runId,
        input_revision: input.inputRevision,
        notes_status: 'running',
        secondary_status: 'pending',
      };
    },
    publishMeetingNotesIfCurrent: () => {
      meeting.analysis_json = JSON.stringify(analysis);
      Object.assign(run!, { notes_status: 'published' });
      return true;
    },
    updateMeetingAnalysisRunStatus: update,
    updateMeetingAnalysisRunStatusIfCurrent: update,
    isMeetingAnalysisRunCurrent: () => true,
  } as unknown as MeetingAnalysisRunCoordinatorDb;
  const generateStructuredAnalysis = vi.fn().mockResolvedValue(analysis);
  const runSecondary = vi
    .fn()
    .mockRejectedValueOnce(new Error('entity_extraction_failed'))
    .mockResolvedValue(undefined);
  const onUpdated = vi.fn();
  const coordinator = createMeetingAnalysisRunCoordinator({
    db,
    getSettings: async () => ({}),
    getProvider: async () => ({ name: 'ollama', generateStructuredAnalysis }),
    runSecondary,
    onUpdated,
  });
  const input = {
    meetingId: 'retry',
    requestId: 'first',
    reason: 'automatic' as const,
    template: 'auto' as const,
  };
  await coordinator.generateAndPublishMeetingNotes(input);
  await vi.waitFor(() =>
    expect(run).toMatchObject({ secondary_status: 'failed' }),
  );
  db.getAllEntities = () => [{ name: 'New extracted hint', type: 'project' }];
  await coordinator.generateAndPublishMeetingNotes({
    ...input,
    requestId: 'retry',
    reason: 'secondary',
  });
  await vi.waitFor(() =>
    expect(run).toMatchObject({ secondary_status: 'complete' }),
  );
  expect(generateStructuredAnalysis).toHaveBeenCalledTimes(1);
  expect(runSecondary).toHaveBeenCalledTimes(2);
  expect(onUpdated).toHaveBeenCalled();
});

it.each(['secondary', 'automatic'] as const)(
  'pairs %s retry input with the current publication after provider initialization',
  async (reason) => {
    const fixture = makeDirectNotesFixture();
    const analysis = projectAuditedNotes(applyNotesAudit(fixture));
    let meeting = {
      id: 'retry-race',
      transcript_json: JSON.stringify(fixture.source.segments),
      transcript_status: 'validated',
      analysis_json: JSON.stringify({
        ...analysis,
        overview: 'Earlier notes.',
      }),
    };
    let run = {
      run_id: 'earlier-run',
      input_revision: createHash('sha256')
        .update(
          JSON.stringify({
            sourceRevision: fixture.source.revision,
            eligibilityRevision: 'proof',
            userNotesHash: 'notes',
            terms: [],
            template: 'auto',
            provider: 'ollama',
            model: 'gemma4:12b',
            thinking: null,
            seed: null,
            contextTokens: 16_384,
            promptVersion: NOTES_PROMPT_VERSION,
          }),
        )
        .digest('hex'),
      notes_status: 'published',
      secondary_status: 'failed',
    };
    const revisions = {
      sourceRevision: fixture.source.revision,
      eligibilityRevision: 'proof',
      userNotesHash: 'notes',
    };
    const db = {
      // SQLite reads return snapshots, not a mutable reference to the stored row.
      getMeeting: () => ({ ...meeting }),
      getAllEntities: () => [],
      getMeetingAnalysisPublicationRevisions: () => revisions,
      getMeetingAnalysisRun: () => ({ ...run }),
      updateMeetingAnalysisRunStatusIfCurrent: vi.fn().mockReturnValue(true),
      isMeetingAnalysisRunCurrent: (input: {
        runId: string;
        inputRevision: string;
      }) =>
        input.runId === run.run_id &&
        input.inputRevision === run.input_revision &&
        run.notes_status === 'published',
    } as unknown as MeetingAnalysisRunCoordinatorDb;
    let finishInitialization = () => {};
    const initialization = new Promise<void>((resolve) => {
      finishInitialization = resolve;
    });
    const generateStructuredAnalysis = vi.fn();
    const runSecondary = vi.fn().mockResolvedValue(undefined);
    const coordinator = createMeetingAnalysisRunCoordinator({
      db,
      getSettings: async () => {
        await initialization;
        return {};
      },
      getProvider: async () => ({ name: 'ollama', generateStructuredAnalysis }),
      runSecondary,
    });
    const retry = coordinator.generateAndPublishMeetingNotes({
      meetingId: meeting.id,
      requestId: 'retry-request',
      reason,
      template: 'auto',
    });

    meeting = {
      ...meeting,
      analysis_json: JSON.stringify({ ...analysis, overview: 'Latest notes.' }),
    };
    run = { ...run, run_id: 'latest-run' };
    finishInitialization();

    await expect(retry).resolves.toMatchObject({ runId: 'latest-run' });
    await vi.waitFor(() => expect(runSecondary).toHaveBeenCalledTimes(1));
    expect(runSecondary).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'latest-run',
        analysis: expect.objectContaining({ overview: 'Latest notes.' }),
      }),
    );
    const secondaryInput = runSecondary.mock.calls[0][0];
    expect(secondaryInput.canCommit()).toBe(true);
    run = { ...run, run_id: 'replacement-run' };
    expect(secondaryInput.canCommit()).toBe(false);
    expect(generateStructuredAnalysis).not.toHaveBeenCalled();
  },
);
