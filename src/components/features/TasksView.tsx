import {
  ArrowUpRight,
  Check,
  CheckCheck,
  Circle,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Tag,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listTasks,
  removeTaskTag,
  reviewTask,
  saveTask,
  saveTaskTag,
  setTaskFocus,
  setTaskStatus,
  subscribeTasksChanged,
} from '../../api/tasks';
import type { PersonalTask, TaskTag, TasksSnapshot } from '../../types/tasks';
import { SearchSelect } from '../ui/SearchSelect';
import { getDashboardDateKey } from './dashboardModel';
import './tasks.css';

const empty: TasksSnapshot = { tasks: [], tags: [], projects: [] };
type View = 'open' | 'focus' | 'completed' | 'review';
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        '',
      )
    : 'Could not save the change. Try again.';

export const filterTasks = (
  snapshot: TasksSnapshot,
  filter: {
    view: View;
    search: string;
    project: string;
    tags: string[];
    due: string;
  },
  today = getDashboardDateKey(),
) =>
  snapshot.tasks
    .filter((task) => {
      const completed = task.entity.status === 'completed';
      if (filter.view === 'review' ? !task.needsReview : task.needsReview)
        return false;
      if (filter.view === 'completed' ? !completed : completed) return false;
      if (filter.view === 'focus' && !task.focused) return false;
      if (
        filter.project &&
        (filter.project === 'none'
          ? task.projectId !== null
          : task.projectId !== filter.project)
      )
        return false;
      if (!filter.tags.every((tag) => task.tagIds.includes(tag))) return false;
      const due = task.entity.due_date?.slice(0, 10);
      if (filter.due === 'overdue' && (!due || due >= today)) return false;
      if (filter.due === 'today' && due !== today) return false;
      if (filter.due === 'undated' && due) return false;
      const text = [
        task.entity.name,
        task.description,
        task.sourceMeetingTitle,
        snapshot.projects.find((project) => project.id === task.projectId)
          ?.name,
        ...snapshot.tags
          .filter((tag) => task.tagIds.includes(tag.id))
          .map((tag) => tag.name),
      ]
        .join(' ')
        .toLocaleLowerCase();
      return text.includes(filter.search.trim().toLocaleLowerCase());
    })
    .sort((a, b) =>
      filter.view === 'completed'
        ? b.entity.updated_at.localeCompare(a.entity.updated_at)
        : Number(b.focused) - Number(a.focused) ||
          (a.entity.due_date || '9999').localeCompare(
            b.entity.due_date || '9999',
          ) ||
          b.entity.created_at.localeCompare(a.entity.created_at) ||
          a.entity.id.localeCompare(b.entity.id),
    );

