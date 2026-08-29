import type React from 'react';
import { useState } from 'react';
import {
  type Entity,
  linkEntities,
  upsertEntity,
} from '../../api/knowledgeGraph';
import type { ActionCommitmentMetadata } from '../../utils/actionCommitment';
import { ProjectsOverview } from '../features/projects/ProjectsOverview';

export const buildQuickAddActionEntity = (value: string) => {
  const description = value.trim();
  return {
    type: 'action_item' as const,
    name: description,
    status: 'active' as const,
    dedupe_by_name: false,
    metadata: {
      full_description: description,
      commitment_state: 'confirmed',
      origin: 'user',
    } satisfies ActionCommitmentMetadata,
  };
};

// ─── Constants & Helpers ───────────────────────────────────────────
export const AT_RISK_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;
export const MAX_INBOX_PREVIEW = 6;

export const safeParseMetadata = (metadata: unknown): Record<string, any> => {
  if (typeof metadata === 'object' && metadata !== null) {
    return metadata as Record<string, any>;
  }
  if (typeof metadata !== 'string' || !metadata.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(metadata);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

export const isTaskOverdue = (
  task: Entity,
  now: number = Date.now(),
): boolean => {
  if (task.status === 'completed') return false;
  return (
    task.status === 'overdue' ||
    Boolean(task.due_date && new Date(task.due_date).getTime() < now)
  );
};

// ─── Health Logic ────────────────────────────────────────────────
type HealthStatus = 'on_track' | 'at_risk' | 'slipping' | 'complete';

const HEALTH_PRIORITY: Record<HealthStatus, number> = {
  slipping: 0,
  at_risk: 1,
  on_track: 2,
  complete: 3,
};

const HEALTH_CONFIG: Record<
  HealthStatus,
  { dot: string; label: string; color: string; bg: string }
> = {
  on_track: {
    dot: '🟢',
    label: 'On Track',
    color: 'text-pro-success',
    bg: 'bg-pro-success/10',
  },
  at_risk: {
    dot: '🟡',
    label: 'At Risk',
    color: 'text-pro-warning',
    bg: 'bg-pro-warning/10',
  },
  slipping: {
    dot: '🔴',
    label: 'Slipping',
    color: 'text-pro-urgent',
    bg: 'bg-pro-urgent/10',
  },
  complete: {
    dot: '✓',
    label: 'Complete',
    color: 'text-pro-text-muted',
    bg: 'bg-pro-bg',
  },
};

export const buildProjectsBriefing = (tasks: Entity[], now = Date.now()) => {
  const active = tasks.filter(
    (task) => task.status === 'active' || task.status === 'overdue',
  );
  const completed = tasks.filter((task) => task.status === 'completed');
  const overdue = active.filter((task) => isTaskOverdue(task, now));
  return {
    active,
    completed,
    overdue,
    health: (active.length === 0
      ? 'complete'
      : overdue.length > 0
        ? 'slipping'
        : 'on_track') as HealthStatus,
  };
};

export const countAtRiskTasks = (tasks: Entity[], now = Date.now()) => {
  return tasks.filter((task) => {
    if (task.status !== 'active' || !task.due_date) return false;

    const dueAt = new Date(task.due_date).getTime();
    return dueAt >= now && dueAt - now < AT_RISK_THRESHOLD_MS;
  }).length;
};

export const partitionProjectsForDisplay = (
  projects: Entity[],
  groupedTasks: Record<string, Entity[]>,
) => {
  const activeProjects: Array<{
    project: Entity;
    index: number;
    health: HealthStatus;
  }> = [];
  const completedProjects: Entity[] = [];

  for (const [index, project] of projects.entries()) {
    const tasks = groupedTasks[project.id] || [];
    if (tasks.length === 0) continue;

    const briefing = buildProjectsBriefing(tasks);
    if (briefing.active.length > 0) {
      activeProjects.push({
        project,
        index,
        health: computeHealth(tasks),
      });
      continue;
    }

    if (briefing.completed.length > 0) {
      completedProjects.push(project);
    }
  }

  activeProjects.sort((a, b) => {
    const priorityDelta = HEALTH_PRIORITY[a.health] - HEALTH_PRIORITY[b.health];
    if (priorityDelta !== 0) return priorityDelta;
    return a.index - b.index;
  });

  return {
    activeProjects: activeProjects.map(({ project }) => project),
    completedProjects,
  };
};

export const getNextTaskStatusForToggle = (
  status: Entity['status'],
): Entity['status'] => {
  return status === 'completed' ? 'active' : 'completed';
};

const EXECUTION_STATUS_PRIORITY: Partial<
  Record<NonNullable<Entity['status']>, number>
> = {
  overdue: 0,
  active: 1,
};

export const sortExecutionTasksForDisplay = (tasks: Entity[]): Entity[] => {
  return [...tasks].sort((a, b) => {
    const priorityA = a.status ? (EXECUTION_STATUS_PRIORITY[a.status] ?? 2) : 2;
    const priorityB = b.status ? (EXECUTION_STATUS_PRIORITY[b.status] ?? 2) : 2;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
};

export const getExecutionBriefHeading = ({
  activeCount,
  overdueCount,
}: {
  activeCount: number;
  overdueCount: number;
}) => {
  if (activeCount === 0) return 'No active commitments';
  if (overdueCount > 0) return 'Slipping commitments';
  return 'Work in motion';
};

export const getProjectCardSummary = ({
  activeCount,
  overdueCount,
  atRiskCount,
  completedCount,
}: {
  activeCount: number;
  overdueCount: number;
  atRiskCount: number;
  completedCount: number;
}) => {
  if (activeCount === 0) {
    return `${completedCount} finished`;
  }

  if (overdueCount > 0) {
    return overdueCount === 1 ? '1 overdue' : `${overdueCount} overdue`;
  }

  if (atRiskCount > 0) {
    return atRiskCount === 1 ? '1 due soon' : `${atRiskCount} due soon`;
  }

  return activeCount === 1 ? '1 open' : `${activeCount} open`;
};

export const getInboxSummary = ({
  activeCount,
  overdueCount,
}: {
  activeCount: number;
  overdueCount: number;
}) => {
  if (overdueCount > 0) {
    return overdueCount === 1
      ? '1 overdue to triage'
      : `${overdueCount} overdue to triage`;
  }

  return `${activeCount} to triage`;
};

export const buildExecutionSummary = ({
  activeTaskCount,
  activeProjectCount,
  activeInboxTaskCount,
  overdueTaskCount,
}: {
  activeTaskCount: number;
  activeProjectCount: number;
  activeInboxTaskCount: number;
  overdueTaskCount: number;
}) => {
  const heading = getExecutionBriefHeading({
    activeCount: activeTaskCount,
    overdueCount: overdueTaskCount,
  });

  const overdueLabel =
    overdueTaskCount === 1 ? '1 overdue' : `${overdueTaskCount} overdue`;

  if (heading === 'No active commitments') {
    return {
      heading,
      detail:
        'Completed work is tucked away. Start from the inbox when something new appears.',
    };
  }

  const projectLabel =
    activeProjectCount === 1 ? '1 project' : `${activeProjectCount} projects`;

  if (overdueTaskCount > 0) {
    if (activeProjectCount === 0) {
      return {
        heading,
        detail: `${overdueLabel} in the inbox`,
      };
    }

    if (activeInboxTaskCount === 0) {
      return {
        heading,
        detail: `${overdueLabel} across ${projectLabel}`,
      };
    }

    const inboxLabel =
      activeInboxTaskCount === 1
        ? '1 inbox item'
        : `${activeInboxTaskCount} inbox items`;

    return {
      heading,
      detail: `${overdueLabel} across ${projectLabel} and ${inboxLabel}`,
    };
  }

  if (activeProjectCount === 0) {
    return {
      heading,
      detail: `${activeTaskCount} open in the inbox`,
    };
  }

  if (activeInboxTaskCount === 0) {
    return {
      heading,
      detail: `${activeTaskCount} open across ${projectLabel}`,
    };
  }

  const inboxLabel =
    activeInboxTaskCount === 1
      ? '1 inbox item'
      : `${activeInboxTaskCount} inbox items`;

  return {
    heading,
    detail: `${activeTaskCount} open across ${projectLabel} and ${inboxLabel}`,
  };
};

const computeHealth = (tasks: Entity[]): HealthStatus => {
  if (buildProjectsBriefing(tasks).active.length === 0) return 'complete';
  const now = Date.now();
  const activeTasks = tasks.filter(
    (t) => t.status === 'active' || t.status === 'overdue',
  );

  const hasOverdue = activeTasks.some((t) => isTaskOverdue(t, now));
  if (hasOverdue) return 'slipping';

  const hasAtRisk = activeTasks.some(
    (t) =>
      t.due_date &&
      new Date(t.due_date).getTime() - now < AT_RISK_THRESHOLD_MS &&
      new Date(t.due_date).getTime() >= now,
  );
  if (hasAtRisk) return 'at_risk';

  return 'on_track';
};

// ─── TaskRow ─────────────────────────────────────────────────────
const TaskRow: React.FC<{
  task: Entity;
  onToggle: (task: Entity) => void;
}> = ({ task, onToggle }) => {
  const metadata = safeParseMetadata(task.metadata);
  const isCompleted = task.status === 'completed';
  const isOverdue = isTaskOverdue(task);

  return (
    <div
      className={`group flex items-center gap-4 border-b border-pro-border/30 px-5 py-3.5 transition-colors duration-200 ${
        isCompleted ? 'opacity-50' : 'hover:bg-pro-hover/60'
      }`}
    >
      {/* Checkbox */}
      <button
        type="button"
        onClick={() => onToggle(task)}
        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all shrink-0 ${
          isCompleted
            ? 'bg-pro-accent border-pro-accent text-white'
            : 'border-pro-border/60 group-hover:border-pro-accent/40 bg-transparent'
        }`}
      >
        {isCompleted && (
          <svg
            aria-hidden="true"
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
      </button>

      {/* Task info */}
      <div className="flex-1 min-w-0">
        <p
          className={`text-[13px] font-medium leading-snug truncate ${
            isCompleted
              ? 'line-through text-pro-text-muted'
              : 'text-pro-text-main'
          }`}
        >
          {metadata.full_description || task.name}
        </p>
      </div>

      {/* Assignee */}
      {metadata.assignee_name && (
        <span className="text-[10px] font-semibold text-pro-accent bg-pro-accent/10 px-2 py-0.5 rounded-md shrink-0">
          {metadata.assignee_name}
        </span>
      )}

      {/* Due date */}
      {task.due_date && (
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-md shrink-0 ${
            isOverdue
              ? 'bg-pro-urgent/10 text-pro-urgent'
              : 'bg-pro-bg text-pro-text-muted'
          }`}
        >
          {isOverdue ? '⚠ ' : ''}
          {new Date(task.due_date).toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
          })}
        </span>
      )}
    </div>
  );
};

