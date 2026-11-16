import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const profile = vi.hoisted(() => ({
  directory: `/tmp/pluto-actions-${process.pid}-${Math.random().toString(16).slice(2)}`,
}));
vi.mock('electron', () => ({ app: { getPath: () => profile.directory } }));
import * as db from '../../electron/db';
import {
  applyPlutoActionBatch,
  explicitRelativeDeadline,
  getPlutoActionBatch,
  isPlutoActionFollowup,
  isPlutoActionRequest,
  preparePlutoActions,
  undoPlutoActionBatch,
} from '../../electron/plutoActions';
import * as tasks from '../../electron/taskService';
import type {
  PlutoAction,
  PlutoActionContext,
} from '../../src/types/plutoActions';
const prepare = async (
  actions: PlutoAction[],
  context: PlutoActionContext = {},
) => {
  const reply = await preparePlutoActions({
    requestId: randomUUID(),
    query: 'Create tasks and update notes as requested',
    context,
    generate: async () => JSON.stringify({ actions }),
  });
  expect(reply?.actionBatchId, reply?.answer).toBeTruthy();
  return getPlutoActionBatch(reply!.actionBatchId!);
};
const apply = (batch: ReturnType<typeof getPlutoActionBatch>) =>
  applyPlutoActionBatch({
    id: batch.id,
    selectedIds: batch.items.map((i) => i.id),
  });