export function TasksView({
  initialTaskId,
  onOpenMeeting,
}: { initialTaskId?: string | null; onOpenMeeting: (id: string) => void }) {
  const [snapshot, setSnapshot] = useState<TasksSnapshot>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>('open');
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [manageTags, setManageTags] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialTaskId ?? null,
  );
  const [newTitle, setNewTitle] = useState('');
  const newTaskRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const mutationInFlight = useRef(false);
  const refresh = useCallback(async () => {
    const next = await listTasks();
    if (mounted.current) {
      setSnapshot(next);
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const reload = () => {
      void refresh().catch((error) => {
        if (mounted.current) {
          setError(errorText(error));
          setLoading(false);
        }
      });
    };
    reload();
    const unsubscribe = subscribeTasksChanged(reload);
    const timeout = window.setInterval(reload, 60_000);
    return () => {
      mounted.current = false;
      unsubscribe();
      window.clearInterval(timeout);
    };
  }, [refresh]);
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (mutationInFlight.current) return false;
    mutationInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (error) {
      setError(errorText(error));
      return false;
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  };
  const selected = snapshot.tasks.find((task) => task.entity.id === selectedId);
  const counts = {
    open: snapshot.tasks.filter(
      (task) => !task.needsReview && task.entity.status !== 'completed',
    ).length,
    focus: snapshot.tasks.filter((task) => !task.needsReview && task.focused)
      .length,
    completed: snapshot.tasks.filter(
      (task) => !task.needsReview && task.entity.status === 'completed',
    ).length,
    review: snapshot.tasks.filter((task) => task.needsReview).length,
  };
  const visible = filterTasks(snapshot, { view, search, project, tags, due });
  const filtered = Boolean(search || project || tags.length || due);
  return (
    <section
      className="tasks-workspace mx-auto w-full max-w-[1180px] pb-16"
      aria-labelledby="tasks-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            id="tasks-title"
            className="text-[30px] font-serif font-medium leading-tight text-pro-text-main"
          >
            Tasks
          </h1>
          <p className="mt-2 text-[13px] text-pro-text-muted">
            Your work, from conversations and everywhere else.
          </p>
        </div>
        <button
          className="task-button task-button-primary"
          type="button"
          onClick={() => newTaskRef.current?.focus()}
        >
          <Plus size={16} aria-hidden="true" />
          Add task
        </button>
      </header>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-b border-pro-border">
        <nav aria-label="Task views" className="flex flex-wrap gap-5">
          {(['open', 'focus', 'completed', 'review'] as const)
            .filter(
              (value) =>
                value !== 'review' || counts.review > 0 || view === 'review',
            )
            .map((value) => (
              <button
                key={value}
                type="button"
                aria-current={view === value ? 'page' : undefined}
                className={`task-view ${view === value ? 'is-active' : ''}`}
                onClick={() => setView(value)}
              >
                {value === 'open'
                  ? 'All tasks'
                  : value === 'focus'
                    ? 'Focus'
                    : value === 'completed'
                      ? 'Completed'
                      : 'Needs review'}
                <span className="ml-2 tabular-nums text-[11px]">
                  {counts[value]}
                </span>
              </button>
            ))}
        </nav>
        <button
          type="button"
          className="task-button !px-2"
          aria-expanded={manageTags}
          onClick={() => setManageTags(!manageTags)}
        >
          <Tag size={14} aria-hidden="true" />
          Manage tags
        </button>
      </div>
      {manageTags && (
        <TagManager
          tags={snapshot.tags}
          busy={busy}
          run={run}
          onClose={() => setManageTags(false)}
        />
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="flex min-w-[160px] flex-1 items-center gap-2 text-pro-text-muted">
          <Search size={15} aria-hidden="true" />
          <input
            aria-label="Search tasks"
            className="task-search"
            placeholder="Search tasks"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          className="task-button"
          type="button"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          Filters
          {project || tags.length || due ? (
            <span className="tabular-nums">
              · {Number(Boolean(project)) + tags.length + Number(Boolean(due))}
            </span>
          ) : null}
        </button>
      </div>
      {filtersOpen && (
        <div className="mt-3 flex flex-wrap items-start gap-4 rounded-lg bg-pro-surface p-4">
          <div className="task-field min-w-[160px]">
            <span>Project</span>
            <SearchSelect
              ariaLabel="Filter by project"
              value={project}
              onValueChange={setProject}
              searchPlaceholder="Search projects…"
              options={[
                { value: '', label: 'All projects' },
                { value: 'none', label: 'No project' },
                ...snapshot.projects.map(({ id, name }) => ({
                  value: id,
                  label: name,
                })),
              ]}
            />
          </div>
          <div className="task-field min-w-[160px]">
            <span>Due date</span>
            <SearchSelect
              ariaLabel="Filter by due date"
              value={due}
              onValueChange={setDue}
              searchable={false}
              options={[
                { value: '', label: 'Any date' },
                { value: 'overdue', label: 'Overdue' },
                { value: 'today', label: 'Due today' },
                { value: 'undated', label: 'No date' },
              ]}
            />
          </div>
          <fieldset className="min-w-0 flex-1">
            <legend className="mb-2 text-[12px] text-pro-text-muted">
              Tags · matches all selected
            </legend>
            <div className="flex flex-wrap gap-2">
              {snapshot.tags.length ? (
                snapshot.tags.map((tag) => (
                  <button
                    type="button"
                    key={tag.id}
                    className="task-tag"
                    aria-pressed={tags.includes(tag.id)}
                    onClick={() =>
                      setTags(
                        tags.includes(tag.id)
                          ? tags.filter((id) => id !== tag.id)
                          : [...tags, tag.id],
                      )
                    }
                  >
                    {tags.includes(tag.id) && (
                      <Check size={12} aria-hidden="true" />
                    )}
                    {tag.name}
                  </button>
                ))
              ) : (
                <span className="text-[12px] text-pro-text-muted">
                  Create tags in task details.
                </span>
              )}
            </div>
          </fieldset>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-pro-border p-3 text-[13px] text-pro-text-main"
        >
          <span>{error}</span>
          <button
            type="button"
            className="task-button"
            disabled={busy}
            onClick={() => void run(refresh)}
          >
            Retry refresh
          </button>
        </div>
      )}
      <div
        className={`mt-4 grid min-w-0 gap-8 ${selected ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}
      >
        <div className="min-w-0">
          <form
            className="flex items-center gap-3 border-y border-pro-border py-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const id = await saveTask({ title: newTitle });
                setNewTitle('');
                setView('open');
                setSelectedId(id);
              });
            }}
          >
            <Plus
              size={17}
              className="shrink-0 text-pro-text-muted"
              aria-hidden="true"
            />
            <input
              ref={newTaskRef}
              className="task-search"
              aria-label="New task"
              placeholder="Add a task…"
              maxLength={1000}
              value={newTitle}
              disabled={busy || loading}
              onChange={(event) => setNewTitle(event.target.value)}
            />
            {newTitle.trim() && (
              <button
                type="submit"
                className="task-button task-button-primary"
                disabled={busy || loading}
              >
                Add
              </button>
            )}
          </form>
          {view === 'focus' && (
            <p className="mt-4 text-[12px] text-pro-text-muted">
              Choose up to five tasks for today. Due dates stay separate.
            </p>
          )}
          {view === 'review' && (
            <p className="mt-4 text-[12px] text-pro-text-muted">
              These may be yours. Check the source, then take on or dismiss each
              suggestion.
            </p>
          )}
          {loading ? (
            <div
              role="status"
              className="flex items-center gap-2 py-12 text-[13px] text-pro-text-muted"
            >
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              Loading tasks…
            </div>
          ) : visible.length ? (
            <ul
              aria-label="Tasks"
              className="mt-1 divide-y divide-pro-border/60"
            >
              {visible.map((task) => (
                <li
                  key={task.entity.id}
                  className={`task-row ${selectedId === task.entity.id ? 'is-selected' : ''}`}
                >
                  {task.needsReview ? (
                    <Circle
                      size={17}
                      className="mt-1 shrink-0 text-pro-text-muted"
                      aria-hidden="true"
                    />
                  ) : (
                    <button
                      type="button"
                      className="task-check"
                      aria-label={`${task.entity.status === 'completed' ? 'Reopen' : 'Complete'} ${task.entity.name}`}
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          setTaskStatus(
                            task.entity.id,
                            task.entity.status === 'completed'
                              ? 'active'
                              : 'completed',
                          ),
                        )
                      }
                    >
                      {task.entity.status === 'completed' ? (
                        <CheckCheck size={17} aria-hidden="true" />
                      ) : (
                        <Circle size={17} aria-hidden="true" />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    aria-expanded={selectedId === task.entity.id}
                    onClick={() => setSelectedId(task.entity.id)}
                  >
                    <span
                      className={`block break-words text-[14px] font-medium leading-6 ${task.entity.status === 'completed' ? 'text-pro-text-muted line-through' : 'text-pro-text-main'}`}
                    >
                      {task.entity.name}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-pro-text-muted">
                      {task.projectId && (
                        <span>
                          {snapshot.projects.find(
                            (project) => project.id === task.projectId,
                          )?.name || 'Project'}
                        </span>
                      )}
                      {task.tagIds
                        .map((id) => snapshot.tags.find((tag) => tag.id === id))
                        .filter((tag): tag is TaskTag => Boolean(tag))
                        .map((tag) => (
                          <span className="task-row-tag" key={tag.id}>
                            {tag.name}
                          </span>
                        ))}
                      {task.sourceMeetingTitle && (
                        <span className="max-w-[220px] truncate">
                          {task.sourceMeetingTitle}
                        </span>
                      )}
                    </span>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {task.entity.due_date && (
                      <span
                        className={`text-[11px] tabular-nums ${task.entity.status !== 'completed' && task.entity.due_date.slice(0, 10) < getDashboardDateKey() ? 'font-medium text-pro-text-main' : 'text-pro-text-muted'}`}
                      >
                        {task.entity.due_date.slice(0, 10) <
                          getDashboardDateKey() &&
                        task.entity.status !== 'completed'
                          ? 'Overdue · '
                          : ''}
                        {task.entity.due_date.slice(0, 10)}
                      </span>
                    )}
                    {!task.needsReview &&
                      task.entity.status !== 'completed' && (
                        <button
                          type="button"
                          className="task-focus"
                          aria-label={`${task.focused ? 'Remove' : 'Add'} ${task.entity.name} ${task.focused ? 'from' : 'to'} Focus`}
                          aria-pressed={task.focused}
                          title={
                            task.focused ? 'Remove from Focus' : 'Add to Focus'
                          }
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              setTaskFocus(task.entity.id, !task.focused),
                            )
                          }
                        >
                          <Star
                            size={15}
                            fill={task.focused ? 'currentColor' : 'none'}
                            aria-hidden="true"
                          />
                        </button>
                      )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-14 text-center">
              <p className="text-[16px] font-medium text-pro-text-main">
                {filtered
                  ? 'No tasks match'
                  : view === 'focus'
                    ? 'A little room to focus'
                    : view === 'completed'
                      ? 'Completed tasks will live here'
                      : view === 'review'
                        ? 'You’re all caught up'
                        : 'Make room for what’s next'}
              </p>
              <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-pro-text-muted">
                {filtered
                  ? 'Try another search or clear your filters.'
                  : view === 'focus'
                    ? 'Use the star beside any open task to choose it for today.'
                    : view === 'completed'
                      ? 'Check off a task when it’s done. You can reopen it here.'
                      : view === 'review'
                        ? 'There are no suggestions waiting for review.'
                        : 'Add a task above. Commitments from your meetings will appear here too.'}
              </p>
              {filtered && (
                <button
                  type="button"
                  className="task-button mx-auto mt-4"
                  onClick={() => {
                    setSearch('');
                    setProject('');
                    setTags([]);
                    setDue('');
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
        {selected && (
          <TaskDetails
            key={selected.entity.id}
            task={selected}
            snapshot={snapshot}
            busy={busy}
            run={run}
            onClose={() => setSelectedId(null)}
            onOpenMeeting={onOpenMeeting}
          />
        )}
      </div>
    </section>
  );
}

function TaskDetails({
  task,
  snapshot,
  busy,
  run,
  onClose,
  onOpenMeeting,
}: {
  task: PersonalTask;
  snapshot: TasksSnapshot;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  onClose: () => void;
  onOpenMeeting: (id: string) => void;
}) {
  const [title, setTitle] = useState(task.entity.name);
  const [date, setDate] = useState(task.entity.due_date?.slice(0, 10) ?? '');
  const [projectId, setProjectId] = useState(task.projectId ?? '');
  const [tagIds, setTagIds] = useState(task.tagIds);
  const [description, setDescription] = useState(task.description);
  const [tagName, setTagName] = useState('');
  const [revision, setRevision] = useState(task.revision);
  useEffect(() => {
    if (
      title === task.entity.name &&
      date === (task.entity.due_date?.slice(0, 10) ?? '') &&
      projectId === (task.projectId ?? '') &&
      description === task.description &&
      JSON.stringify([...tagIds].sort()) ===
        JSON.stringify([...task.tagIds].sort())
    )
      setRevision(task.revision);
  }, [task, title, date, projectId, description, tagIds]);
  const matchingTags = snapshot.tags
    .filter(
      (tag) =>
        tagIds.includes(tag.id) ||
        (tagName.trim() &&
          tag.name
            .toLocaleLowerCase()
            .includes(tagName.trim().toLocaleLowerCase())),
    )
    .slice(0, 20);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <aside
      className="task-details self-start rounded-xl bg-pro-surface p-5 xl:sticky xl:top-4"
      aria-labelledby="task-details-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="mb-5 flex items-center justify-between">
        <h2
          id="task-details-title"
          ref={headingRef}
          tabIndex={-1}
          className="text-[15px] font-semibold text-pro-text-main"
        >
          Task details
        </h2>
        <button
          type="button"
          className="task-button !p-1.5"
          aria-label="Close task details"
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {task.needsReview ? (
        <div className="space-y-4">
          <p className="text-[14px] leading-6 text-pro-text-main">
            {task.entity.name}
          </p>
          <p className="text-[12px] leading-5 text-pro-text-muted">
            Taking this on confirms that you’re responsible for it.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="task-button task-button-primary"
              disabled={busy}
              onClick={() =>
                void run(() => reviewTask(task.entity.id, 'confirmed'))
              }
            >
              Take on task
            </button>
            <button
              type="button"
              className="task-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await reviewTask(task.entity.id, 'rejected');
                  onClose();
                })
              }
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              saveTask({
                id: task.entity.id,
                expectedRevision: revision,
                title,
                dueDate:
                  date === (task.entity.due_date?.slice(0, 10) ?? '')
                    ? undefined
                    : date || null,
                projectId: projectId || null,
                tagIds,
                description,
              }),
            );
          }}
        >
          <label className="task-field">
            Task
            <textarea
              required
              maxLength={1000}
              rows={3}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="task-field">
            <span>Project</span>
            <SearchSelect
              ariaLabel="Task project"
              value={projectId}
              onValueChange={setProjectId}
              disabled={busy}
              searchPlaceholder="Search projects…"
              options={[
                { value: '', label: 'No project' },
                ...snapshot.projects.map(({ id, name }) => ({
                  value: id,
                  label: name,
                })),
              ]}
            />
          </div>
          <label className="task-field">
            Due date
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <fieldset>
            <legend className="mb-2 text-[12px] font-medium text-pro-text-muted">
              Tags
            </legend>
            <div className="mb-2 flex flex-wrap gap-2">
              {matchingTags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="task-tag"
                  aria-pressed={tagIds.includes(tag.id)}
                  onClick={() =>
                    setTagIds(
                      tagIds.includes(tag.id)
                        ? tagIds.filter((id) => id !== tag.id)
                        : [...tagIds, tag.id],
                    )
                  }
                >
                  {tagIds.includes(tag.id) && (
                    <Check size={12} aria-hidden="true" />
                  )}
                  {tag.name}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                aria-label="Find or create tag"
                className="task-input min-w-0 flex-1"
                placeholder="Find or create a tag"
                maxLength={60}
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
              />
              <button
                type="button"
                aria-label="Add tag"
                className="task-button !px-2"
                disabled={busy || !tagName.trim()}
                onClick={() =>
                  void run(async () => {
                    const tag = await saveTaskTag({ name: tagName });
                    setTagIds((ids) => [...new Set([...ids, tag.id])]);
                    setTagName('');
                  })
                }
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
          </fieldset>
          <label className="task-field">
            Description
            <textarea
              rows={3}
              maxLength={10000}
              placeholder="A little context, if useful"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="task-button task-button-primary"
            disabled={busy || !title.trim()}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      )}
      {task.sourceMeetingId && (
        <div className="mt-6 border-t border-pro-border pt-4">
          <p className="mb-2 text-[11px] text-pro-text-muted">
            From your meeting
          </p>
          <button
            type="button"
            className="flex w-full items-start gap-2 text-left text-[12px] leading-5 text-pro-text-main hover:underline"
            onClick={() => onOpenMeeting(task.sourceMeetingId!)}
          >
            <span className="min-w-0 flex-1 break-words">
              {task.sourceMeetingTitle || 'Open source meeting'}
            </span>
            <ArrowUpRight
              size={14}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
          </button>
        </div>
      )}
    </aside>
  );
}

function TagManager({
  tags,
  busy,
  run,
  onClose,
}: {
  tags: TaskTag[];
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  return (
    <section
      aria-label="Manage task tags"
      className="mt-4 rounded-lg border border-pro-border p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-medium text-pro-text-main">
            Manage tags
          </h2>
          <p className="mt-1 text-[12px] text-pro-text-muted">
            Renaming or merging updates every task. Removing a tag keeps its
            tasks.
          </p>
        </div>
        <button
          type="button"
          className="task-button !p-2"
          aria-label="Close tag manager"
          onClick={onClose}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      {tags.length ? (
        <div className="space-y-3">
          {tags.map((tag) => (
            <TagManagerRow
              key={`${tag.id}:${tag.name}`}
              tag={tag}
              tags={tags}
              busy={busy}
              run={run}
            />
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-pro-text-muted">
          No tags yet. Add one in task details.
        </p>
      )}
    </section>
  );
}
function TagManagerRow({
  tag,
  tags,
  busy,
  run,
}: {
  tag: TaskTag;
  tags: TaskTag[];
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [name, setName] = useState(tag.name);
  const [mergeInto, setMergeInto] = useState('');
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => saveTaskTag({ id: tag.id, name }));
      }}
    >
      <input
        className="task-input min-w-0 flex-1"
        aria-label={`Rename ${tag.name}`}
        maxLength={60}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button
        type="submit"
        className="task-button"
        disabled={busy || !name.trim() || name === tag.name}
      >
        Rename
      </button>
      <SearchSelect
        className="w-[160px] max-w-full"
        ariaLabel={`Merge ${tag.name} into`}
        value={mergeInto}
        onValueChange={setMergeInto}
        disabled={busy}
        searchPlaceholder="Search tags…"
        options={[
          { value: '', label: 'Merge into…' },
          ...tags
            .filter((value) => value.id !== tag.id)
            .map(({ id, name }) => ({ value: id, label: name })),
        ]}
      />
      <button
        className="task-button"
        type="button"
        disabled={busy || !mergeInto}
        onClick={() => void run(() => removeTaskTag(tag.id, mergeInto))}
      >
        Merge
      </button>
      <button
        className="task-button"
        type="button"
        disabled={busy}
        onClick={() => void run(() => removeTaskTag(tag.id))}
      >
        Remove
      </button>
    </form>
  );
}
