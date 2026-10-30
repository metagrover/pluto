import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  buildDashboardHomeModel,
  getDashboardDateKey,
} from '../src/components/features/dashboardModel';
import type { SaveTaskInput, TaskTag, TasksSnapshot } from '../src/types/tasks';
import {
  getActionSourceMeetingId,
  getCommitmentState,
  isExplicitOtherActionOwner,
  isPersonalAction,
  parseActionMetadata,
} from '../src/utils/actionCommitment';
import { syncMeetingActionEntitiesFromUserEdits } from './database/meetingActionSync';
import * as store from './db';

const mirrorTaskTitle = (entity: store.Entity, text: string): void => {
  const metadata = parseActionMetadata(entity.metadata);
  const meetingId = getActionSourceMeetingId(entity.metadata);
  if (!meetingId) return;
  if (typeof metadata.source_path !== 'string')
    throw new Error('The source task changed. Open the meeting to review it.');
  const meeting = store.db
    .prepare('SELECT user_edits_json, analysis_json FROM meetings WHERE id = ?')
    .get(meetingId) as
    | { user_edits_json: string | null; analysis_json: string | null }
    | undefined;
  if (!meeting)
    throw new Error('The source meeting is unavailable. Refresh Tasks.');
  const edits = JSON.parse(meeting.user_edits_json || '{}');
  if (!edits || typeof edits !== 'object' || Array.isArray(edits))
    throw new Error(
      'The source notes could not be read. Open the meeting before editing this task.',
    );
  const editedAt = new Date().toISOString();
  if (typeof metadata.continuation_id === 'string') {
    const entry = edits[metadata.source_path];
    const items = JSON.parse(entry?.edited || '[]') as Array<{
      id: string;
      text: string;
    }>;
    const item = items.find((item) => item.id === metadata.continuation_id);
    if (!item)
      throw new Error(
        'The source task changed. Open the meeting to review it.',
      );
    item.text = text;
    edits[metadata.source_path] = {
      ...entry,
      edited: JSON.stringify(items),
      edited_at: editedAt,
    };
  } else {
    const analysis = JSON.parse(meeting.analysis_json || '{}');
    const typed = Array.isArray(analysis.all_action_items);
    const actions = typed ? analysis.all_action_items : analysis.action_items;
    const normalize = (value: unknown) =>
      typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
    const original =
      metadata.original_description ?? metadata.full_description ?? entity.name;
    const matches = (Array.isArray(actions) ? actions : []).flatMap(
      (action: string | { text?: string; assignee?: string }, index: number) =>
        (!typed ||
          normalize(typeof action === 'string' ? null : action.assignee) ===
            normalize(metadata.assignee_name)) &&
        [
          typeof action === 'string' ? action : action.text,
          edits[`all_action_items:${index}`]?.original,
          edits[`v2:action:${index}`]?.original,
        ].some(
          (value) =>
            normalize(value) && normalize(value) === normalize(original),
        )
          ? [index]
          : [],
    );
    if (matches.length !== 1)
      throw new Error(
        'The source task changed. Open the meeting to review it.',
      );
    for (const prefix of ['all_action_items', 'v2:action'])
      edits[`${prefix}:${matches[0]}`] = {
        original,
        edited: text,
        edited_at: editedAt,
      };
  }
  store.db
    .prepare('UPDATE meetings SET user_edits_json = ? WHERE id = ?')
    .run(JSON.stringify(edits), meetingId);
  syncMeetingActionEntitiesFromUserEdits(store.db, meetingId);
};

const id = z.string().trim().min(1).max(300);
const title = z.string().trim().min(1).max(1000);
const dueDate = z.string().date().nullable();
const saveSchema = z
  .object({
    id: id.optional(),
    title,
    dueDate: dueDate.optional(),
    projectId: id.nullable().optional(),
    tagIds: z.array(id).max(100).optional(),
    description: z.string().max(10000).optional(),
    requestId: id.optional(),
    expectedRevision: z.string().length(64).optional(),
  })
  .strict();
const tagSchema = z.object({ id, name: z.string().min(1).max(60) });
const tagKey = 'personal_task_tags_v1';
const readTags = (): TaskTag[] =>
  z.array(tagSchema).parse(JSON.parse(store.getSetting(tagKey) || '[]'));
const writeTags = (tags: TaskTag[]) =>
  store.setSetting(tagKey, JSON.stringify(tags));
