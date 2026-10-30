import type {
  PersonalTask,
  SaveTaskInput,
  TasksSnapshot,
} from '../types/tasks';

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const task = (
  id: string,
  name: string,
  options: Partial<PersonalTask> = {},
): PersonalTask => ({
  entity: {
    id,
    name,
    type: 'action_item',
    normalized_name: name.toLowerCase(),
    status: 'active',
    due_date: null,
    assigned_to: null,
    metadata: '{"origin":"user","commitment_state":"confirmed"}',
    saliency_score: 1,
    domain_tag: 'work',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  projectId: null,
  tagIds: [],
  description: '',
  sourceMeetingId: null,
  sourceMeetingTitle: null,
  needsReview: false,
  focused: false,
  ...options,
});

// Fictional renderer-only workspace. Never reads the Electron profile.
const seed = (): TasksSnapshot => ({
  tags: [
    { id: 'writing', name: 'Writing' },
    { id: 'personal', name: 'Personal' },
    { id: 'follow-up', name: 'Follow-up' },
  ],
  projects: [
    { id: 'launch', name: 'Autumn launch' },
    { id: 'website', name: 'Website refresh' },
  ],
  tasks: [
    task('outline', 'Send the revised launch outline', {
      projectId: 'launch',
      tagIds: ['writing'],
      focused: true,
      sourceMeetingId: 'preview-q4-launch',
      sourceMeetingTitle: 'Launch planning · Demo meeting',
      description:
        'Include the revised rollout sequence and the support handoff.',
    }),
    task('copy', 'Review the new homepage copy', {
      projectId: 'website',
      tagIds: ['writing'],
      focused: true,
    }),
    task('passport', 'Renew passport', {
      tagIds: ['personal'],
      description: 'Bring a recent photo and the current passport.',
    }),
    task('followup', 'Check in on the customer trial', {
      projectId: 'launch',
      tagIds: ['follow-up'],
      sourceMeetingId: 'preview-q4-launch',
      sourceMeetingTitle: 'Launch planning · Demo meeting',
    }),
    task('dentist', 'Book a dentist appointment', { tagIds: ['personal'] }),
    task('candidate', 'Confirm the support handoff checklist', {
      projectId: 'launch',
      sourceMeetingId: 'preview-q4-launch',
      sourceMeetingTitle: 'Launch planning · Demo meeting',
      needsReview: true,
    }),
  ].map((item, index) =>
    index === 0
      ? { ...item, entity: { ...item.entity, due_date: today() } }
      : item,
  ),
});
const read = (): TasksSnapshot =>
  JSON.parse(
    localStorage.getItem('pluto.demo.tasks') || JSON.stringify(seed()),
  );

export const invokeTaskPreview = (
  channel: string,
  payload: Record<string, unknown> = {},
): unknown => {
  const snapshot = read();
  let result: unknown;
  const input = payload as unknown as SaveTaskInput;
  const found = snapshot.tasks.find((task) => task.entity.id === payload.id);
  switch (channel) {
    case 'TASKS_LIST':
      return snapshot;
    case 'TASKS_SAVE': {
      if (!input.title.trim()) throw new Error('Task title is required.');
      const item = found ?? task(crypto.randomUUID(), input.title.trim());
      item.entity.name = input.title.trim();
      if (input.dueDate !== undefined) item.entity.due_date = input.dueDate;
      if (input.projectId !== undefined) item.projectId = input.projectId;
      if (input.tagIds) item.tagIds = input.tagIds;
      if (input.description !== undefined) item.description = input.description;
      if (!found) snapshot.tasks.push(item);
      result = item.entity.id;
      break;
    }
    case 'TASKS_STATUS':
      if (found) {
        found.entity.status = payload.status as 'active' | 'completed';
        if (payload.status === 'completed') found.focused = false;
      }
      break;
    case 'TASKS_FOCUS':
      if (found) {
        if (
          payload.focused &&
          snapshot.tasks.filter((task) => task.focused).length >= 5
        )
          throw new Error(
            'Focus holds five tasks. Remove one before adding another.',
          );
        found.focused = Boolean(payload.focused);
      }
      break;
    case 'TASKS_REVIEW':
      if (found) {
        if (payload.state === 'rejected')
          snapshot.tasks = snapshot.tasks.filter((task) => task !== found);
        else found.needsReview = false;
      }
      break;
    case 'TASKS_TAG_SAVE': {
      const name = String(payload.name).trim().replace(/\s+/g, ' ');
      const tag = snapshot.tags.find(
        (tag) => tag.name.toLowerCase() === name.toLowerCase(),
      ) ?? { id: String(payload.id || crypto.randomUUID()), name };
      snapshot.tags = [
        ...snapshot.tags.filter((value) => value.id !== tag.id),
        tag,
      ];
      result = tag;
      break;
    }
    case 'TASKS_TAG_REMOVE':
      snapshot.tags = snapshot.tags.filter((tag) => tag.id !== payload.id);
      for (const task of snapshot.tasks)
        task.tagIds = [
          ...new Set(
            task.tagIds.flatMap((id) =>
              id === payload.id
                ? payload.mergeInto
                  ? [String(payload.mergeInto)]
                  : []
                : [id],
            ),
          ),
        ];
      break;
    default:
      throw new Error('This task action needs the desktop app.');
  }
  localStorage.setItem('pluto.demo.tasks', JSON.stringify(snapshot));
  return result;
};
