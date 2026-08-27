import { expect, it, vi } from 'vitest';
import {
  applyNotesAudit,
  projectAuditedNotes,
} from '../../electron/llm/meetingNotesAudit';
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
