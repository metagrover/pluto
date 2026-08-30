export type UserProjectMilestoneStatus =
  | 'planned'
  | 'in_progress'
  | 'completed';

export interface UserProjectMilestone {
  id: string;
  title: string;
  status: UserProjectMilestoneStatus;
  targetDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserProjectMilestoneInput {
  id?: string;
  title: string;
  status: UserProjectMilestoneStatus;
  targetDate?: string | null;
  note?: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseMetadata = (metadata: string | null): Record<string, unknown> => {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const isStatus = (value: unknown): value is UserProjectMilestoneStatus =>
  value === 'planned' || value === 'in_progress' || value === 'completed';

const optionalText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const readMilestone = (value: unknown): UserProjectMilestone | null => {
  if (!isRecord(value)) return null;
  const { id, title, status, targetDate, note, createdAt, updatedAt } = value;
  if (
    typeof id !== 'string' ||
    !id.trim() ||
    typeof title !== 'string' ||
    !title.trim() ||
    !isStatus(status) ||
    (targetDate !== null && typeof targetDate !== 'string') ||
    (note !== null && typeof note !== 'string') ||
    typeof createdAt !== 'string' ||
    !createdAt ||
    typeof updatedAt !== 'string' ||
    !updatedAt
  )
    return null;
  return {
    id: id.trim(),
    title: title.trim(),
    status,
    targetDate: optionalText(targetDate),
    note: optionalText(note),
    createdAt,
    updatedAt,
  };
};

export const readUserProjectMilestones = (
  metadata: string | null,
): UserProjectMilestone[] => {
  const value = parseMetadata(metadata).projectMilestones;
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const milestone = readMilestone(item);
        return milestone ? [milestone] : [];
      })
    : [];
};

export const withSavedUserProjectMilestone = (
  metadata: string | null,
  input: UserProjectMilestoneInput,
  options: { id: string; now: string },
): { metadata: string; milestone: UserProjectMilestone } => {
  const title = input.title.trim();
  if (!title) throw new Error('project_milestone_title_required');
  if (!isStatus(input.status))
    throw new Error('project_milestone_status_invalid');

  const current = readUserProjectMilestones(metadata);
  const existing = input.id
    ? current.find((milestone) => milestone.id === input.id)
    : undefined;
  if (input.id && !existing) throw new Error('project_milestone_not_found');

  const milestone: UserProjectMilestone = {
    id: existing?.id ?? options.id,
    title,
    status: input.status,
    targetDate: optionalText(input.targetDate),
    note: optionalText(input.note),
    createdAt: existing?.createdAt ?? options.now,
    updatedAt: options.now,
  };
  const projectMilestones = existing
    ? current.map((item) => (item.id === existing.id ? milestone : item))
    : [...current, milestone];

  return {
    milestone,
    metadata: JSON.stringify({
      ...parseMetadata(metadata),
      projectMilestonesVersion: 1,
      projectMilestones,
    }),
  };
};

export const withoutUserProjectMilestone = (
  metadata: string | null,
  milestoneId: string,
): { metadata: string; removed: UserProjectMilestone | null } => {
  const current = readUserProjectMilestones(metadata);
  const removed =
    current.find((milestone) => milestone.id === milestoneId) ?? null;
  return {
    removed,
    metadata: JSON.stringify({
      ...parseMetadata(metadata),
      projectMilestonesVersion: 1,
      projectMilestones: current.filter(
        (milestone) => milestone.id !== milestoneId,
      ),
    }),
  };
};

export const restoreUserProjectMilestone = (
  metadata: string | null,
  milestone: UserProjectMilestone,
  now: string,
): { metadata: string; milestone: UserProjectMilestone } => {
  const current = readUserProjectMilestones(metadata);
  if (current.some((item) => item.id === milestone.id))
    throw new Error('project_milestone_already_exists');
  const restored = { ...milestone, updatedAt: now };
  return {
    milestone: restored,
    metadata: JSON.stringify({
      ...parseMetadata(metadata),
      projectMilestonesVersion: 1,
      projectMilestones: [...current, restored],
    }),
  };
};
