import {
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Circle,
  Folder,
  Loader2,
  NotebookText,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  deleteTask,
  listTasks,
  removeTaskTag,
  restoreTask,
  reviewTask,
  saveTask,
  saveTaskTag,
  setTaskFocus,
  setTaskStatus,
  subscribeTasksChanged,
} from '../../api/tasks';
import type { PersonalTask, TaskTag, TasksSnapshot } from '../../types/tasks';
import { EmptyCanvas } from '../ui/EmptyCanvas';
import { SearchSelect } from '../ui/SearchSelect';
import { getDashboardDateKey } from './dashboardModel';
import './tasks.css';

const empty: TasksSnapshot = { tasks: [], tags: [], projects: [] };
type View = 'open' | 'focus' | 'completed' | 'review';
const taskTools = [
  { id: 'date', label: 'Due date', Icon: CalendarDays },
  { id: 'project', label: 'Project', Icon: Folder },
  { id: 'tags', label: 'Tags', Icon: Tag },
] as const;
type TaskTool = (typeof taskTools)[number]['id'];
const formatTaskDate = (date: string) =>
  new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const [toast, setToast] = useState<{
    id: string;
    message: string;
    onUndo?: () => unknown;
  } | null>(null);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(
    null,
  );
  const newTaskRef = useRef<HTMLInputElement>(null);
  const needsCaptureFocus = useRef(false);

  useEffect(() => {
    if (!busy && needsCaptureFocus.current) {
      needsCaptureFocus.current = false;
      newTaskRef.current?.focus();
    }
  }, [busy]);
  const mounted = useRef(true);
  const mutationInFlight = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (
      message: string,
      options?: {
        onUndo?: () => unknown;
        duration?: number;
      },
    ) => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ id: String(Date.now()), message, onUndo: options?.onUndo });
      toastTimer.current = setTimeout(() => {
        setToast(null);
        toastTimer.current = null;
      }, options?.duration ?? 4500);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (highlightedTaskId) {
      const timer = setTimeout(() => setHighlightedTaskId(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [highlightedTaskId]);
  const refresh = useCallback(async () => {
    const next = await listTasks();
    if (mounted.current) {
      setSnapshot(next);
      setLoadError(null);
      setLoading(false);
      setTags((selected) =>
        selected.every((id) => next.tags.some((tag) => tag.id === id))
          ? selected
          : selected.filter((id) => next.tags.some((tag) => tag.id === id)),
      );
    }
  }, []);
  const reload = useCallback(() => {
    void refresh().catch((error) => {
      if (mounted.current) {
        setLoadError(errorText(error));
        setLoading(false);
      }
    });
  }, [refresh]);
  useEffect(() => {
    mounted.current = true;
    reload();
    const unsubscribe = subscribeTasksChanged(reload);
    const timeout = window.setInterval(reload, 60_000);
    return () => {
      mounted.current = false;
      unsubscribe();
      window.clearInterval(timeout);
    };
  }, [reload]);
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
  const openTasks = snapshot.tasks.filter(
    (task) => !task.needsReview && task.entity.status !== 'completed',
  );
  const counts = {
    open: openTasks.length,
    focus: openTasks.filter((task) => task.focused).length,
    completed: snapshot.tasks.filter(
      (task) => !task.needsReview && task.entity.status === 'completed',
    ).length,
    review: snapshot.tasks.filter((task) => task.needsReview).length,
  };
  const visible = filterTasks(snapshot, { view, search, project, tags, due });
  // Keep an open editor mounted if its task moves out of the current filter.
  const rows =
    selected && !visible.includes(selected) ? [selected, ...visible] : visible;
  const activeFilters =
    Number(Boolean(project)) + tags.length + Number(Boolean(due));
  const searchActive = Boolean(search.trim());
  const filtered = searchActive || activeFilters > 0;
  const loadFailed = snapshot === empty && Boolean(loadError);
  const activeViewRef = useRef<HTMLButtonElement>(null);
  return (
    <section
      className="tasks-workspace mx-auto w-full max-w-[760px] pb-16"
      aria-labelledby="tasks-title"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <h1
          id="tasks-title"
          className="font-serif text-[34px] font-medium leading-tight text-pro-text-main sm:text-[38px]"
        >
          Tasks
        </h1>
        <div className="flex w-full min-w-0 max-w-[320px] items-center gap-2.5">
          <div className="task-search-bar flex min-w-0 flex-1 items-center gap-2 rounded-md border border-pro-border bg-pro-bg px-2.5 text-pro-text-muted transition-colors focus-within:border-pro-accent focus-within:ring-1 focus-within:ring-pro-accent/40">
            <Search
              size={15}
              className="shrink-0 text-pro-text-muted transition-colors"
              aria-hidden="true"
            />
            <input
              aria-label="Search tasks"
              className="task-search-input"
              placeholder="Search tasks…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center rounded text-pro-text-muted transition-colors hover:text-pro-text-main"
                aria-label="Clear search"
                onClick={() => setSearch('')}
              >
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            className="task-button task-button-outline shrink-0"
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            Filters
            {activeFilters > 0 && (
              <span className="tabular-nums">· {activeFilters}</span>
            )}
          </button>
        </div>
      </header>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-3 border-b border-pro-border">
        <nav aria-label="Task views" className="flex flex-wrap gap-5">
          {(['open', 'focus', 'completed', 'review'] as const)
            .filter(
              (value) =>
                value !== 'review' || counts.review > 0 || view === 'review',
            )
            .map((value) => (
              <button
                key={value}
                ref={view === value ? activeViewRef : undefined}
                type="button"
                aria-current={view === value ? 'page' : undefined}
                className={`task-view ${view === value ? 'is-active' : ''}`}
                onClick={() => setView(value)}
              >
                {value === 'open'
                  ? 'Open'
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
          className="task-button"
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
      {filtersOpen && (
        <div className="mt-3 grid items-start gap-x-4 gap-y-3 rounded-lg bg-pro-surface p-4 sm:grid-cols-2">
          <div className="task-field">
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
          <div className="task-field">
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
          <fieldset className="min-w-0 sm:col-span-2">
            <legend className="mb-2 text-[12px] text-pro-text-muted">
              Tags
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
                  Add a tag to a task to filter by it.
                </span>
              )}
            </div>
          </fieldset>
        </div>
      )}
      {(error || loadError) && (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-pro-border p-3 text-[13px] text-pro-text-main"
        >
          <span className="min-w-0 break-words">
            {error || 'Couldn’t load tasks.'}
          </span>
          {loadError && !error && (
            <button
              type="button"
              className="task-button task-button-outline"
              disabled={busy || loading}
              onClick={() => {
                setLoading(true);
                reload();
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}
      <div className="mt-6 min-w-0">
        <form
          className="task-capture"
          onSubmit={(event) => {
            event.preventDefault();
            const titleToSave = newTitle.trim();
            if (!titleToSave || loadFailed) return;
            void run(async () => {
              needsCaptureFocus.current = true;
              const id = await saveTask({ title: titleToSave });
              setNewTitle('');
              setView('open');
              setHighlightedTaskId(id);
              showToast(`Task created: “${titleToSave}”`);
            });
          }}
        >
          <Plus
            size={17}
            className="task-capture-icon shrink-0"
            aria-hidden="true"
          />
          <input
            ref={newTaskRef}
            className="task-inline-input"
            aria-label="New task"
            placeholder="Add a task…"
            maxLength={1000}
            value={newTitle}
            disabled={busy || loading || loadFailed}
            onChange={(event) => setNewTitle(event.target.value)}
          />
          {newTitle.trim() && (
            <button
              type="submit"
              className="task-button task-button-primary"
              disabled={busy || loading}
            >
              {busy && needsCaptureFocus.current ? 'Adding…' : 'Add'}
            </button>
          )}
        </form>
        {view === 'focus' && visible.length > 0 && (
          <p className="mt-4 text-[12px] text-pro-text-muted">
            {counts.focus} of 5 tasks in Focus
          </p>
        )}
        {view === 'review' && visible.length > 0 && (
          <p className="mt-4 text-[12px] text-pro-text-muted">
            Confirm which meeting action items belong on your task list.
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
        ) : loadFailed ? null : rows.length ? (
          <ul aria-label="Tasks" className="mt-2 divide-y divide-pro-border/60">
            {rows.map((task) => {
              const completed = task.entity.status === 'completed';
              const completion = task.needsReview ? (
                <span
                  className="task-check task-review-marker"
                  aria-hidden="true"
                >
                  <Circle size={15} />
                </span>
              ) : (
                <button
                  type="button"
                  className="task-check"
                  data-completed={completed}
                  aria-label={`${completed ? 'Reopen' : 'Complete'} ${task.entity.name}`}
                  disabled={busy}
                  onClick={() => {
                    const isCompleted = task.entity.status === 'completed';
                    const newStatus = isCompleted ? 'active' : 'completed';
                    void run(async () => {
                      await setTaskStatus(task.entity.id, newStatus);
                      showToast(
                        isCompleted
                          ? `Task reopened: “${task.entity.name}”`
                          : `Task completed: “${task.entity.name}”`,
                        {
                          onUndo: () =>
                            setTaskStatus(
                              task.entity.id,
                              isCompleted ? 'completed' : 'active',
                            ),
                        },
                      );
                    });
                  }}
                >
                  <Check size={13} aria-hidden="true" />
                </button>
              );
              return (
                <li
                  key={task.entity.id}
                  className={
                    highlightedTaskId === task.entity.id
                      ? 'task-row is-highlighted'
                      : 'task-row'
                  }
                >
                  {selectedId === task.entity.id ? (
                    <TaskDetails
                      task={task}
                      completion={completion}
                      snapshot={snapshot}
                      busy={busy}
                      run={run}
                      onClose={() => {
                        setSelectedId(null);
                        window.requestAnimationFrame(() => {
                          const trigger = document.getElementById(
                            `task-open-${task.entity.id}`,
                          );
                          (trigger ?? activeViewRef.current)?.focus({
                            preventScroll: true,
                          });
                        });
                      }}
                      onOpenMeeting={onOpenMeeting}
                      showToast={showToast}
                    />
                  ) : (
                    <div className="task-row-summary">
                      {completion}
                      <button
                        type="button"
                        id={`task-open-${task.entity.id}`}
                        className="min-w-0 flex-1 rounded-sm text-left"
                        aria-expanded={false}
                        disabled={busy}
                        onClick={() => setSelectedId(task.entity.id)}
                      >
                        <span
                          className={`block break-words text-[14px] font-medium leading-6 ${task.entity.status === 'completed' ? 'text-pro-text-muted line-through' : 'text-pro-text-main'}`}
                        >
                          {task.entity.name}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-5 text-pro-text-muted">
                          {task.projectId && (
                            <span>
                              {snapshot.projects.find(
                                (project) => project.id === task.projectId,
                              )?.name || 'Project'}
                            </span>
                          )}
                          {task.tagIds
                            .map((id) =>
                              snapshot.tags.find((tag) => tag.id === id),
                            )
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
                            {formatTaskDate(task.entity.due_date)}
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
                                task.focused
                                  ? 'Remove from Focus'
                                  : 'Add to Focus'
                              }
                              disabled={busy}
                              onClick={() => {
                                const newFocused = !task.focused;
                                void run(async () => {
                                  await setTaskFocus(
                                    task.entity.id,
                                    newFocused,
                                  );
                                  showToast(
                                    newFocused
                                      ? `Added to Daily Focus (${counts.focus + 1} of 5)`
                                      : 'Removed from Daily Focus',
                                  );
                                });
                              }}
                            >
                              <Star
                                size={15}
                                fill={task.focused ? 'currentColor' : 'none'}
                                aria-hidden="true"
                              />
                            </button>
                          )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            {filtered ? (
              <>
                <div className="task-empty-badge" aria-hidden="true">
                  <SlidersHorizontal size={20} strokeWidth={1.5} />
                </div>
                <h2 className="mt-4 font-serif text-[19px] font-medium text-pro-text-main">
                  No tasks match
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-pro-text-muted">
                  {searchActive && activeFilters
                    ? 'Try a different search or clear your search and filters.'
                    : searchActive
                      ? 'Try a different search.'
                      : 'Try changing or clearing your filters.'}
                </p>
                <button
                  type="button"
                  className="task-button mt-4"
                  onClick={() => {
                    setSearch('');
                    setProject('');
                    setTags([]);
                    setDue('');
                  }}
                >
                  {searchActive
                    ? activeFilters
                      ? 'Clear search and filters'
                      : 'Clear search'
                    : 'Clear filters'}
                </button>
              </>
            ) : view === 'focus' ? (
              <>
                <div
                  className="task-empty-badge !border-amber-500/25 !bg-amber-500/10 !text-amber-500"
                  aria-hidden="true"
                >
                  <Star size={20} strokeWidth={1.5} />
                </div>
                <h2 className="mt-4 font-serif text-[19px] font-medium text-pro-text-main">
                  No tasks in Focus
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-pro-text-muted">
                  Star up to five open tasks to focus on today.
                </p>
              </>
            ) : view === 'completed' ? (
              <>
                <div className="task-empty-badge" aria-hidden="true">
                  <CheckCheck size={20} strokeWidth={1.5} />
                </div>
                <h2 className="mt-4 font-serif text-[19px] font-medium text-pro-text-main">
                  No completed tasks
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-pro-text-muted">
                  Check off a task to move it here.
                </p>
              </>
            ) : view === 'review' ? (
              <>
                <div className="task-empty-badge" aria-hidden="true">
                  <Sparkles size={20} strokeWidth={1.5} />
                </div>
                <h2 className="mt-4 font-serif text-[19px] font-medium text-pro-text-main">
                  Nothing to review
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-pro-text-muted">
                  Action items that need confirmation will appear here.
                </p>
              </>
            ) : (
              <EmptyCanvas
                kind="tasks"
                compact
                title="No open tasks"
                description="Use the field above to add a task."
              />
            )}
          </div>
        )}
      </div>
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="task-toast fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-pro-border bg-pro-surface/95 px-4 py-3 text-[13px] shadow-lg backdrop-blur-md"
        >
          <CheckCircle2
            size={16}
            className="shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <span className="max-w-[280px] truncate font-medium text-pro-text-main">
            {toast.message}
          </span>
          {toast.onUndo && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md bg-pro-accent/10 px-2 py-0.5 text-xs font-semibold text-pro-accent transition-colors hover:bg-pro-accent/20"
              disabled={busy}
              onClick={() => {
                const undoFn = toast.onUndo;
                setToast(null);
                if (undoFn) {
                  void run(async () => {
                    await undoFn();
                    showToast('Action undone');
                  });
                }
              }}
            >
              <RotateCcw size={12} aria-hidden="true" />
              Undo
            </button>
          )}
          <button
            type="button"
            className="ml-1 rounded p-0.5 text-pro-text-muted transition-colors hover:text-pro-text-main"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}

function TaskDetails({
  task,
  completion,
  snapshot,
  busy,
  run,
  onClose,
  onOpenMeeting,
  showToast,
}: {
  task: PersonalTask;
  completion: ReactNode;
  snapshot: TasksSnapshot;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  onClose: () => void;
  onOpenMeeting: (id: string) => void;
  showToast: (message: string, options?: { onUndo?: () => unknown }) => void;
}) {
  const [title, setTitle] = useState(task.entity.name);
  const [date, setDate] = useState(task.entity.due_date?.slice(0, 10) ?? '');
  const [projectId, setProjectId] = useState(task.projectId ?? '');
  const [tagIds, setTagIds] = useState(task.tagIds);
  const [description, setDescription] = useState(task.description);
  const [tagName, setTagName] = useState('');
  const [revision, setRevision] = useState(task.revision);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tool, setTool] = useState<TaskTool | null>(null);
  const toolPanelRef = useRef<HTMLDivElement>(null);
  const toolButtons = useRef<
    Partial<Record<TaskTool, HTMLButtonElement | null>>
  >({});

  useEffect(() => {
    if (tool) toolPanelRef.current?.querySelector('input')?.focus();
  }, [tool]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>(
    'idle',
  );

  useEffect(() => {
    setSaveStatus('idle');
  }, [title, date, projectId, tagIds, description]);

  useEffect(() => {
    if (saveStatus === 'saved') {
      const timer = setTimeout(() => setSaveStatus('idle'), 2500);
      return () => clearTimeout(timer);
    }
  }, [saveStatus]);

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
  const editorRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fieldBeforeSave = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (busy || !fieldBeforeSave.current) return;
    if (document.activeElement === document.body) {
      fieldBeforeSave.current.focus({ preventScroll: true });
    }
    fieldBeforeSave.current = null;
  }, [busy]);
  useEffect(() => {
    if (titleRef.current) {
      const field = titleRef.current;
      field.focus({ preventScroll: true });
      field.setSelectionRange(field.value.length, field.value.length);
    } else {
      closeRef.current?.focus({ preventScroll: true });
    }
    editorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  const sourceMeetingId = task.sourceMeetingId;
  const meetingLink = sourceMeetingId && (
    <button
      type="button"
      className="task-source"
      title="Open source meeting"
      onClick={() => onOpenMeeting(sourceMeetingId)}
    >
      <NotebookText size={14} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">
        {task.sourceMeetingTitle || 'Open source meeting'}
      </span>
      <ArrowUpRight size={12} className="shrink-0" aria-hidden="true" />
    </button>
  );
  return (
    <article
      ref={editorRef}
      className="task-details"
      aria-label={task.needsReview ? 'Review task' : 'Edit task'}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || busy)
          return;
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (tool) {
            setTool(null);
            toolButtons.current[tool]?.focus();
          } else {
            onClose();
          }
        }
      }}
    >
      <button
        ref={closeRef}
        type="button"
        className="task-button task-details-close"
        aria-label="Close task details"
        disabled={busy}
        onClick={onClose}
      >
        <X size={16} aria-hidden="true" />
      </button>
      {task.needsReview ? (
        <div className="space-y-4">
          <h2 className="task-review-title">{task.entity.name}</h2>
          <p className="text-[12px] leading-5 text-pro-text-muted">
            If you’re responsible for this, add it to your tasks.
          </p>
          {meetingLink}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="task-button task-button-primary"
              disabled={busy}
              onClick={async () => {
                if (await run(() => reviewTask(task.entity.id, 'confirmed'))) {
                  onClose();
                  showToast('Added to your tasks');
                }
              }}
            >
              Add to tasks
            </button>
            <button
              type="button"
              className="task-button"
              disabled={busy}
              onClick={async () => {
                if (await run(() => reviewTask(task.entity.id, 'rejected'))) {
                  onClose();
                  showToast('Suggestion dismissed');
                }
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : (
        <form
          onKeyDown={(event) => {
            if (event.defaultPrevented || event.nativeEvent.isComposing) return;
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (!busy) event.currentTarget.requestSubmit();
            }
          }}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !title.trim()) return;
            if (
              document.activeElement instanceof HTMLElement &&
              event.currentTarget.contains(document.activeElement)
            ) {
              fieldBeforeSave.current = document.activeElement;
            }
            setSaveStatus('saving');
            const ok = await run(() =>
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
            if (ok) {
              setSaveStatus('saved');
            } else {
              setSaveStatus('idle');
            }
          }}
        >
          <div className="task-editor-body">
            <div className="task-writing">
              <div className="task-writing-check">{completion}</div>
              <textarea
                ref={titleRef}
                className="task-editor-title"
                aria-label="Task title"
                placeholder="Task title"
                required
                disabled={busy}
                maxLength={1000}
                rows={1}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <textarea
                className="task-editor-notes"
                aria-label="Notes"
                rows={2}
                disabled={busy}
                maxLength={10000}
                placeholder="Add notes…"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              {meetingLink}
            </div>
            <div
              className="task-properties"
              role="group"
              aria-label="Task properties"
            >
              {taskTools.map(({ id, label, Icon }) => {
                const value =
                  id === 'date'
                    ? date && formatTaskDate(date)
                    : id === 'project'
                      ? snapshot.projects.find(
                          (project) => project.id === projectId,
                        )?.name
                      : snapshot.tags
                          .filter((tag) => tagIds.includes(tag.id))
                          .map((tag) => tag.name)
                          .join(', ');
                return (
                  <button
                    key={id}
                    ref={(button) => {
                      toolButtons.current[id] = button;
                    }}
                    type="button"
                    className="task-property"
                    aria-label={label}
                    aria-describedby={`task-property-${id}-value`}
                    aria-expanded={tool === id}
                    aria-controls={tool === id ? 'task-tool-panel' : undefined}
                    title={value ? `${label}: ${value}` : label}
                    disabled={busy}
                    onClick={() => setTool(tool === id ? null : id)}
                  >
                    <span className="task-property-label">
                      <Icon size={14} aria-hidden="true" />
                      {label}
                    </span>
                    <span
                      className={`task-property-value ${value ? '' : 'is-empty'}`}
                      id={`task-property-${id}-value`}
                    >
                      {value || 'None'}
                    </span>
                    <ChevronRight
                      size={13}
                      className="task-property-chevron"
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
              {tool && (
                <div
                  className="task-tool-panel"
                  id="task-tool-panel"
                  ref={toolPanelRef}
                >
                  {tool === 'date' ? (
                    <label className="task-field">
                      Due date
                      <input
                        type="date"
                        disabled={busy}
                        value={date}
                        onChange={(event) => setDate(event.target.value)}
                      />
                    </label>
                  ) : tool === 'project' ? (
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
                  ) : (
                    <fieldset className="min-w-0" disabled={busy}>
                      <legend className="mb-2 text-[12px] font-medium text-pro-text-muted">
                        Tags
                      </legend>
                      <div className="flex items-center gap-2">
                        <input
                          aria-label="Find or create tag"
                          className="task-input min-w-0 flex-1"
                          placeholder="Find or add a tag…"
                          maxLength={60}
                          value={tagName}
                          onChange={(event) => setTagName(event.target.value)}
                          onKeyDown={(event) => {
                            if (
                              event.key === 'Enter' &&
                              !event.metaKey &&
                              !event.ctrlKey &&
                              !event.nativeEvent.isComposing
                            ) {
                              event.preventDefault();
                              if (!tagName.trim()) return;
                              void run(async () => {
                                const tag = await saveTaskTag({
                                  name: tagName.trim(),
                                });
                                setTagIds((ids) => [
                                  ...new Set([...ids, tag.id]),
                                ]);
                                setTagName('');
                              });
                            }
                          }}
                        />
                        <button
                          type="button"
                          aria-label="Add tag"
                          className="task-button !px-2"
                          disabled={busy || !tagName.trim()}
                          onClick={() =>
                            void run(async () => {
                              const tag = await saveTaskTag({
                                name: tagName.trim(),
                              });
                              setTagIds((ids) => [
                                ...new Set([...ids, tag.id]),
                              ]);
                              setTagName('');
                            })
                          }
                        >
                          <Plus size={16} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="task-editor-tags">
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
                    </fieldset>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="task-editor-actions">
            {!task.needsReview &&
              (confirmDelete ? (
                <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs dark:bg-red-500/15">
                  <span className="font-medium text-red-600 dark:text-red-400">
                    Delete task?
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="inline-flex h-7 items-center justify-center rounded-md bg-red-600 px-2.5 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => {
                        void run(async () => {
                          const deletionRevision = await deleteTask(
                            task.entity.id,
                            task.revision,
                          );
                          onClose();
                          showToast(`Task deleted: “${task.entity.name}”`, {
                            onUndo: () =>
                              restoreTask(task.entity.id, deletionRevision),
                          });
                        });
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-7 items-center justify-center rounded-md px-2.5 text-[11px] font-medium text-pro-text-muted transition-colors hover:bg-pro-text-main/5 hover:text-pro-text-main disabled:opacity-50"
                      disabled={busy}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="task-button task-tool-button"
                  title="Delete task"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete task"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              ))}
            <div className="task-editor-tools">
              {saveStatus === 'saved' && (
                <span role="status" className="task-saved">
                  <Check size={14} aria-hidden="true" />
                  Changes saved
                </span>
              )}
              <button
                type="submit"
                className="task-button task-button-outline"
                disabled={busy || !title.trim()}
                aria-keyshortcuts="Meta+Enter Control+Enter"
                title="Save changes (⌘ Return)"
              >
                {saveStatus === 'saving' && (
                  <Loader2
                    size={13}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                )}
                {saveStatus === 'saving' ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </form>
      )}
    </article>
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
            Changes apply wherever a tag is used. Removing a tag keeps the
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
          No tags yet. Open a task to add one.
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
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => saveTaskTag({ id: tag.id, name }));
      }}
    >
      <div className="flex min-w-0 flex-[1_1_230px] items-center gap-2">
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
      </div>
      <div className="flex min-w-0 flex-[1_1_270px] items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchSelect
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
        </div>
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
      </div>
    </form>
  );
}
