import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({
  directory: `/tmp/pluto-tasks-${process.pid}-${Math.random().toString(16).slice(2)}`,
}));
vi.mock('electron', () => ({ app: { getPath: () => profile.directory } }));
import { syncMeetingActionEntitiesFromUserEdits } from '../../electron/database/meetingActionSync';
import * as db from '../../electron/db';
import {
  applyPersonalTaskChatAction,
  listPersonalTasks,
  removePersonalTaskTag,
  reviewPersonalTask,
  savePersonalTask,
  savePersonalTaskTag,
  setPersonalTaskFocus,
  setPersonalTaskStatus,
} from '../../electron/taskService';
import { getDashboardDateKey } from '../../src/components/features/dashboardModel';

beforeEach(() => {
  db.identityStore.setSelfPersonId(null);
  db.db.prepare('DELETE FROM person_aliases').run();
  db.db.prepare('DELETE FROM commitment_aliases').run();
  db.db.prepare('DELETE FROM entity_links').run();
  db.db.prepare('DELETE FROM meeting_entities').run();
  db.db
    .prepare(
      "DELETE FROM entities WHERE type IN ('action_item', 'project', 'person')",
    )
    .run();
  db.setSetting('personal_task_tags_v1', '[]');
  db.setSetting('personal_task_focus_date', '');
});
afterAll(() => {
  db.db.close();
  fs.rmSync(profile.directory, { recursive: true, force: true });
});