// ─── QuickAddTask ────────────────────────────────────────────────
const QuickAddTask: React.FC<{
  projectId?: string;
  onTaskAdded: () => void;
}> = ({ projectId, onTaskAdded }) => {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!value.trim() || saving) return;
    setSaving(true);
    try {
      const entity = await upsertEntity(buildQuickAddActionEntity(value));
      if (projectId) {
        await linkEntities({
          source_entity_id: entity.id,
          target_entity_id: projectId,
          relationship: 'belongs_to',
          confidence: 1.0,
          state: 'confirmed',
          source: 'user',
        });
      }
      setValue('');
      onTaskAdded();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="w-5 h-5 rounded-md border-2 border-dashed border-pro-border/40 shrink-0" />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
        }}
        placeholder="Add a task..."
        className="flex-1 bg-transparent text-[13px] font-medium text-pro-text-main placeholder:text-pro-text-muted/30 outline-none"
        disabled={saving}
      />
      {value.trim() && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="text-[10px] font-medium text-pro-accent hover:text-pro-accent/80 transition-colors"
        >
          {saving ? '...' : '↵ Add'}
        </button>
      )}
    </div>
  );
};

// ─── ProjectHealthCard ───────────────────────────────────────────
export const ProjectHealthCard: React.FC<{
  project: Entity;
  tasks: Entity[];
  selected?: boolean;
  onToggleTask: (task: Entity) => void;
  onTaskAdded: () => void;
}> = ({ project, tasks, selected = false, onToggleTask, onTaskAdded }) => {
  const briefing = buildProjectsBriefing(tasks);
  const [expanded, setExpanded] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);
  const health = computeHealth(tasks);
  const healthInfo = HEALTH_CONFIG[health];
  const completedCount = briefing.completed.length;
  const metadata = safeParseMetadata(project.metadata);
  const summary = getProjectCardSummary({
    activeCount: briefing.active.length,
    overdueCount: briefing.overdue.length,
    atRiskCount: countAtRiskTasks(briefing.active),
    completedCount,
  });

  return (
    <section
      className={`overflow-hidden border-b border-pro-border ${
        selected ? 'bg-pro-accent/5 ring-2 ring-pro-accent/35' : ''
      }`}
      data-project-id={project.id}
      data-selected={selected ? 'true' : undefined}
    >
      {/* Project Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="group flex w-full items-center gap-4 px-1 py-5 text-left"
      >
        <div className="w-10 h-10 rounded-md bg-pro-bg border border-pro-border/30 flex items-center justify-center text-lg shrink-0">
          📁
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold text-pro-text-main truncate">
            {project.name}
          </h3>
          {metadata.context && (
            <p className="text-[11px] text-pro-text-muted truncate mt-0.5">
              {metadata.context}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Health badge */}
          <span
            className={`text-[10px] font-medium px-2.5 py-1 rounded-lg ${healthInfo.color} ${healthInfo.bg}`}
          >
            {healthInfo.dot} {healthInfo.label}
          </span>
          <span className="text-[10px] font-bold text-pro-text-muted/60">
            {summary}
          </span>
          {/* Chevron */}
          <svg
            aria-hidden="true"
            className={`w-4 h-4 text-pro-text-muted/40 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>

      {/* Task List */}
      {expanded && (
        <div className="border-t border-pro-border/30 pb-4">
          <div className="flex flex-col gap-1.5 p-3">
            {briefing.active.map((task) => (
              <TaskRow key={task.id} task={task} onToggle={onToggleTask} />
            ))}
            {briefing.active.length === 0 && (
              <p className="text-[11px] text-pro-text-muted/40 italic px-5 py-3">
                No active commitments.
              </p>
            )}
            {completedCount > 0 && (
              <div className="px-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCompleted((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-lg border border-pro-border/50 bg-pro-bg px-3 py-2 text-[11px] font-bold text-pro-text-muted transition-colors hover:border-pro-accent/30 hover:text-pro-text-main"
                >
                  <span>
                    {showCompleted ? 'Hide' : 'Show'} {completedCount} completed
                    task{completedCount === 1 ? '' : 's'}
                  </span>
                  <svg
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${showCompleted ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
              </div>
            )}
            {showCompleted &&
              briefing.completed.map((task) => (
                <TaskRow key={task.id} task={task} onToggle={onToggleTask} />
              ))}
          </div>
          <div className="border-t border-pro-border/20">
            <QuickAddTask projectId={project.id} onTaskAdded={onTaskAdded} />
          </div>
        </div>
      )}
    </section>
  );
};

// Keep the public route and legacy task helpers stable while the overview owns project scope.
export const ProjectsExecutionTab = ProjectsOverview;
