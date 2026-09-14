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
  const taskList = (items: Entity[]) => (
    <ul className="space-y-3">
      {items.map((task) => (
        <li key={task.id}>
          <label className="flex items-start gap-3 text-sm leading-relaxed">
            <input
              type="checkbox"
              checked={task.status === 'completed'}
              disabled={busy}
              onChange={() => void toggle(task)}
              className="mt-1 accent-pro-accent"
            />
            <span
              className={
                task.status === 'completed'
                  ? 'text-pro-text-muted line-through'
                  : 'text-pro-text-main'
              }
            >
              {task.name}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
  const activeTasks =
    tasks?.filter((task) => task.status !== 'completed') ?? [];
  const completed = tasks?.filter((task) => task.status === 'completed') ?? [];
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mt-10 text-pro-text-muted"
    >
      <summary className="cursor-pointer rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40">
        {projectId ? 'Open commitments' : 'Unassigned tasks'}
      </summary>
      {open && (
        <div className="mt-5 space-y-5">
          {loading && <output className="block text-sm">Loading tasks…</output>}
          {loadError && (
            <div role="alert" className="flex items-center gap-3 text-sm">
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
                <p className="text-sm">
                  {projectId
                    ? 'No open tasks for this project.'
                    : 'No open unassigned tasks.'}
                </p>
              )}
              {completed.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm">
                    Completed tasks ({completed.length})
                  </summary>
                  <div className="mt-4">{taskList(completed)}</div>
                </details>
              )}
            </>
          )}
          {mutationError && (
            <p role="alert" className="text-sm">
              {mutationError}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
            className="flex items-center gap-3"
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
              className="min-w-0 flex-1 rounded border border-pro-border/40 bg-transparent px-3 py-2 text-sm text-pro-text-main outline-none focus:border-pro-accent/60 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className={buttonClass}
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
