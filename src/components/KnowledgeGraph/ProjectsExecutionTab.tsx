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

// ─── Health Logic ────────────────────────────────────────────────
type HealthStatus = 'on_track' | 'at_risk' | 'slipping';

const HEALTH_CONFIG: Record<
  HealthStatus,
  { dot: string; label: string; color: string; bg: string }
> = {
  on_track: {
    dot: '🟢',
    label: 'On Track',
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
  },
  at_risk: {
    dot: '🟡',
    label: 'At Risk',
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
  },
  slipping: {
    dot: '🔴',
    label: 'Slipping',
    color: 'text-red-500',
    bg: 'bg-red-500/10',
  },
};

const computeHealth = (tasks: Entity[]): HealthStatus => {
  const now = Date.now();
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  const activeTasks = tasks.filter((t) => t.status === 'active');

  const hasOverdue = activeTasks.some(
    (t) => t.due_date && new Date(t.due_date).getTime() < now,
  );
  if (hasOverdue) return 'slipping';

  const hasAtRisk = activeTasks.some(
    (t) =>
      t.due_date &&
      new Date(t.due_date).getTime() - now < twoDaysMs &&
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
  const metadata = JSON.parse(task.metadata || '{}');
  const isCompleted = task.status === 'completed';
  const isOverdue =
    task.due_date &&
    task.status === 'active' &&
    new Date(task.due_date).getTime() < Date.now();

  return (
    <div
      className={`group flex items-center gap-4 px-5 py-3.5 rounded-xl border transition-all duration-200 ${
        isCompleted
          ? 'bg-pro-bg/30 border-pro-border/30 opacity-50'
          : 'bg-pro-surface border-pro-border hover:border-pro-accent/20 hover:shadow-sm'
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
          className={`text-[13px] font-bold tracking-tight leading-snug truncate ${
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
        <span className="text-[10px] font-bold text-pro-accent bg-pro-accent/10 px-2 py-1 rounded-md shrink-0">
          {metadata.assignee_name}
        </span>
      )}

      {/* Due date */}
      {task.due_date && (
        <span
          className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md shrink-0 ${
            isOverdue
              ? 'bg-red-500/10 text-red-500'
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
      const entity = await upsertEntity({
        type: 'action_item',
        name: value.trim(),
        status: 'active',
        metadata: { full_description: value.trim() },
      });
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
        className="flex-1 bg-transparent text-[13px] font-bold text-pro-text-main placeholder:text-pro-text-muted/30 outline-none"
        disabled={saving}
      />
      {value.trim() && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="text-[10px] font-black uppercase tracking-widest text-pro-accent hover:text-pro-accent/80 transition-colors"
        >
          {saving ? '...' : '↵ Add'}
        </button>
      )}
    </div>
  );
};

// ─── ProjectHealthCard ───────────────────────────────────────────
const ProjectHealthCard: React.FC<{
  project: Entity;
  tasks: Entity[];
  onToggleTask: (task: Entity) => void;
  onTaskAdded: () => void;
}> = ({ project, tasks, onToggleTask, onTaskAdded }) => {
  const [expanded, setExpanded] = useState(true);
  const health = computeHealth(tasks);
  const healthInfo = HEALTH_CONFIG[health];
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const metadata = JSON.parse(project.metadata || '{}');

  return (
    <div className="rounded-2xl border border-pro-border bg-pro-surface/50 overflow-hidden transition-all hover:shadow-md">
      {/* Project Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 p-5 text-left group"
      >
        <div className="w-10 h-10 rounded-xl bg-pro-bg border border-pro-border/30 flex items-center justify-center text-lg shrink-0">
          📁
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-black text-pro-text-main tracking-tight truncate">
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
            className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg ${healthInfo.color} ${healthInfo.bg}`}
          >
            {healthInfo.dot} {healthInfo.label}
          </span>
          {/* Completion ratio */}
          <span className="text-[10px] font-bold text-pro-text-muted/60">
            {completedCount}/{tasks.length}
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
        <div className="border-t border-pro-border/30">
          <div className="flex flex-col gap-1.5 p-3">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} onToggle={onToggleTask} />
            ))}
            {tasks.length === 0 && (
              <p className="text-[11px] text-pro-text-muted/40 italic px-5 py-3">
                No tasks yet. Add one below.
              </p>
            )}
          </div>
          <div className="border-t border-pro-border/20">
            <QuickAddTask projectId={project.id} onTaskAdded={onTaskAdded} />
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main: ProjectsExecutionTab ──────────────────────────────────
export const ProjectsExecutionTab: React.FC = () => {
  const [projects, setProjects] = useState<Entity[]>([]);
  const [allTasks, setAllTasks] = useState<Entity[]>([]);
  const [taskLinks, setTaskLinks] = useState<EntityLink[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [projectData, taskData] = await Promise.all([
        getEntitiesByType('project'),
        getEntitiesByType('action_item'),
      ]);
      setProjects(projectData);

      // Sort: active first, then by date
      const sorted = [...taskData].sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (a.status !== 'active' && b.status === 'active') return 1;
        return (
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      });
      setAllTasks(sorted);

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
    const newStatus = task.status === 'active' ? 'completed' : 'active';
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
          (link.source_entity_id === task.id &&
            projectIds.has(link.target_entity_id)) ||
          (link.target_entity_id === task.id &&
            projectIds.has(link.source_entity_id)),
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

  // Stats
  const activeTasks = allTasks.filter((t) => t.status === 'active');
  const overdueTasks = activeTasks.filter(
    (t) => t.due_date && new Date(t.due_date).getTime() < Date.now(),
  );

  if (loading && allTasks.length === 0) {
    return (
      <div className="animate-pulse space-y-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-40 bg-pro-surface rounded-2xl border border-pro-border/30"
          />
        ))}
      </div>
    );
  }

  if (projects.length === 0 && allTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
        <div className="w-20 h-20 rounded-2xl bg-pro-surface border border-pro-border flex items-center justify-center text-4xl shadow-premium">
          📁
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-black text-pro-text-main tracking-tight">
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
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] mb-1">
            Execution Board
          </h2>
          <p className="text-sm font-medium text-pro-text-muted">
            Tracking{' '}
            <span className="text-pro-text-main font-bold">
              {activeTasks.length} active
            </span>{' '}
            across {projects.length} project
            {projects.length !== 1 ? 's' : ''}
            {overdueTasks.length > 0 && (
              <span className="text-red-500 font-bold ml-2">
                · {overdueTasks.length} overdue
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Project Groups */}
      <div className="flex flex-col gap-5">
        {projects.map((project) => (
          <ProjectHealthCard
            key={project.id}
            project={project}
            tasks={groupedTasks[project.id] || []}
            onToggleTask={toggleTask}
            onTaskAdded={fetchData}
          />
        ))}
      </div>

      {/* Ungrouped / Inbox Tasks */}
      {ungroupedTasks.length > 0 && (
        <div className="rounded-2xl border border-pro-border bg-pro-surface/30 overflow-hidden">
          <div className="flex items-center gap-3 p-5 border-b border-pro-border/30">
            <div className="w-10 h-10 rounded-xl bg-pro-bg border border-pro-border/30 flex items-center justify-center text-lg shrink-0">
              📥
            </div>
            <div>
              <h3 className="text-[15px] font-black text-pro-text-main tracking-tight">
                Inbox
              </h3>
              <p className="text-[11px] text-pro-text-muted">
                Tasks not yet assigned to a project
              </p>
            </div>
            <span className="text-[10px] font-bold text-pro-text-muted/60 ml-auto">
              {ungroupedTasks.length} item
              {ungroupedTasks.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 p-3">
            {ungroupedTasks.map((task) => (
              <TaskRow key={task.id} task={task} onToggle={toggleTask} />
            ))}
          </div>
          <div className="border-t border-pro-border/20">
            <QuickAddTask onTaskAdded={fetchData} />
          </div>
        </div>
      )}

      {/* Quick-add at footer if no ungrouped section */}
      {ungroupedTasks.length === 0 && (
        <div className="rounded-2xl border border-dashed border-pro-border/40 bg-pro-bg/30">
          <QuickAddTask onTaskAdded={fetchData} />
        </div>
      )}
    </div>
  );
};