beforeEach(() => {
  db.db.exec(
    'DELETE FROM pluto_action_batches; DELETE FROM commitment_aliases; DELETE FROM entity_links; DELETE FROM meeting_entities; DELETE FROM notes; DELETE FROM entities; DELETE FROM meetings;',
  );
  db.identityStore.setSelfPersonId(null);
});
afterAll(() => {
  db.db.close();
  fs.rmSync(profile.directory, { recursive: true, force: true });
});
describe('shared Pluto actions', () => {
  it('resolves relative dates using local calendar days across month and DST boundaries', () => {
    expect(
      explicitRelativeDeadline(
        'Create a task in a week',
        new Date(2026, 9, 28, 12),
      ),
    ).toBe('2026-11-04');
    expect(
      explicitRelativeDeadline(
        'Move this task to tomorrow',
        new Date(2026, 11, 31, 23),
      ),
    ).toBe('2027-01-01');
    expect(
      explicitRelativeDeadline(
        'Create task in two weeks',
        new Date(2026, 1, 25, 9),
      ),
    ).toBe('2026-03-11');
  });
  it('does not persist a preview after cancellation', async () => {
    const controller = new AbortController();
    await expect(
      preparePlutoActions({
        requestId: randomUUID(),
        query: 'Create a task',
        signal: controller.signal,
        generate: async () => {
          controller.abort();
          return JSON.stringify({
            actions: [{ kind: 'create_task', title: 'Cancelled' }],
          });
        },
      }),
    ).rejects.toThrow();
    expect(
      db.db.prepare('SELECT COUNT(*) AS n FROM pluto_action_batches').get(),
    ).toEqual({ n: 0 });
  });
  it('rejects undo when a newly created task acquired an external link', async () => {
    const batch = await prepare([
      { kind: 'create_task', title: 'Send proposal' },
    ]);
    const result = apply(batch);
    const project = db.upsertEntity({ type: 'project', name: 'Later project' });
    db.linkEntities({
      source_entity_id: result.results![0].id,
      target_entity_id: project.id,
      relationship: 'belongs_to',
      state: 'confirmed',
      source: 'user',
      confidence: 1,
    });
    expect(() => undoPlutoActionBatch(batch.id)).toThrow('new links');
    expect(db.getEntityLinks(result.results![0].id)).toHaveLength(1);
  });
  it('previews without domain writes, applies a selected subset, survives reload and ignores retries', async () => {
    const batch = await prepare([
      { kind: 'create_note', title: 'Launch', content: 'Decision' },
      { kind: 'create_task', title: 'Send proposal', dueDate: '2026-11-14' },
    ]);
    expect(db.notesStore.listNotes()).toHaveLength(0);
    expect(tasks.listPersonalTasks().tasks).toHaveLength(0);
    const input = { id: batch.id, selectedIds: [batch.items[1].id] };
    const result = applyPlutoActionBatch(input);
    expect(result.state).toBe('applied');
    expect(db.notesStore.listNotes()).toHaveLength(0);
    expect(applyPlutoActionBatch(input)).toEqual(result);
    expect(getPlutoActionBatch(batch.id)).toEqual(result);
    expect(tasks.listPersonalTasks().tasks).toHaveLength(1);
    undoPlutoActionBatch(batch.id);
    expect(tasks.listPersonalTasks().tasks).toHaveLength(0);
    expect(applyPlutoActionBatch(input).state).toBe('undone');
  });
  it('appends and restores a note without losing prior content', async () => {
    const note = db.notesStore.saveNote({ title: 'Plan', content: 'Original' });
    const batch = await prepare([
      { kind: 'append_note', noteId: note.id, content: 'Decision' },
    ]);
    apply(batch);
    expect(db.notesStore.getNote(note.id)?.content).toBe(
      'Original\n\nDecision',
    );
    undoPlutoActionBatch(batch.id);
    expect(db.notesStore.getNote(note.id)?.content).toBe('Original');
  });
  it('refreshes stale previews and requires a second apply', async () => {
    const note = db.notesStore.saveNote({ title: 'Plan', content: 'Original' });
    const batch = await prepare([
      { kind: 'append_note', noteId: note.id, content: 'Decision' },
    ]);
    db.notesStore.saveNote({ ...note, content: 'New edit' });
    expect(apply(batch).state).toBe('pending');
    expect(db.notesStore.getNote(note.id)?.content).toBe('New edit');
    expect(apply(batch).state).toBe('applied');
    expect(db.notesStore.getNote(note.id)?.content).toBe(
      'New edit\n\nDecision',
    );
  });
  it('refuses undo after a later edit, leaving every affected item intact', async () => {
    const batch = await prepare([
      { kind: 'create_note', title: 'Launch', content: 'Decision' },
      { kind: 'create_task', title: 'Send proposal' },
    ]);
    const result = apply(batch);
    const noteId = result.results![0].id;
    db.notesStore.saveNote({ id: noteId, content: 'Later user edit' });
    expect(() => undoPlutoActionBatch(batch.id)).toThrow('later edit');
    expect(tasks.listPersonalTasks().tasks).toHaveLength(1);
    expect(db.notesStore.getNote(noteId)?.content).toBe('Later user edit');
  });
  it('rolls back a failed batch and keeps its preview retryable', async () => {
    const batch = await prepare([
      { kind: 'create_note', title: 'Launch', content: 'Decision' },
      { kind: 'create_task', title: 'Send proposal' },
    ]);
    db.db.exec(
      "CREATE TRIGGER fail_action BEFORE INSERT ON entities BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    try {
      expect(() => apply(batch)).toThrow('injected failure');
    } finally {
      db.db.exec('DROP TRIGGER fail_action');
    }
    expect(db.notesStore.listNotes()).toHaveLength(0);
    expect(getPlutoActionBatch(batch.id).state).toBe('pending');
    expect(apply(batch).state).toBe('applied');
  });
  it('edits and completes tasks, restoring linked note text on undo', async () => {
    const note = db.notesStore.saveNote({
      title: 'Plan',
      content: '[task: Send proposal]',
    });
    const taskId = tasks.savePersonalTask({
      title: 'Send proposal',
      sourceNoteId: note.id,
    });
    const batch = await prepare([
      {
        kind: 'edit_task',
        taskId,
        title: 'Send revised proposal',
        description: 'Include costs',
        dueDate: '2026-11-14',
      },
      { kind: 'task_status', taskId, status: 'completed' },
    ]);
    apply(batch);
    expect(db.notesStore.getNote(note.id)?.content).toBe(
      '[task:done: Send revised proposal]',
    );
    expect(db.getEntity(taskId)?.due_date).toBe('2026-11-14');
    undoPlutoActionBatch(batch.id);
    expect(db.notesStore.getNote(note.id)?.content).toBe(
      '[task: Send proposal]',
    );
    expect(db.getEntity(taskId)?.status).toBe('active');
  });
  it('creates linked tasks without overwriting unrelated work', async () => {
    const unrelated = tasks.savePersonalTask({
      title: 'Send proposal',
      dueDate: '2026-12-01',
    });
    const note = db.notesStore.saveNote({
      title: 'Plan',
      content: 'Send proposal after approval.',
    });
    const batch = await prepare(
      [{ kind: 'create_task', title: 'Send proposal', sourceNoteId: note.id }],
      { noteId: note.id },
    );
    const result = apply(batch);
    expect(result.results![0].id).not.toBe(unrelated);
    expect(db.notesStore.getNote(note.id)?.content).toContain(
      '[task: Send proposal]',
    );
    expect(db.getEntity(unrelated)?.due_date).toBe('2026-12-01');
    undoPlutoActionBatch(batch.id);
    expect(db.notesStore.getNote(note.id)?.content).toBe(note.content);
  });
  it('adds next-time items to a person note and does not create a task', async () => {
    const person = db.upsertEntity({ type: 'person', name: 'Priya' });
    const batch = await prepare(
      [
        {
          kind: 'person_agenda',
          personId: person.id,
          content: 'Discuss pricing',
        },
      ],
      { personId: person.id },
    );
    apply(batch);
    expect(db.notesStore.getNotesForEntity(person.id)[0]).toMatchObject({
      title: 'Next time with Priya',
      content: '- [ ] Discuss pricing',
    });
    expect(tasks.listPersonalTasks().tasks).toHaveLength(0);
    undoPlutoActionBatch(batch.id);
    expect(db.notesStore.listNotes()).toHaveLength(0);
  });
  it('asks for clarification for ambiguous person notes', async () => {
    const person = db.upsertEntity({ type: 'person', name: 'Priya' });
    for (const title of ['Agenda', 'Ideas'])
      db.notesStore.saveNote({
        title,
        content: 'Context',
        noteType: 'person',
        targetId: person.id,
      });
    const reply = await preparePlutoActions({
      requestId: randomUUID(),
      query: 'Add pricing to next time with Priya',
      generate: async () =>
        JSON.stringify({
          actions: [
            { kind: 'person_agenda', personId: person.id, content: 'Pricing' },
          ],
        }),
    });
    expect(reply?.actionBatchId).toBeUndefined();
    expect(reply?.answer).toContain('several notes');
  });
  it('preserves meeting evidence and appends only user notes', async () => {
    db.saveMeeting({
      id: 'meeting',
      title: 'Planning',
      started_at: new Date().toISOString(),
      user_notes: 'My notes',
      enhanced_notes: 'Generated evidence',
      transcript_json: '[]',
      user_edits_json: '{}',
    });
    const batch = await prepare(
      [
        {
          kind: 'append_meeting',
          meetingId: 'meeting',
          content: 'New decision',
        },
      ],
      { meetingId: 'meeting' },
    );
    apply(batch);
    let meeting = db.getMeeting('meeting') as db.PersistedMeeting;
    expect(meeting.enhanced_notes).toBe('Generated evidence');
    expect(meeting.transcript_json).toBe('[]');
    expect(JSON.parse(meeting.user_edits_json!).user_notes.edited).toBe(
      'My notes\n\nNew decision',
    );
    undoPlutoActionBatch(batch.id);
    meeting = db.getMeeting('meeting') as db.PersistedMeeting;
    expect(meeting.user_edits_json).toBe('{}');
  });
  it('rejects invented IDs, invalid dates and unsupported actions without writes', async () => {
    for (const action of [
      { kind: 'edit_task', taskId: 'missing', title: 'Oops' },
      { kind: 'create_task', title: 'Oops', dueDate: '2026-02-30' },
      { kind: 'send_email', content: 'Oops' },
    ]) {
      const reply = await preparePlutoActions({
        requestId: randomUUID(),
        query: 'Create a task',
        generate: async () => JSON.stringify({ actions: [action] }),
      });
      expect(reply?.actionBatchId).toBeUndefined();
    }
    expect(tasks.listPersonalTasks().tasks).toHaveLength(0);
  });
  it('recognizes action requests without capturing ordinary chat requests', () => {
    for (const query of [
      'Create a task to email Bob tomorrow',
      'Add this to my notes',
      'Make a note of the pricing decision',
      'Turn these action items into tasks',
      'Mark the deck review task done',
      'Add pricing to next time with Priya',
      'Please reopen the launch task',
      'Create a task to send an email to Bob',
    ])
      expect(isPlutoActionRequest(query), query).toBe(true);
    for (const query of [
      'Turn this into an email to Sam',
      'Make this shorter',
      'Update me on what was decided in this meeting',
      'Update me on the notes',
      'Create an email from these notes',
      'Complete this sentence',
      'Do not create a task',
    ])
      expect(isPlutoActionRequest(query), query).toBe(false);
  });
  it('continues an action only for a short reply naming its target', () => {
    const turns = [
      { role: 'user' as const, content: 'Add this to my notes' },
      {
        role: 'assistant' as const,
        content: 'Which note should I add this to?',
      },
    ];
    expect(isPlutoActionFollowup('The launch note', turns)).toBe(true);
    expect(
      isPlutoActionFollowup('What did Priya say about pricing?', turns),
    ).toBe(false);
    expect(isPlutoActionFollowup('Summarize the last meeting', turns)).toBe(
      false,
    );
  });
  it('does not treat a source named for today as a deadline', () => {
    expect(
      explicitRelativeDeadline("Create a task about today's meeting"),
    ).toBeUndefined();
  });
  it('keeps due dates on edits that only rename a task', async () => {
    const taskId = tasks.savePersonalTask({ title: 'Call mom' });
    const reply = await preparePlutoActions({
      requestId: randomUUID(),
      query: "Edit the task I added today to say 'Call Ana'",
      generate: async () =>
        JSON.stringify({
          actions: [{ kind: 'edit_task', taskId, title: 'Call Ana' }],
        }),
    });
    const batch = getPlutoActionBatch(reply!.actionBatchId!);
    expect(batch.items[0].action).toEqual({
      kind: 'edit_task',
      taskId,
      title: 'Call Ana',
    });
  });
  it('acts inside a recurring meeting whose title other meetings share', async () => {
    for (const id of ['sync-1', 'sync-2'])
      db.saveMeeting({
        id,
        title: 'Weekly planning',
        started_at: new Date().toISOString(),
        user_notes: 'Notes',
        transcript_json: '[]',
        user_edits_json: '{}',
      });
    const reply = await preparePlutoActions({
      requestId: randomUUID(),
      query: 'Add a task to send the weekly planning deck',
      context: { meetingId: 'sync-2' },
      generate: async () =>
        JSON.stringify({
          actions: [
            {
              kind: 'create_task',
              title: 'Send the weekly planning deck',
              sourceMeetingId: 'sync-2',
            },
          ],
        }),
    });
    expect(reply?.actionBatchId, reply?.answer).toBeTruthy();
  });
  it('lets provider failures reach the chat instead of answering with them', async () => {
    await expect(
      preparePlutoActions({
        requestId: randomUUID(),
        query: 'Create a task',
        generate: async () => {
          throw new Error('Not enough memory');
        },
      }),
    ).rejects.toThrow('Not enough memory');
  });
  it('does not call the planner for discussion or a negated command', async () => {
    const generate = vi.fn();
    expect(
      await preparePlutoActions({
        requestId: randomUUID(),
        query: 'Do not create a task',
        generate,
      }),
    ).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });
});