const taskTags = (metadata: Record<string, unknown>): string[] =>
  Array.isArray(metadata.task_tag_ids)
    ? metadata.task_tag_ids.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
const canonicalAction = (entity: store.Entity): store.Entity => ({
  ...entity,
  assigned_to: entity.assigned_to
    ? store.resolvePersonIdentityId(entity.assigned_to)
    : null,
});
const selfOptions = () => {
  const rawSelfId = store.identityStore.getSelfPersonId();
  const selfPersonId = rawSelfId
    ? store.resolvePersonIdentityId(rawSelfId)
    : null;
  const selfEntity = selfPersonId ? store.getEntity(selfPersonId) : undefined;
  const profile = store.identityStore.getProfile();
  return {
    selfPersonId,
    selfNames: [
      ...(selfEntity?.name ? [selfEntity.name] : []),
      ...(profile ? [profile.preferredName, ...profile.aliases] : []),
    ],
  };
};
const visibleAction = (entity: store.Entity) => {
  const metadata = parseActionMetadata(entity.metadata);
  return (
    entity.type === 'action_item' &&
    ['active', 'completed', 'overdue', 'stale'].includes(entity.status || '') &&
    getCommitmentState(entity.metadata) !== 'rejected' &&
    !metadata.meeting_regeneration_retired_at &&
    !metadata.cancelled_at &&
    !isExplicitOtherActionOwner(canonicalAction(entity), selfOptions())
  );
};
const taskRevision = (entity: store.Entity): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        entity.name,
        entity.status,
        entity.due_date,
        entity.assigned_to,
        entity.metadata,
      ]),
    )
    .digest('hex');
const requireTask = (taskId: string, allowReview = false) => {
  const entity = store.getEntity(taskId);
  if (
    !entity ||
    store.resolveCommitmentIdentity(taskId)?.id !== taskId ||
    !visibleAction(entity) ||
    (!allowReview &&
      !isPersonalAction(
        { ...canonicalAction(entity), status: 'active' },
        selfOptions(),
      ))
  )
    throw new Error(
      'Task is unavailable or is not yours. Refresh Tasks and try again.',
    );
  return entity;
};
const patchMetadata = (
  entity: store.Entity,
  metadata: Record<string, unknown>,
) =>
  store.upsertEntity({
    id: entity.id,
    type: 'action_item',
    name: entity.name,
    metadata,
    dedupe_by_name: false,
  });

export const listPersonalTasks = (): TasksSnapshot => {
  const date = getDashboardDateKey();
  const options = selfOptions();
  const focusIds = new Set(
    buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: store.getOverdueActionItems().map(canonicalAction),
      staleActions: store.getStaleActionItems(7).map(canonicalAction),
      activeActions: store
        .getActionItemsByStatus('active')
        .map(canonicalAction),
      attentionAlerts: [],
      workspace: null,
      workingMemorySnapshots: [],
      graphStats: null,
      dateKey: date,
      focusSelectionDate: store.getSetting('personal_task_focus_date'),
      ...options,
    }).commitments.items.map((item) => item.id),
  );
  const projects = store
    .getEntitiesByType('project')
    .filter(
      (project) =>
        store.resolveProjectIdentityId(project.id) === project.id &&
        !['completed', 'merge_pending'].includes(project.status || '') &&
        parseActionMetadata(project.metadata).projectPortfolioDisposition !==
          'dismissed',
    )
    .map(({ id, name }) => ({ id, name }));
  const tasks = store
    .getEntitiesByType('action_item')
    .filter(visibleAction)
    .flatMap((entity) => {
      const metadata = parseActionMetadata(entity.metadata);
      const personal = isPersonalAction(
        { ...canonicalAction(entity), status: 'active' },
        options,
      );
      if (!personal && entity.status === 'completed') return [];
      const sourceMeetingId = getActionSourceMeetingId(entity.metadata);
      const links = store
        .getEntityLinks(entity.id)
        .filter((link) => link.source_entity_id === entity.id);
      const linkedProject = links.find(
        (link) =>
          link.relationship === 'belongs_to' &&
          link.state === 'confirmed' &&
          projects.some(
            (project) =>
              project.id ===
              store.resolveProjectIdentityId(link.target_entity_id),
          ),
      );
      return [
        {
          entity,
          revision: taskRevision(entity),
          projectId: Object.hasOwn(metadata, 'task_project_id')
            ? typeof metadata.task_project_id === 'string'
              ? store.resolveProjectIdentityId(metadata.task_project_id)
              : null
            : linkedProject
              ? store.resolveProjectIdentityId(linkedProject.target_entity_id)
              : null,
          tagIds: taskTags(metadata),
          description:
            typeof metadata.task_description === 'string'
              ? metadata.task_description
              : '',
          sourceMeetingId,
          sourceMeetingTitle: sourceMeetingId
            ? ((
                store.getMeeting(sourceMeetingId) as
                  | { title?: string }
                  | undefined
              )?.title ?? null)
            : null,
          needsReview:
            !personal ||
            (getCommitmentState(entity.metadata) === 'possible' &&
              metadata.origin !== 'user'),
          focused: focusIds.has(entity.id),
        },
      ];
    });
  return { tasks, tags: readTags(), projects };
};