describe('shared personal tasks', () => {
  it('creates title-only work, edits optional fields, and preserves provenance', () => {
    const taskId = savePersonalTask({ title: '  Renew passport  ' });
    const tag = savePersonalTaskTag({ name: ' Personal ' });
    const project = db.upsertEntity({
      type: 'project',
      name: 'Autumn trip',
      dedupe_by_name: false,
    });
    savePersonalTask({
      id: taskId,
      title: 'Renew passport',
      projectId: project.id,
      tagIds: [tag.id, tag.id],
      dueDate: '2026-11-02',
      description: 'Bring a new photo.',
    });
    expect(listPersonalTasks().tasks[0]).toMatchObject({
      projectId: project.id,
      tagIds: [tag.id],
      description: 'Bring a new photo.',
      needsReview: false,
      entity: { name: 'Renew passport', due_date: '2026-11-02' },
    });
    expect(db.getEntityLinks(taskId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationship: 'belongs_to',
          state: 'confirmed',
          source: 'user',
        }),
      ]),
    );
    savePersonalTask({
      id: taskId,
      title: 'Renew passport',
      projectId: null,
      dueDate: null,
    });
    expect(db.getEntity(taskId)?.due_date).toBeNull();
    expect(db.getEntityLinks(taskId)).toHaveLength(0);
    expect(JSON.parse(db.getEntity(taskId)!.metadata!)).toMatchObject({
      origin: 'user',
      commitment_state: 'confirmed',
      task_tag_ids: [tag.id],
    });
  });
  it('deduplicates normalized tags, renames by ID, and merges/removes without deleting tasks', () => {
    const first = savePersonalTaskTag({ name: '  Deep   work ' });
    expect(savePersonalTaskTag({ name: 'deep work' }).id).toBe(first.id);
    const second = savePersonalTaskTag({ name: 'Writing' });
    const taskId = savePersonalTask({
      title: 'Write outline',
      tagIds: [first.id, second.id],
    });
    savePersonalTaskTag({ id: first.id, name: 'Concentration' });
    expect(listPersonalTasks().tags).toContainEqual({
      id: first.id,
      name: 'Concentration',
    });
    removePersonalTaskTag({ id: first.id, mergeInto: second.id });
    expect(listPersonalTasks().tasks[0].tagIds).toEqual([second.id]);
    removePersonalTaskTag({ id: second.id });
    expect(listPersonalTasks().tasks[0].tagIds).toEqual([]);
    expect(db.getEntity(taskId)?.name).toBe('Write outline');
  });
  it('rolls back a partial tag merge failure', () => {
    const first = savePersonalTaskTag({ name: 'First' });
    const second = savePersonalTaskTag({ name: 'Second' });
    const taskId = savePersonalTask({
      title: 'Fictional task',
      tagIds: [first.id],
    });
    db.db.exec(
      "CREATE TRIGGER reject_task_tag_update BEFORE UPDATE ON entities BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    try {
      expect(() =>
        removePersonalTaskTag({ id: first.id, mergeInto: second.id }),
      ).toThrow('test failure');
    } finally {
      db.db.exec('DROP TRIGGER reject_task_tag_update');
    }
    expect(listPersonalTasks().tags).toHaveLength(2);
    expect(JSON.parse(db.getEntity(taskId)!.metadata!).task_tag_ids).toEqual([
      first.id,
    ]);
  });
  it('does not promote uncertain ownership or expose another person’s work', () => {
    const other = db.upsertEntity({ type: 'person', name: 'Fictional Alex' });
    const candidate = db.upsertEntity({
      type: 'action_item',
      name: 'Check the plan',
      status: 'active',
      metadata: { commitment_state: 'possible', origin: 'extraction' },
    });
    const theirs = db.upsertEntity({
      type: 'action_item',
      name: 'Their own task',
      assigned_to: other.id,
      status: 'active',
      metadata: { commitment_state: 'confirmed' },
    });
    expect(listPersonalTasks().tasks.map((task) => task.entity.id)).toEqual([
      candidate.id,
    ]);
    expect(listPersonalTasks().tasks[0].needsReview).toBe(true);
    expect(() =>
      setPersonalTaskStatus({ id: candidate.id, status: 'completed' }),
    ).toThrow('not yours');
    expect(() =>
      setPersonalTaskStatus({ id: theirs.id, status: 'completed' }),
    ).toThrow('not yours');
    reviewPersonalTask({ id: candidate.id, state: 'confirmed' });
    expect(listPersonalTasks().tasks[0].needsReview).toBe(false);
  });
  it('resolves canonical self person identity when adopting and updating tasks after a person merge', () => {
    const aliasSelf = db.upsertEntity({
      type: 'person',
      name: 'Punit',
      dedupe_by_name: false,
    });
    const canonicalSelf = db.upsertEntity({
      type: 'person',
      name: 'Punit Mishra',
      dedupe_by_name: false,
    });
    db.identityStore.setSelfPersonId(aliasSelf.id);
    db.mergePerson(aliasSelf.id, canonicalSelf.id);
    const candidate = db.upsertEntity({
      type: 'action_item',
      name: 'Follow up on merged self task',
      status: 'active',
      metadata: { commitment_state: 'possible', origin: 'extraction' },
    });
    reviewPersonalTask({ id: candidate.id, state: 'confirmed' });
    expect(db.getEntity(candidate.id)?.assigned_to).toBe(canonicalSelf.id);
    expect(listPersonalTasks().tasks).toEqual([
      expect.objectContaining({
        needsReview: false,
        entity: expect.objectContaining({ id: candidate.id }),
      }),
    ]);
    setPersonalTaskStatus({ id: candidate.id, status: 'completed' });
    expect(db.getEntity(candidate.id)?.status).toBe('completed');
    setPersonalTaskStatus({ id: candidate.id, status: 'active' });
    expect(db.getEntity(candidate.id)?.status).toBe('active');
  });
  it('keeps a chosen Focus stable through removal, additions, completion, and the next day', () => {
    const ids = Array.from({ length: 7 }, (_, n) =>
      savePersonalTask({ title: `Task ${n}`, dueDate: `2026-11-0${n + 1}` }),
    );
    expect(
      listPersonalTasks().tasks.filter((task) => task.focused),
    ).toHaveLength(5);
    expect(() => setPersonalTaskFocus({ id: ids[6], focused: true })).toThrow(
      'five tasks',
    );
    setPersonalTaskFocus({ id: ids[0], focused: false });
    expect(
      listPersonalTasks().tasks.filter((task) => task.focused),
    ).toHaveLength(4);
    setPersonalTaskFocus({ id: ids[6], focused: true });
    expect(
      listPersonalTasks()
        .tasks.filter((task) => task.focused)
        .map((task) => task.entity.id),
    ).toEqual(expect.arrayContaining([ids[6]]));
    for (const task of listPersonalTasks().tasks.filter((task) => task.focused))
      setPersonalTaskStatus({ id: task.entity.id, status: 'completed' });
    savePersonalTask({ title: 'A fresh task' });
    expect(
      listPersonalTasks().tasks.filter((task) => task.focused),
    ).toHaveLength(0);
    db.setSetting('personal_task_focus_date', '2000-01-01');
    expect(listPersonalTasks().tasks.some((task) => task.focused)).toBe(true);
    expect(db.getSetting('personal_task_focus_date')).not.toBe(
      getDashboardDateKey(),
    );
  });
  it('keeps chat creation idempotent and rechecks a status proposal before applying', () => {
    const proposal = {
      kind: 'create_task',
      text: 'Send the outline',
      label: 'Add task',
    };
    const id = applyPersonalTaskChatAction({
      requestId: 'message-1',
      proposal,
    });
    expect(
      applyPersonalTaskChatAction({ requestId: 'message-1', proposal }),
    ).toBe(id);
    expect(listPersonalTasks().tasks).toHaveLength(1);
    const complete = {
      kind: 'set_task_status',
      taskId: id,
      text: 'Send the outline',
      status: 'completed',
      label: 'Mark complete',
    };
    applyPersonalTaskChatAction({ requestId: 'message-2', proposal: complete });
    expect(db.getEntity(id)?.status).toBe('completed');
    applyPersonalTaskChatAction({
      requestId: 'message-3',
      proposal: { ...complete, status: 'active' },
    });
    expect(db.getEntity(id)?.status).toBe('active');
    savePersonalTask({ id, title: 'Send the revised outline' });
    expect(() =>
      applyPersonalTaskChatAction({
        requestId: 'message-4',
        proposal: complete,
      }),
    ).toThrow('changed');
  });
  it('synchronizes completion and reopening with exact source notes, preserving tags', () => {
    const meetingId = 'tasks-source-meeting';
    db.saveMeeting({
      id: meetingId,
      title: 'Fictional planning',
      started_at: new Date().toISOString(),
      analysis_json: JSON.stringify({
        all_action_items: [{ text: 'Send the outline', assignee: 'Me' }],
      }),
      user_edits_json: '{}',
    });
    const source = db.upsertEntity({
      type: 'action_item',
      name: 'Send the outline',
      status: 'active',
      metadata: {
        origin: 'extraction',
        commitment_state: 'confirmed',
        source_meeting_id: meetingId,
        source_path: 'all_action_items:0',
        source_index: 0,
        original_description: 'Send the outline',
        assignee_name: 'Me',
      },
    });
    const tag = savePersonalTaskTag({ name: 'Writing' });
    savePersonalTask({ id: source.id, title: source.name, tagIds: [tag.id] });
    setPersonalTaskStatus({ id: source.id, status: 'completed' });
    let meeting = db.getMeeting(meetingId) as { user_edits_json: string };
    expect(
      JSON.parse(meeting.user_edits_json)['completion:all_action_items:0']
        .edited,
    ).toBe('true');
    syncMeetingActionEntitiesFromUserEdits(db.db, meetingId);
    expect(JSON.parse(db.getEntity(source.id)!.metadata!).task_tag_ids).toEqual(
      [tag.id],
    );
    setPersonalTaskStatus({ id: source.id, status: 'active' });
    meeting = db.getMeeting(meetingId) as { user_edits_json: string };
    expect(
      JSON.parse(meeting.user_edits_json)['completion:all_action_items:0']
        .edited,
    ).toBe('false');
  });
  it('keeps task title edits in the source document through later note synchronization', () => {
    const meetingId = 'task-title-source';
    db.saveMeeting({
      id: meetingId,
      title: 'Fictional source',
      started_at: new Date().toISOString(),
      analysis_json: JSON.stringify({
        all_action_items: [{ text: 'Send outline', assignee: 'Me' }],
      }),
      user_edits_json: '{}',
    });
    const source = db.upsertEntity({
      type: 'action_item',
      name: 'Send outline',
      status: 'active',
      metadata: {
        commitment_state: 'confirmed',
        origin: 'extraction',
        source_meeting_id: meetingId,
        source_path: 'all_action_items:0',
        original_description: 'Send outline',
        assignee_name: 'Me',
      },
    });
    const tag = savePersonalTaskTag({ name: 'Writing' });
    savePersonalTask({
      id: source.id,
      title: 'Send the revised outline',
      tagIds: [tag.id],
    });
    syncMeetingActionEntitiesFromUserEdits(db.db, meetingId);
    expect(db.getEntity(source.id)?.name).toBe('Send the revised outline');
    expect(JSON.parse(db.getEntity(source.id)!.metadata!).task_tag_ids).toEqual(
      [tag.id],
    );
    db.db
      .prepare('UPDATE meetings SET user_edits_json = ? WHERE id = ?')
      .run('{broken', meetingId);
    expect(() =>
      savePersonalTask({
        id: source.id,
        title: 'Do not lose the source',
        tagIds: [],
      }),
    ).toThrow();
    expect(db.getEntity(source.id)?.name).toBe('Send the revised outline');
    expect(JSON.parse(db.getEntity(source.id)!.metadata!).task_tag_ids).toEqual(
      [tag.id],
    );
  });

  it('rejects stale form edits without overwriting newer task data', () => {
    const taskId = savePersonalTask({ title: 'Write the outline' });
    const original = listPersonalTasks().tasks.find(
      (task) => task.entity.id === taskId,
    )!;
    savePersonalTask({
      id: taskId,
      title: 'Write the revised outline',
      description: 'New context',
    });
    expect(() =>
      savePersonalTask({
        id: taskId,
        title: 'Old draft',
        expectedRevision: original.revision,
      }),
    ).toThrow('changed elsewhere');
    expect(db.getEntity(taskId)?.name).toBe('Write the revised outline');
    expect(
      listPersonalTasks().tasks.find((task) => task.entity.id === taskId)
        ?.description,
    ).toBe('New context');
  });
  it('rejects a stale suggestion that was consolidated into another task', () => {
    const canonicalId = savePersonalTask({ title: 'Send the outline' });
    const candidate = db.upsertEntity({
      type: 'action_item',
      name: 'Send an outline',
      status: 'active',
      metadata: { origin: 'extraction', commitment_state: 'possible' },
    });
    db.saveMeeting({
      id: 'fictional-source',
      title: 'Fictional source',
      started_at: new Date().toISOString(),
    });
    db.db
      .prepare(
        'INSERT INTO commitment_aliases (extraction_id, canonical_id, meeting_id, description, reason) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        candidate.id,
        canonicalId,
        'fictional-source',
        candidate.name,
        'Same task',
      );
    expect(() =>
      reviewPersonalTask({ id: candidate.id, state: 'confirmed' }),
    ).toThrow('unavailable');
    expect(
      JSON.parse(db.getEntity(candidate.id)!.metadata!).commitment_state,
    ).toBe('possible');
    expect(listPersonalTasks().tasks.map((task) => task.entity.id)).toEqual([
      canonicalId,
    ]);
  });
  it('keeps a meeting-derived title unchanged when its source block is unavailable', () => {
    const task = db.upsertEntity({
      type: 'action_item',
      name: 'Original task',
      status: 'active',
      metadata: {
        origin: 'extraction',
        commitment_state: 'confirmed',
        source_meeting_id: 'fictional-missing-source',
      },
    });
    expect(() =>
      savePersonalTask({ id: task.id, title: 'Changed task' }),
    ).toThrow('source task changed');
    expect(db.getEntity(task.id)?.name).toBe('Original task');
  });
  it('rejects malformed dates, statuses, projects and unknown tags before writing', () => {
    expect(() =>
      savePersonalTask({ title: 'Bad deadline', dueDate: '2026-02-30' }),
    ).toThrow();
    expect(() =>
      savePersonalTask({ title: 'Missing project', projectId: 'missing' }),
    ).toThrow('Project');
    expect(() =>
      savePersonalTask({ title: 'Missing tag', tagIds: ['missing'] }),
    ).toThrow('tag');
    expect(() =>
      setPersonalTaskStatus({ id: 'missing', status: 'deleted' }),
    ).toThrow();
    expect(listPersonalTasks().tasks).toHaveLength(0);
  });
});
