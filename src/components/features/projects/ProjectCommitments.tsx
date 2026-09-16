import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type Entity,
  getEntitiesByType,
  getEntityLinks,
  linkEntities,
  updateEntityStatus,
  upsertEntity,
} from '../../../api/knowledgeGraph';
import { getCommitmentState } from '../../../utils/actionCommitment';

const buttonClass =
  'rounded text-sm text-pro-text-muted hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40 disabled:opacity-50';

const Commitments = ({
  projectId,
  defaultOpen = false,
}: {
  projectId?: string;
  defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const [tasks, setTasks] = useState<Entity[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setLoadError(false);
    const load = async () => {
      const [actions, projects] = await Promise.all([
        getEntitiesByType('action_item'),
        getEntitiesByType('project'),
      ]);
      const projectIds = new Set(projects.map((project) => project.id));
      const membership = await Promise.all(
        actions.map(async (action) => {
          const links = await getEntityLinks(action.id);
          const assigned = links.filter(
            (link) =>
              link.relationship === 'belongs_to' &&
              link.state === 'confirmed' &&
              link.source_entity_id === action.id &&
              projectIds.has(link.target_entity_id),
          );
          return {
            action,
            include: projectId
              ? assigned.some((link) => link.target_entity_id === projectId)
              : assigned.length === 0,
          };
        }),
      );
      if (active)
        setTasks(
          membership
            .filter(
              (item) =>
                item.include &&
                getCommitmentState(item.action.metadata) !== 'rejected',
            )
            .map((item) => item.action),
        );
    };
    load()
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, projectId, refresh]);
  const toggle = async (task: Entity) => {
    setBusy(true);
    setMutationError('');
    const status = task.status === 'completed' ? 'active' : 'completed';
    try {
      await updateEntityStatus(task.id, status);
      setTasks(
        (current) =>
          current?.map((item) =>
            item.id === task.id ? { ...item, status } : item,
          ) ?? null,
      );
    } catch {
      setMutationError('We couldn’t update this task. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true);
    setMutationError('');
    let saved = false;
    try {
      const entity = await upsertEntity({
        type: 'action_item',
        name,
        status: 'active',
        dedupe_by_name: false,
        metadata: {
          full_description: name,
          commitment_state: 'confirmed',
          origin: 'user',
        },
      });
      saved = true;
      setDraft('');
      if (projectId)
        await linkEntities({
          source_entity_id: entity.id,
          target_entity_id: projectId,
          relationship: 'belongs_to',
          confidence: 1,
          state: 'confirmed',
          source: 'user',
        });
      setRefresh((value) => value + 1);
    } catch {
      setMutationError(
        saved
          ? 'Task saved in Unassigned tasks, but we couldn’t link it to this project.'
          : 'We couldn’t add this task. Your text is still here.',
      );
    } finally {
      setBusy(false);
    }
  };
  const formatTaskChronology = (task: Entity, now = Date.now()) => {
    let dueDate: string | null = task.due_date ?? null;
    if (!dueDate && task.metadata) {
      try {
        const parsed = JSON.parse(task.metadata);
        if (typeof parsed?.due_date === 'string') dueDate = parsed.due_date;
        else if (typeof parsed?.dueDate === 'string') dueDate = parsed.dueDate;
      } catch {
        // ignore
      }
    }

    if (task.status === 'completed') {
      const time = Date.parse(task.updated_at || task.created_at);
      if (!Number.isNaN(time)) {
        const diffDays = Math.max(
          0,
          Math.floor((now - time) / (1000 * 60 * 60 * 24)),
        );
        if (diffDays <= 1) return { label: 'Completed recently', isOverdue: false };
        if (diffDays < 7)
          return { label: `Completed ${diffDays}d ago`, isOverdue: false };
        const weeks = Math.round(diffDays / 7);
        return { label: `Completed ${weeks}w ago`, isOverdue: false };
      }
      return { label: 'Completed', isOverdue: false };
    }

    if (dueDate) {
      const dueTime = Date.parse(dueDate);
      if (!Number.isNaN(dueTime)) {
        const diffDays = Math.floor((now - dueTime) / (1000 * 60 * 60 * 24));
        const formatted = new Intl.DateTimeFormat(undefined, {
          month: 'short',
          day: 'numeric',
        }).format(new Date(dueTime));
        if (diffDays > 0) {
          const weeks = Math.round(diffDays / 7);
          const overdueText =
            weeks > 0 ? `${weeks}w overdue` : `${diffDays}d overdue`;
          return { label: `Due ${formatted} · ${overdueText}`, isOverdue: true };
        }
        return { label: `Due ${formatted}`, isOverdue: false };
      }
    }

    const createdTime = Date.parse(task.created_at);
    if (!Number.isNaN(createdTime)) {
      const diffDays = Math.max(
        0,
        Math.floor((now - createdTime) / (1000 * 60 * 60 * 24)),
      );
      if (diffDays >= 45) {
        const months = Math.max(1, Math.round(diffDays / 30));
        return {
          label: `Lingering loop · Opened ${months}mo ago`,
          isOverdue: false,
        };
      }
      if (diffDays >= 14) {
        const weeks = Math.round(diffDays / 7);
        return { label: `Opened ${weeks}w ago`, isOverdue: false };
      }
    }

    return null;
  };

  const taskList = (items: Entity[]) => (
    <ul className="space-y-2.5">
      {items.map((task) => {
        const timing = formatTaskChronology(task);
        return (
          <li key={task.id}>
            <label className="group/task flex items-start gap-3 text-sm leading-relaxed cursor-pointer">
              <input
                type="checkbox"
                checked={task.status === 'completed'}
                disabled={busy}
                onChange={() => void toggle(task)}
                className="mt-1 h-4 w-4 rounded border-pro-border/70 accent-pro-accent cursor-pointer"
              />
              <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-2">
                <span
                  className={
                    task.status === 'completed'
                      ? 'text-pro-text-muted line-through'
                      : 'text-pro-text-main group-hover/task:text-pro-accent transition-colors'
                  }
                >
                  {task.name}
                </span>
                {timing && (
                  <span
                    className={`text-[11px] tabular-nums ${
                      timing.isOverdue
                        ? 'text-rose-600 dark:text-rose-400 font-medium'
                        : 'text-pro-text-muted/70'
                    }`}
                  >
                    {timing.label}
                  </span>
                )}
              </div>
            </label>
          </li>
        );
      })}
    </ul>
  );
  const activeTasks =
    tasks?.filter((task) => task.status !== 'completed') ?? [];
  const completed = tasks?.filter((task) => task.status === 'completed') ?? [];
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group/details mt-10 border-t border-pro-border/40 pt-5 text-pro-text-muted"
    >
      <summary className="flex cursor-pointer select-none items-center justify-between rounded-lg py-1.5 text-[13px] font-medium text-pro-text-muted hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent [&::-webkit-details-marker]:hidden list-none">
        <div className="flex items-center gap-2">
          <ChevronRight className="h-4 w-4 text-pro-text-muted/70 transition-transform duration-200 group-open/details:rotate-90" />
          <span>{projectId ? 'Open commitments' : 'Unassigned tasks'}</span>
          {activeTasks.length > 0 && (
            <span className="rounded-full border border-pro-border/60 bg-pro-surface px-2 py-0.5 text-[11px] font-medium text-pro-text-muted">
              {activeTasks.length}
            </span>
          )}
        </div>
      </summary>
      {open && (
        <div className="mt-4 rounded-xl border border-pro-border/60 bg-pro-surface/30 p-5 space-y-4 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          {loading && <output className="block text-sm">Loading tasks…</output>}
          {loadError && (
            <div role="alert" className="flex items-center gap-3 text-sm text-pro-urgent">
              <p>We couldn’t load these tasks.</p>
              <button
                type="button"
                onClick={() => setRefresh((value) => value + 1)}
                className={buttonClass}
              >
                Retry
              </button>
            </div>
          )}
          {tasks && (
            <>
              {activeTasks.length ? (
                taskList(activeTasks)
              ) : (
                <p className="text-sm text-pro-text-muted">
                  {projectId
                    ? 'No open tasks for this project.'
                    : 'No open unassigned tasks.'}
                </p>
              )}
              {completed.length > 0 && (
                <details className="mt-4 border-t border-pro-border/40 pt-4">
                  <summary className="cursor-pointer text-xs font-medium text-pro-text-muted hover:text-pro-text-main">
                    Completed tasks ({completed.length})
                  </summary>
                  <div className="mt-3">{taskList(completed)}</div>
                </details>
              )}
            </>
          )}
          {mutationError && (
            <p role="alert" className="text-sm text-pro-urgent">
              {mutationError}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
            className="flex items-center gap-3 pt-2"
          >
            <input
              type="text"
              aria-label={
                projectId ? 'New project task' : 'New unassigned task'
              }
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy}
              placeholder="Add a task"
              className="min-w-0 flex-1 rounded-lg border border-pro-border/60 bg-pro-bg px-3.5 py-2 text-sm text-pro-text-main outline-none transition-colors placeholder:text-pro-text-muted focus:border-pro-accent focus:ring-2 focus:ring-pro-accent/20 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-pro-accent/10 px-3.5 text-xs font-medium text-pro-accent border border-pro-accent/25 transition-colors hover:bg-pro-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Add'}
            </button>
          </form>
        </div>
      )}
    </details>
  );
};

export const ProjectCommitments = ({
  projectId,
  defaultOpen = false,
}: {
  projectId?: string;
  defaultOpen?: boolean;
}) => (
  <Commitments
    key={projectId ?? 'unassigned'}
    projectId={projectId}
    defaultOpen={defaultOpen}
  />
);