export const savePersonalTask = (payload: SaveTaskInput): string =>
  store.withCommitmentTransaction(() => {
    const input = saveSchema.parse(payload);
    const existing = input.id ? requireTask(input.id) : undefined;
    if (
      existing &&
      input.expectedRevision &&
      taskRevision(existing) !== input.expectedRevision
    )
      throw new Error(
        'This task changed elsewhere. Close and reopen its details before saving.',
      );
    const taskId =
      existing?.id ??
      (input.requestId ? `task-chat-${input.requestId}` : randomUUID());
    if (!existing && store.getEntity(taskId)) return requireTask(taskId).id;
    const metadata: Record<string, unknown> = existing
      ? parseActionMetadata(existing.metadata)
      : {
          commitment_state: 'confirmed',
          origin: 'user',
          owner_source: 'user',
          created_from: input.requestId ? 'ask_pluto' : 'tasks',
        };
    if (input.tagIds) {
      const tags = readTags();
      if (input.tagIds.some((value) => !tags.some((tag) => tag.id === value)))
        throw new Error(
          'A tag was changed elsewhere. Refresh Tasks and try again.',
        );
      metadata.task_tag_ids = [...new Set(input.tagIds)];
    }
    if (input.projectId !== undefined) {
      const projectId = input.projectId
        ? store.resolveProjectIdentityId(input.projectId)
        : null;
      if (projectId && store.getEntity(projectId)?.type !== 'project')
        throw new Error('Project is unavailable. Choose another project.');
      const oldProject = metadata.task_project_id;
      metadata.task_project_id = projectId;
      if (typeof oldProject === 'string')
        store.db
          .prepare(
            "DELETE FROM entity_links WHERE source_entity_id = ? AND target_entity_id = ? AND relationship = 'belongs_to' AND source = 'user'",
          )
          .run(taskId, oldProject);
    }
    if (input.description !== undefined)
      metadata.task_description = input.description;
    if (existing && existing.name !== input.title) {
      mirrorTaskTitle(existing, input.title);
      metadata.full_description = input.title;
      metadata.user_edited = true;
      metadata.user_edited_at = new Date().toISOString();
    }
    const entity = store.upsertEntity({
      id: taskId,
      type: 'action_item',
      name: input.title,
      status: existing?.status ?? 'active',
      due_date: input.dueDate,
      clear_due_date: input.dueDate === null,
      metadata,
      dedupe_by_name: false,
    });
    if (typeof metadata.task_project_id === 'string')
      store.linkEntities({
        source_entity_id: entity.id,
        target_entity_id: metadata.task_project_id,
        relationship: 'belongs_to',
        state: 'confirmed',
        source: 'user',
        confidence: 1,
      });
    return entity.id;
  });

export const setPersonalTaskStatus = (payload: unknown): void =>
  store.withCommitmentTransaction(() => {
    const input = z
      .object({ id, status: z.enum(['active', 'completed']) })
      .strict()
      .parse(payload);
    const entity = requireTask(input.id);
    store.updateEntityStatus(entity.id, input.status);
  });
export const reviewPersonalTask = (payload: unknown): void =>
  store.withCommitmentTransaction(() => {
    const input = z
      .object({ id, state: z.enum(['confirmed', 'rejected']) })
      .strict()
      .parse(payload);
    const entity = requireTask(input.id, true);
    if (input.state === 'confirmed')
      store.correctActionOwner(
        entity.id,
        store.identityStore.getSelfPersonId(),
      );
    store.updateActionCommitmentState(entity.id, input.state);
  });
