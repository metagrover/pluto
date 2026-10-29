import { readFileSync } from 'node:fs';
import ts from 'typescript';
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

// Execute the actual bootstrap callback, as secondaryRecoveryProvider does,
// without starting Electron, opening a database or invoking any provider.
const source = readFileSync(
  new URL('../../electron/main.ts', import.meta.url),
  'utf8',
);
const start = source.indexOf('  runSecondary: async (input) => {');
const end = source.indexOf('\n  },\n});', start);
if (start < 0 || end < start) throw new Error('Missing post-notes callback');
const callback = source
  .slice(start, end + '\n  }'.length)
  .replace('  runSecondary:', 'const runSecondary =');
const createSecondary = new Function(
  'db',
  'analysisDocumentV3ToMarkdown',
  'extractAndProcessEntities',
  'generateMid',
  'backgroundKnowledgeRefresh',
  'refreshKnowledgeDocsForMeetingNow',
  `${ts.transpileModule(callback, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}; return runSecondary;`,
);

const fixture = (
  providerName = 'Ollama (Local)',
  setting: string | undefined = 'ollama',
) => {
  const original = makeDirectNotesFixture();
  const analysis = projectAuditedNotes(applyNotesAudit(original));
  let current = true;
  let run: Record<string, unknown> | null = null;
  const meeting = {
    id: 'knowledge-meeting',
    title: 'Existing title',
    transcript_json: JSON.stringify(original.source.segments),
    transcript_status: 'validated',
    analysis_json: '',
  };
  const updates: Array<Record<string, unknown>> = [];
  const update = (input: Record<string, unknown>) => {
    if (!current) return false;
    updates.push(input);
    Object.assign(run!, {
      notes_status: input.notesStatus,
      secondary_status: input.secondaryStatus,
      stage: input.stage,
    });
    return true;
  };
  const db = {
    getMeeting: () => meeting,
    getAllEntities: () => [],
    getMeetingEntities: () => [],
    getSetting: () => setting,
    getMeetingAnalysisPublicationRevisions: () => ({
      sourceRevision: original.source.revision,
      eligibilityRevision: 'eligible',
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
    updateMeetingAnalysisRunStatus: update,
    updateMeetingAnalysisRunStatusIfCurrent: update,
    isMeetingAnalysisRunCurrent: () => current,
    publishMeetingNotesIfCurrent: () => {
      meeting.analysis_json = JSON.stringify(analysis);
      Object.assign(run!, { notes_status: 'published' });
      return true;
    },
    saveMeetingAnalysisSecondaryFieldsIfCurrent: () => current,
  };
  const refresh = vi.fn().mockResolvedValue({ requested: 2, completed: 2 });
  const enqueue = vi.fn();
  const provider = {
    name: providerName,
    generateStructuredAnalysis: vi.fn().mockResolvedValue(analysis),
    extractValueSignals: vi.fn().mockResolvedValue({}),
    extractEntities: vi.fn().mockResolvedValue({}),
    synthesizeKnowledgeDocument: vi.fn(),
  };
  const runSecondary = createSecondary(
    db,
    () => 'Reviewed notes',
    vi.fn(),
    () => ({}),
    { enqueue },
    refresh,
  );
  const coordinator = createMeetingAnalysisRunCoordinator({
    db: db as unknown as MeetingAnalysisRunCoordinatorDb,
    getSettings: async () => ({ llm_provider: setting }),
    getProvider: async () => provider,
    createRunId: () => 'knowledge-run',
    runSecondary,
  });
  const publish = () =>
    coordinator.generateAndPublishMeetingNotes({
      meetingId: meeting.id,
      requestId: 'publish',
      reason: 'automatic',
      template: 'auto',
    });
  return {
    publish,
    refresh,
    enqueue,
    meeting,
    updates,
    run: () => run,
    supersede: () => {
      current = false;
    },
    cancel: () => coordinator.supersedeMeetingNotes(meeting.id),
  };
};

it.each(['ollama', undefined])(
  'keeps local secondary work running until eligible docs finish (%s)',
  async (setting) => {
    const f = fixture('Ollama (Local)', setting);
    let finish!: (result: { requested: number; completed: number }) => void;
    f.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await f.publish();
    await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledOnce());
    expect(f.run()).toMatchObject({
      notes_status: 'published',
      secondary_status: 'running',
      stage: 'knowledge',
    });
    expect(f.meeting.analysis_json).not.toBe('');
    expect(f.refresh).toHaveBeenCalledWith(
      'knowledge-meeting',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        canCommit: expect.any(Function),
      }),
    );
    finish({ requested: 2, completed: 2 });
    await vi.waitFor(() =>
      expect(f.run()).toMatchObject({ secondary_status: 'complete' }),
    );
    expect(f.enqueue).not.toHaveBeenCalled();
  },
);

it.each(['paused', 'failed', 'incomplete'])(
  'preserves published notes and queues source-checked secondary recovery when refresh is %s',
  async (mode) => {
    const f = fixture();
    if (mode === 'paused')
      f.refresh.mockResolvedValue({ requested: 2, completed: 0 });
    else
      f.refresh.mockRejectedValue(
        new Error(
          mode === 'incomplete'
            ? 'knowledge_document_refresh_incomplete'
            : 'knowledge_document_refresh_failed',
        ),
      );
    await f.publish();
    await vi.waitFor(() =>
      expect(f.run()).toMatchObject({
        notes_status: 'published',
        secondary_status: mode === 'paused' ? 'pending' : 'failed',
      }),
    );
    expect(f.enqueue).toHaveBeenCalledWith('secondary:knowledge-meeting');
    expect(f.meeting.analysis_json).not.toBe('');
    expect(
      f.updates.some((update) => update.secondaryStatus === 'complete'),
    ).toBe(false);
  },
);

it('cannot commit completion or enqueue stale recovery after source supersession', async () => {
  const f = fixture();
  let finish!: (result: { requested: number; completed: number }) => void;
  f.refresh.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await f.publish();
  await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledOnce());
  const options = f.refresh.mock.calls[0]![1];
  f.supersede();
  expect(options.canCommit()).toBe(false);
  finish({ requested: 2, completed: 0 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    f.updates.some((update) => update.secondaryStatus === 'complete'),
  ).toBe(false);
  expect(f.enqueue).not.toHaveBeenCalled();
});

it('propagates cancellation to refresh and does not queue cancelled secondary recovery', async () => {
  const f = fixture();
  let finish!: (result: { requested: number; completed: number }) => void;
  f.refresh.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await f.publish();
  await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledOnce());
  const options = f.refresh.mock.calls[0]![1];
  f.cancel();
  expect(options.signal.aborted).toBe(true);
  expect(options.canCommit()).toBe(false);
  finish({ requested: 2, completed: 2 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    f.updates.some((update) => update.secondaryStatus === 'complete'),
  ).toBe(false);
  expect(f.enqueue).not.toHaveBeenCalled();
});

it.each([
  ['ChatGPT', 'chatgpt'],
  ['Ollama (Local)', 'chatgpt'],
])(
  'retains deferred behavior for nonlocal or switched-provider work (%s)',
  async (provider, setting) => {
    const f = fixture(provider, setting);
    await f.publish();
    await vi.waitFor(() =>
      expect(f.run()).toMatchObject({ secondary_status: 'complete' }),
    );
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.enqueue).toHaveBeenCalledWith('meeting:knowledge-meeting');
  },
);
