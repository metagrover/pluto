import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type Entity,
  type EntityLink,
  getEntitiesByType,
  getEntityLinks,
  linkEntities,
  updateEntityStatus,
  upsertEntity,
} from '../../api/knowledgeGraph';
import type { ActionCommitmentMetadata } from '../../utils/actionCommitment';
import { ProjectDossier } from '../features/projects/ProjectDossier';
import { PageHeader } from '../ui/PageHeader';

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

// ─── Main: ProjectsExecutionTab ──────────────────────────────────
export const ProjectsExecutionTab: React.FC<{
  selectedProjectId?: string | null;
}> = ({ selectedProjectId = null }) => {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    selectedProjectId,
  );
  const [projects, setProjects] = useState<Entity[]>([]);
  const [allTasks, setAllTasks] = useState<Entity[]>([]);
  const [taskLinks, setTaskLinks] = useState<EntityLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setActiveProjectId(selectedProjectId);
  }, [selectedProjectId]);

  const formatProjectName = (name: string): string => {
    // LLMs often generate noisy identifiers like "foo-work-project".
    // Strip a few common suffixes for display only.
    return name
      .replace(/-work-project$/i, '')
      .replace(/-ui-work-project$/i, '')
      .replace(/[_-]?project$/i, '')
      .trim();
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [projectData, taskData] = await Promise.all([
        getEntitiesByType('project'),
        getEntitiesByType('action_item'),
      ]);
      setProjects(projectData);

      setAllTasks(sortExecutionTasksForDisplay(taskData));

      // Fetch links for all tasks to determine project grouping
      const linkPromises = taskData.map((t) => getEntityLinks(t.id));
      const allLinks = (await Promise.all(linkPromises)).flat();
      setTaskLinks(allLinks);
    } catch (error) {
      console.error('Failed to fetch execution data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleTask = async (task: Entity) => {
    const newStatus = getNextTaskStatusForToggle(task.status);
    try {
      await updateEntityStatus(task.id, newStatus);
      setAllTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: newStatus } : t)),
      );
    } catch (error) {
      console.error('Failed to update task status:', error);
    }
  };

  // Group tasks by project
  const { groupedTasks, ungroupedTasks } = useMemo(() => {
    const projectIds = new Set(projects.map((p) => p.id));
    const grouped: Record<string, Entity[]> = {};
    const ungrouped: Entity[] = [];

    for (const task of allTasks) {
      // Find if this task is linked to a project
      const projectLink = taskLinks.find(
        (link) =>
          link.relationship === 'belongs_to' &&
          ((link.source_entity_id === task.id &&
            projectIds.has(link.target_entity_id)) ||
            (link.target_entity_id === task.id &&
              projectIds.has(link.source_entity_id))),
      );
      if (projectLink) {
        const projectId =
          projectLink.source_entity_id === task.id
            ? projectLink.target_entity_id
            : projectLink.source_entity_id;
        if (!grouped[projectId]) grouped[projectId] = [];
        grouped[projectId].push(task);
      } else {
        ungrouped.push(task);
      }
    }

    return { groupedTasks: grouped, ungroupedTasks: ungrouped };
  }, [allTasks, taskLinks, projects]);

  const { activeProjects } = useMemo(
    () => partitionProjectsForDisplay(projects, groupedTasks),
    [projects, groupedTasks],
  );

  // Stats

  const activeUngroupedTasks = ungroupedTasks.filter(
    (task) => task.status === 'active' || task.status === 'overdue',
  );
  const overdueUngroupedTasks = activeUngroupedTasks.filter((task) =>
    isTaskOverdue(task),
  );
  const completedUngroupedTasks = ungroupedTasks.filter(
    (task) => task.status === 'completed',
  );

  const activeTasks = useMemo(
    () =>
      allTasks.filter((t) => t.status === 'active' || t.status === 'overdue'),
    [allTasks],
  );
  const overdueTasks = useMemo(
    () => activeTasks.filter((t) => isTaskOverdue(t)),
    [activeTasks],
  );
  const executionSummary = useMemo(
    () =>
      buildExecutionSummary({
        activeTaskCount: activeTasks.length,
        activeProjectCount: activeProjects.length,
        activeInboxTaskCount: activeUngroupedTasks.length,
        overdueTaskCount: overdueTasks.length,
      }),
    [
      activeTasks.length,
      activeProjects.length,
      activeUngroupedTasks.length,
      overdueTasks.length,
    ],
  );

  if (activeProjectId) {
    const activeProject = projects.find((p) => p.id === activeProjectId);
    return (
      <ProjectDossier
        projectId={activeProjectId}
        projectName={
          activeProject
            ? formatProjectName(activeProject.name) || activeProject.name
            : undefined
        }
        onBack={() => setActiveProjectId(null)}
      />
    );
  }

  if (loading && allTasks.length === 0 && projects.length === 0) {
    return (
      <div className="animate-pulse space-y-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-40 bg-pro-surface rounded-md border border-pro-border/30"
          />
        ))}
      </div>
    );
  }

  if (projects.length === 0 && allTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
        <div className="w-20 h-20 rounded-md bg-pro-surface border border-pro-border flex items-center justify-center text-4xl shadow-sm">
          📁
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-semibold text-pro-text-main">
            No Projects Yet
          </h3>
          <p className="text-sm text-pro-text-muted max-w-md">
            Record a meeting and action items will automatically flow here.
            Projects and work streams are extracted from your conversations.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8" data-testid="projects-briefing">
      <div>
        <PageHeader title="Projects" className="mb-3" />
        <div className="flex flex-col gap-1 -mt-6">
          <h2 className="text-xl font-semibold text-pro-text-main">
            {executionSummary.heading}
          </h2>
          <p className="text-sm text-pro-text-muted">
            {executionSummary.detail}
          </p>
        </div>
      </div>

      {/* Project Groups */}
      <div className="flex flex-col">
        {projects.map((project) => {
          const projectTasks =
            (project as any).tasks || groupedTasks[project.id] || [];
          const taskCount =
            typeof (project as any).taskCount === 'number'
              ? (project as any).taskCount
              : projectTasks.length;
          const meta = safeParseMetadata(project.metadata);
          const peopleCountFromMeta =
            typeof meta.people_count === 'number'
              ? meta.people_count
              : Array.isArray(meta.people)
                ? meta.people.length
                : 0;
          const assigneesFromTasks = new Set(
            projectTasks
              .map(
                (t: any) =>
                  safeParseMetadata(t.metadata).assignee_name || t.assigned_to,
              )
              .filter(Boolean),
          ).size;
          const peopleCount =
            typeof (project as any).peopleCount === 'number'
              ? (project as any).peopleCount
              : peopleCountFromMeta ||
                assigneesFromTasks ||
                (Array.isArray(meta.assignees) ? meta.assignees.length : 0);
          const health = computeHealth(projectTasks);
          const healthInfo = HEALTH_CONFIG[health];
          const displayName =
            ((project as any).title as string) ||
            formatProjectName(project.name) ||
            project.name;

          return (
            <div
              key={project.id}
              onClick={() => setActiveProjectId(project.id)}
              className="flex items-start justify-between py-6 border-b border-pro-border/30 hover:bg-pro-hover cursor-pointer"
              data-project-id={project.id}
            >
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-pro-text-main">
                  {displayName}
                </h3>
              </div>
              <div className="flex items-center gap-4 text-sm text-pro-text-muted">
                <div>
                  <span className="font-bold">{taskCount}</span> Tasks{' '}
                  <span className="font-bold">{peopleCount}</span> People
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-6">
                <span
                  className={`text-[10px] font-medium px-2.5 py-1 rounded-lg ${healthInfo.color} ${healthInfo.bg}`}
                >
                  {healthInfo.dot} {healthInfo.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {ungroupedTasks.length > 0 && (
        <div className="rounded-xl border border-pro-border bg-pro-surface overflow-hidden">
          <div className="flex items-center gap-3 p-5 border-b border-pro-border/30">
            <div className="w-10 h-10 rounded-md bg-pro-bg border border-pro-border/30 flex items-center justify-center text-lg shrink-0">
              📥
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-pro-text-main">
                Inbox
              </h3>
              <p className="text-[11px] text-pro-text-muted">
                Tasks not yet assigned to a project
              </p>
            </div>
            <span className="text-[10px] font-bold text-pro-text-muted/60 ml-auto">
              {getInboxSummary({
                activeCount: activeUngroupedTasks.length,
                overdueCount: overdueUngroupedTasks.length,
              })}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 p-3">
            {activeUngroupedTasks.slice(0, MAX_INBOX_PREVIEW).map((task) => (
              <TaskRow key={task.id} task={task} onToggle={toggleTask} />
            ))}
            {activeUngroupedTasks.length > MAX_INBOX_PREVIEW && (
              <p className="px-5 py-3 text-xs font-semibold text-pro-text-muted">
                {activeUngroupedTasks.length - MAX_INBOX_PREVIEW} more active
                items in the inbox
              </p>
            )}
            {completedUngroupedTasks.length > 0 && (
              <details className="px-5 py-3 text-xs text-pro-text-muted">
                <summary className="cursor-pointer font-semibold">
                  Browse {completedUngroupedTasks.length} completed items
                </summary>
                <div className="mt-3 flex flex-col gap-1.5">
                  {completedUngroupedTasks.map((task) => (
                    <TaskRow key={task.id} task={task} onToggle={toggleTask} />
                  ))}
                </div>
              </details>
            )}
          </div>
          <div className="border-t border-pro-border/20">
            <QuickAddTask onTaskAdded={fetchData} />
          </div>
        </div>
      )}

      {/* Quick-add at footer if no ungrouped section */}
      {ungroupedTasks.length === 0 && (
        <div className="rounded-xl border border-dashed border-pro-border/40 bg-pro-bg">
          <QuickAddTask onTaskAdded={fetchData} />
        </div>
      )}
    </div>
  );
};