export const setPersonalTaskFocus = (payload: unknown): void =>
  store.withCommitmentTransaction(() => {
    const input = z
      .object({ id, focused: z.boolean() })
      .strict()
      .parse(payload);
    const entity = requireTask(input.id);
    if (entity.status === 'completed')
      throw new Error('Reopen this task before adding it to Focus.');
    const date = getDashboardDateKey();
    const focused = listPersonalTasks().tasks.filter(
      (task) => task.focused && task.entity.id !== entity.id,
    );
    if (input.focused && focused.length >= 5)
      throw new Error(
        'Focus holds five tasks. Remove one before adding another.',
      );
    const metadata = parseActionMetadata(entity.metadata);
    store.setSetting('personal_task_focus_date', date);
    for (const [rank, task] of focused.entries())
      patchMetadata(task.entity, {
        ...parseActionMetadata(task.entity.metadata),
        dashboard_daily_priority: { date, rank },
      });
    if (input.focused) {
      metadata.dashboard_daily_priority = { date, rank: focused.length };
      metadata.task_focus_excluded_date = undefined;
    } else {
      metadata.dashboard_daily_priority = undefined;
      metadata.task_focus_excluded_date = date;
    }
    patchMetadata(entity, metadata);
  });
export const savePersonalTaskTag = (payload: unknown): TaskTag =>
  store.withCommitmentTransaction(() => {
    const input = z
      .object({ id: id.optional(), name: z.string().trim().min(1).max(60) })
      .strict()
      .parse(payload);
    const tags = readTags();
    const name = tagSchema.shape.name.parse(
      input.name.normalize('NFKC').replace(/\s+/g, ' ').trim(),
    );
    const existing = tags.find(
      (tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (existing && (!input.id || input.id === existing.id)) return existing;
    if (existing)
      throw new Error('That tag already exists. Merge the tags instead.');
    const tag = { id: input.id ?? randomUUID(), name };
    if (input.id && !tags.some((value) => value.id === input.id))
      throw new Error('Tag is unavailable. Refresh Tasks.');
    writeTags([...tags.filter((value) => value.id !== tag.id), tag]);
    return tag;
  });
export const removePersonalTaskTag = (payload: unknown): void =>
  store.withCommitmentTransaction(() => {
    const input = z
      .object({ id, mergeInto: id.optional() })
      .strict()
      .parse(payload);
    const tags = readTags();
    if (
      input.mergeInto === input.id ||
      (input.mergeInto && !tags.some((tag) => tag.id === input.mergeInto))
    )
      throw new Error('Choose a different existing tag.');
    for (const entity of store.getEntitiesByType('action_item')) {
      const metadata = parseActionMetadata(entity.metadata);
      if (!taskTags(metadata).includes(input.id)) continue;
      metadata.task_tag_ids = [
        ...new Set(
          taskTags(metadata).flatMap((value) =>
            value === input.id
              ? input.mergeInto
                ? [input.mergeInto]
                : []
              : [value],
          ),
        ),
      ];
      patchMetadata(entity, metadata);
    }
    writeTags(tags.filter((tag) => tag.id !== input.id));
  });

export const applyPersonalTaskChatAction = (payload: unknown): string =>
  store.withCommitmentTransaction(() => {
    const input = z
      .object({
        requestId: id,
        proposal: z.discriminatedUnion('kind', [
          z
            .object({
              kind: z.literal('create_task'),
              text: title,
              label: z.string(),
              dueDate: dueDate.optional(),
            })
            .strict(),
          z
            .object({
              kind: z.literal('set_task_status'),
              taskId: id,
              text: title,
              status: z.enum(['active', 'completed']),
              label: z.string(),
            })
            .strict(),
        ]),
      })
      .strict()
      .parse(payload);
    if (input.proposal.kind === 'create_task')
      return savePersonalTask({
        title: input.proposal.text,
        dueDate: input.proposal.dueDate,
        requestId: input.requestId,
      });
    const entity = requireTask(input.proposal.taskId);
    if (entity.name !== input.proposal.text)
      throw new Error('This task changed. Ask Pluto again before updating it.');
    setPersonalTaskStatus({ id: entity.id, status: input.proposal.status });
    return entity.id;
  });
