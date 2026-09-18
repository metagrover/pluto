import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Flag,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  deleteProjectMilestone,
  recordEntityCorrection,
  restoreProjectMilestone,
  saveProjectMilestone,
} from '../../../api/knowledgeGraph';
import type { ProjectMilestone } from '../../../utils/projectBriefing';
import type {
  UserProjectMilestone,
  UserProjectMilestoneInput,
  UserProjectMilestoneStatus,
} from '../../../utils/projectMilestones';

const statusLabel: Record<ProjectMilestone['status'], string> = {
  complete: 'Complete',
  overdue: 'Overdue',
  upcoming: 'Due soon',
  in_progress: 'In progress',
  planned: 'Planned',
};

const statusBadgeClasses: Record<ProjectMilestone['status'], string> = {
  complete:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  overdue: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  upcoming:
    'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  in_progress: 'border-pro-accent/30 bg-pro-accent/10 text-pro-accent',
  planned: 'border-pro-border/70 bg-pro-surface text-pro-text-muted',
};

interface StatusOption {
  value: UserProjectMilestoneStatus;
  label: string;
  icon: typeof Circle;
  activeClasses: string;
  iconColor: string;
}

const statusOptions: StatusOption[] = [
  {
    value: 'planned',
    label: 'Planned',
    icon: Circle,
    activeClasses:
      'bg-pro-bg text-pro-text-main border border-pro-border shadow-2xs font-semibold',
    iconColor: 'text-pro-text-muted',
  },
  {
    value: 'in_progress',
    label: 'In progress',
    icon: Clock,
    activeClasses:
      'bg-pro-accent/10 text-pro-accent border border-pro-accent/30 shadow-2xs font-semibold',
    iconColor: 'text-pro-accent',
  },
  {
    value: 'completed',
    label: 'Complete',
    icon: CheckCircle2,
    activeClasses:
      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shadow-2xs font-semibold',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
];

const getQuickDatePresets = () => {
  const now = new Date();

  // Friday of this week (or next Friday if today is Fri/Sat/Sun)
  const friday = new Date(now);
  const dayOfWeek = now.getDay();
  let daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  if (daysUntilFriday === 0) daysUntilFriday = 7;
  friday.setDate(now.getDate() + daysUntilFriday);

  // In 2 weeks
  const twoWeeks = new Date(now);
  twoWeeks.setDate(now.getDate() + 14);

  // End of month
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const toYMD = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  return [
    { label: 'This Friday', getDate: () => toYMD(friday) },
    { label: 'In 2 weeks', getDate: () => toYMD(twoWeeks) },
    { label: 'End of month', getDate: () => toYMD(endOfMonth) },
  ];
};

const formatTargetDatePreview = (dateStr: string | null): string | null => {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;

  const formatted = target.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const targetUtc = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
  );
  const diffDays = Math.round((targetUtc - todayUtc) / (1000 * 60 * 60 * 24));

  let relative = '';
  if (diffDays === 0) relative = 'today';
  else if (diffDays === 1) relative = 'tomorrow';
  else if (diffDays === -1) relative = 'yesterday';
  else if (diffDays > 1 && diffDays < 14) relative = `in ${diffDays}d`;
  else if (diffDays >= 14) relative = `in ${Math.round(diffDays / 7)}w`;
  else if (diffDays < -1) relative = `${Math.abs(diffDays)}d ago`;

  return relative ? `${formatted} · ${relative}` : formatted;
};

const toInputStatus = (
  milestone: ProjectMilestone,
): UserProjectMilestoneStatus => {
  if (milestone.userStatus) return milestone.userStatus;
  if (milestone.status === 'complete') return 'completed';
  if (milestone.status === 'in_progress') return 'in_progress';
  return 'planned';
};

const timing = (targetDate: string | null): string | null => {
  if (!targetDate) return null;
  const value = new Date(targetDate);
  return Number.isNaN(value.getTime())
    ? null
    : value.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
};

const sourceDate = (value: string): string | null => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
};

const toProjectMilestone = (
  milestone: UserProjectMilestone,
): ProjectMilestone => ({
  id: milestone.id,
  title: milestone.title,
  status:
    milestone.status === 'completed'
      ? 'complete'
      : milestone.status === 'in_progress'
        ? 'in_progress'
        : 'planned',
  timing: timing(milestone.targetDate),
  evidenceQuote: null,
  source: 'user',
  userStatus: milestone.status,
  targetDate: milestone.targetDate,
  note: milestone.note,
});

const emptyDraft = (): UserProjectMilestoneInput => ({
  title: '',
  status: 'planned',
  targetDate: null,
  note: null,
});

export function ProjectMilestones({
  projectId,
  milestones,
  evidenceMeetings = [],
  onOpenMeeting,
  onChange,
}: {
  projectId: string;
  milestones: ProjectMilestone[];
  evidenceMeetings?: Array<{
    id: string;
    title?: string | null;
    date?: string | null;
  }>;
  onOpenMeeting?: (meetingId: string) => void;
  onChange: (milestones: ProjectMilestone[]) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<UserProjectMilestoneInput>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleted, setDeleted] = useState<UserProjectMilestone | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (formOpen) {
      const timer = setTimeout(() => {
        titleInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [formOpen]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setFormOpen(false);
    }
  };

  const openCreate = () => {
    setDraft(emptyDraft());
    setError('');
    setNotice('');
    setFormOpen(true);
  };

  const openEdit = (milestone: ProjectMilestone) => {
    setDraft({
      id: milestone.id,
      title: milestone.title,
      status: toInputStatus(milestone),
      targetDate: milestone.targetDate?.slice(0, 10) ?? null,
      note: milestone.note,
    });
    setError('');
    setNotice('');
    setFormOpen(true);
  };

  const save = async () => {
    if (!draft.title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await saveProjectMilestone(projectId, {
        id: draft.id,
        title: draft.title.trim(),
        status: draft.status,
        targetDate: draft.targetDate || null,
        note: draft.note?.trim() || null,
      });
      const next = toProjectMilestone(saved);
      onChange(
        milestones.some((milestone) => milestone.id === next.id)
          ? milestones.map((milestone) =>
              milestone.id === next.id ? next : milestone,
            )
          : [...milestones, next],
      );
      setDraft(emptyDraft());
      setFormOpen(false);
      setNotice('Milestone saved');
    } catch {
      setError('We couldn’t save this milestone. Your draft is still here.');
    } finally {
      setBusy(false);
    }
  };

  const complete = async (milestone: ProjectMilestone) => {
    setBusy(true);
    setError('');
    try {
      const saved = await saveProjectMilestone(projectId, {
        id: milestone.id,
        title: milestone.title,
        status: 'completed',
        targetDate: milestone.targetDate,
        note: milestone.note,
      });
      onChange(
        milestones.map((item) =>
          item.id === milestone.id ? toProjectMilestone(saved) : item,
        ),
      );
      setNotice('Milestone completed');
    } catch {
      setError('We couldn’t complete this milestone. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (milestone: ProjectMilestone) => {
    setBusy(true);
    setError('');
    try {
      const removed =
        milestone.source === 'commitment'
          ? null
          : await deleteProjectMilestone(projectId, milestone.id);
      onChange(milestones.filter((item) => item.id !== milestone.id));
      if (milestone.source === 'user' && removed) setDeleted(removed);
      if (milestone.source !== 'dreaming') {
        await recordEntityCorrection({
          entityId: projectId,
          itemType: 'milestone',
          fingerprint: milestone.title,
          reason: 'removed_by_user',
        });
      }
      setNotice('Milestone deleted');
    } catch {
      setError('We couldn’t delete this milestone. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const undoDelete = async () => {
    if (!deleted || busy) return;
    setBusy(true);
    setError('');
    try {
      const restored = await restoreProjectMilestone(projectId, deleted);
      onChange([...milestones, toProjectMilestone(restored)]);
      setDeleted(null);
      setNotice('Milestone restored');
    } catch {
      setError('We couldn’t restore this milestone. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="project-milestones">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="project-milestones" className="project-dossier-section-title">
            Timeline and milestones
          </h2>
          <p className="project-dossier-meta mt-1">
            Upcoming dates, plans, and checkpoints from your meetings
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (formOpen) {
              setFormOpen(false);
            } else {
              openCreate();
            }
          }}
          className={
            formOpen
              ? 'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-pro-border/70 bg-pro-surface px-3 text-xs font-medium text-pro-text-muted transition-colors hover:bg-pro-hover hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent'
              : 'inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-pro-accent/10 px-3 text-xs font-medium text-pro-accent border border-pro-accent/25 transition-colors hover:bg-pro-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent'
          }
        >
          {formOpen ? (
            <>
              <X aria-hidden="true" className="h-3.5 w-3.5" />
              Close
            </>
          ) : (
            <>
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              Add milestone
            </>
          )}
        </button>
      </div>

      {formOpen && (
        <div
          onKeyDown={handleKeyDown}
          className="relative mb-6 overflow-hidden rounded-2xl border border-pro-border/80 bg-pro-surface/60 p-5 sm:p-6 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.05] transition-all"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-pro-border/50 pb-3.5">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pro-accent/10 text-pro-accent">
                <Flag className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-sm font-semibold tracking-tight text-pro-text-main">
                  {draft.id ? 'Edit milestone' : 'New milestone'}
                </h3>
                <p className="text-xs text-pro-text-muted">
                  {draft.id
                    ? 'Update checkpoint details, timeline, or status'
                    : 'Track an executive checkpoint, delivery target, or decision'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              aria-label="Cancel and close"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-pro-text-muted transition-colors hover:bg-pro-hover hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="mt-4 space-y-4"
          >
            {/* Title */}
            <div>
              <div className="flex items-center justify-between pb-1.5">
                <label
                  htmlFor="project-milestone-title"
                  className="text-xs font-semibold uppercase tracking-wider text-pro-text-muted"
                >
                  Milestone title
                </label>
                <span className="text-[11px] text-pro-text-muted/70">
                  Required
                </span>
              </div>
              <input
                ref={titleInputRef}
                id="project-milestone-title"
                type="text"
                required
                value={draft.title}
                placeholder="e.g., SOC 2 compliance signoff, v1.0 Launch, Board review"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                className="w-full rounded-xl border border-pro-border bg-pro-bg px-3.5 py-2.5 text-sm text-pro-text-main shadow-2xs outline-none transition placeholder:text-pro-text-muted/50 focus:border-pro-accent focus:ring-2 focus:ring-pro-accent/20"
              />
            </div>

            {/* Status & Date */}
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Status Segmented Control */}
              <div>
                <span
                  id="project-milestone-status-label"
                  className="block text-xs font-semibold uppercase tracking-wider text-pro-text-muted pb-1.5"
                >
                  Status
                </span>
                <div
                  role="radiogroup"
                  aria-labelledby="project-milestone-status-label"
                  className="grid grid-cols-3 gap-1 rounded-xl border border-pro-border/70 bg-pro-bg/90 p-1"
                >
                  {statusOptions.map((opt) => {
                    const isSelected = draft.status === opt.value;
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            status: opt.value,
                          }))
                        }
                        className={`group flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-all ${
                          isSelected
                            ? opt.activeClasses
                            : 'text-pro-text-muted hover:bg-pro-hover/70 hover:text-pro-text-main'
                        }`}
                      >
                        <Icon
                          className={`h-3.5 w-3.5 ${
                            isSelected
                              ? opt.iconColor
                              : 'text-pro-text-muted group-hover:text-pro-text-main'
                          }`}
                          aria-hidden="true"
                        />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Target date */}
              <div>
                <div className="flex items-center justify-between pb-1.5">
                  <label
                    htmlFor="project-milestone-date"
                    className="text-xs font-semibold uppercase tracking-wider text-pro-text-muted"
                  >
                    Target date
                  </label>
                  {draft.targetDate && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-pro-accent">
                      <Sparkles className="h-3 w-3" aria-hidden="true" />
                      {formatTargetDatePreview(draft.targetDate)}
                    </span>
                  )}
                </div>
                <div className="relative flex items-center">
                  <Calendar
                    className="pointer-events-none absolute left-3.5 h-4 w-4 text-pro-text-muted"
                    aria-hidden="true"
                  />
                  <input
                    id="project-milestone-date"
                    type="date"
                    value={draft.targetDate ?? ''}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        targetDate: event.target.value || null,
                      }))
                    }
                    className="w-full rounded-xl border border-pro-border bg-pro-bg py-2.5 pl-10 pr-9 text-sm text-pro-text-main shadow-2xs outline-none transition focus:border-pro-accent focus:ring-2 focus:ring-pro-accent/20"
                  />
                  {draft.targetDate && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          targetDate: null,
                        }))
                      }
                      aria-label="Clear target date"
                      className="absolute right-2.5 flex h-6 w-6 items-center justify-center rounded text-pro-text-muted hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pro-accent"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>

                {/* Date Presets */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="mr-0.5 text-pro-text-muted/70">
                    Presets:
                  </span>
                  {getQuickDatePresets().map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          targetDate: preset.getDate(),
                        }))
                      }
                      className="rounded-md border border-pro-border/60 bg-pro-bg px-2 py-0.5 text-xs text-pro-text-muted transition-colors hover:border-pro-accent/40 hover:text-pro-accent"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Note / Context */}
            <div>
              <label
                htmlFor="project-milestone-note"
                className="block text-xs font-semibold uppercase tracking-wider text-pro-text-muted pb-1.5"
              >
                Context & criteria{' '}
                <span className="font-normal normal-case text-pro-text-muted/70">
                  (optional)
                </span>
              </label>
              <textarea
                id="project-milestone-note"
                rows={2}
                value={draft.note ?? ''}
                placeholder="Add context, key deliverables, dependencies, or what success looks like..."
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    note: event.target.value || null,
                  }))
                }
                className="w-full rounded-xl border border-pro-border bg-pro-bg px-3.5 py-2.5 text-sm text-pro-text-main shadow-2xs outline-none transition placeholder:text-pro-text-muted/50 focus:border-pro-accent focus:ring-2 focus:ring-pro-accent/20"
              />
            </div>

            {/* Error Message */}
            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-pro-urgent/20 bg-pro-urgent/10 p-3 text-xs text-pro-urgent"
              >
                <AlertTriangle
                  className="h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{error}</span>
              </div>
            )}

            {/* Actions Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!draft.title.trim() || busy}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-pro-accent px-4 text-xs font-medium text-white shadow-sm transition hover:bg-pro-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? (
                    <>
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                      <span>Saving…</span>
                    </>
                  ) : draft.id ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Save milestone</span>
                    </>
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Create milestone</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-pro-border/70 bg-pro-bg px-3.5 text-xs font-medium text-pro-text-muted transition hover:bg-pro-hover hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
                >
                  Cancel
                </button>
              </div>

              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-pro-text-muted/60">
                <kbd className="rounded border border-pro-border/80 bg-pro-bg px-1.5 py-0.5 font-mono text-[10px] text-pro-text-muted shadow-2xs">
                  ⌘ ↵
                </kbd>
                <span>save</span>
                <span>·</span>
                <kbd className="rounded border border-pro-border/80 bg-pro-bg px-1.5 py-0.5 font-mono text-[10px] text-pro-text-muted shadow-2xs">
                  esc
                </kbd>
                <span>cancel</span>
              </div>
            </div>
          </form>
        </div>
      )}

      {milestones.length ? (
        <ol className="relative space-y-0 before:absolute before:bottom-5 before:left-[11px] before:top-5 before:w-px before:bg-pro-border/70">
          {milestones.map((milestone) => (
            <li
              key={milestone.id}
              className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-4 py-3.5"
            >
              <span
                className={`relative z-10 mt-1 flex h-6 w-6 items-center justify-center rounded-full border bg-pro-bg shadow-2xs ${
                  milestone.status === 'complete'
                    ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                    : milestone.status === 'overdue'
                      ? 'border-rose-500/40 text-rose-600 dark:text-rose-400'
                      : milestone.status === 'upcoming'
                        ? 'border-amber-500/40 text-amber-600 dark:text-amber-400'
                        : milestone.status === 'in_progress'
                          ? 'border-pro-accent/40 text-pro-accent'
                          : 'border-pro-border text-pro-text-muted'
                }`}
              >
                {milestone.status === 'complete' ? (
                  <Check
                    aria-hidden="true"
                    className="h-3.5 w-3.5 stroke-[2.5]"
                  />
                ) : milestone.status === 'overdue' ? (
                  <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
                ) : (
                  <Circle aria-hidden="true" className="h-2 w-2 fill-current" />
                )}
              </span>
              <div className="min-w-0 border-b border-pro-border/35 pb-3.5 last:border-0 sm:flex sm:items-start sm:justify-between sm:gap-5">
                <div className="min-w-0">
                  <p className="font-medium leading-6 text-pro-text-main">
                    {milestone.title}
                  </p>
                  {milestone.note && (
                    <p className="mt-1 max-w-[56ch] text-sm leading-5 text-pro-text-muted">
                      {milestone.note}
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-pro-text-muted">
                    {milestone.source === 'user'
                      ? 'Added by you'
                      : milestone.source === 'dreaming'
                        ? 'Suggested by Pluto'
                        : 'From meeting notes'}
                  </p>
                  {milestone.source === 'dreaming' &&
                  milestone.sourceExcerpts?.length ? (
                    <details className="mt-1.5 text-sm">
                      <summary className="min-h-11 cursor-pointer rounded py-2 text-pro-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent sm:min-h-10">
                        See meeting note
                      </summary>
                      <ul className="space-y-2 border-l border-pro-border/60 pl-3">
                        {milestone.sourceExcerpts.map((excerpt, index) => {
                          const meeting = evidenceMeetings.find(
                            (item) =>
                              item.id === milestone.sourceMeetingIds?.[index],
                          );
                          const meetingDate = meeting?.date
                            ? sourceDate(meeting.date)
                            : null;
                          return (
                            <li key={`${milestone.id}-source-${index}`}>
                              {meeting && onOpenMeeting ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenMeeting(meeting.id)}
                                  className="min-h-11 rounded text-left text-xs text-pro-text-muted hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent sm:min-h-10"
                                >
                                  {meeting.title || 'Meeting'}
                                  {meetingDate ? ` · ${meetingDate}` : ''}
                                </button>
                              ) : (
                                <p className="text-xs text-pro-text-muted">
                                  {meeting?.title || 'Meeting'}
                                  {meetingDate ? ` · ${meetingDate}` : ''}
                                </p>
                              )}
                              <q className="mt-1 block max-w-[56ch] leading-5 text-pro-text-main">
                                {excerpt}
                              </q>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  ) : null}
                </div>
                <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2 sm:mt-0 sm:justify-end">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusBadgeClasses[milestone.status]}`}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-current opacity-80"
                      aria-hidden="true"
                    />
                    {statusLabel[milestone.status]}
                    {milestone.timing ? ` · ${milestone.timing}` : ''}
                  </span>
                  {milestone.source === 'user' && (
                    <div className="flex items-center gap-1">
                      {milestone.status !== 'complete' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void complete(milestone)}
                          aria-label={`Mark ${milestone.title} complete`}
                          title="Mark complete"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-pro-text-muted transition-colors hover:bg-emerald-500/10 hover:text-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-50"
                        >
                          <Check aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openEdit(milestone)}
                        aria-label={`Edit ${milestone.title}`}
                        title="Edit milestone"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-pro-text-muted transition-colors hover:bg-pro-hover hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-50"
                      >
                        <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(milestone)}
                        aria-label={`Delete ${milestone.title}`}
                        title="Delete milestone"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-pro-text-muted transition-colors hover:bg-rose-500/10 hover:text-rose-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-50"
                      >
                        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {milestone.source !== 'user' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(milestone)}
                      aria-label={`Remove ${milestone.title}`}
                      title="Remove from project"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-pro-text-muted transition-colors hover:bg-rose-500/10 hover:text-rose-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-50"
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : !formOpen ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-pro-border/80 bg-pro-surface/30 px-6 py-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-pro-border/60 bg-pro-surface text-pro-text-muted shadow-2xs">
            <Flag className="h-5 w-5" aria-hidden="true" />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-pro-text-main">
            No dates or milestones yet
          </h3>
          <p className="mt-1 max-w-[46ch] text-xs leading-5 text-pro-text-muted">
            Add an important checkpoint, deadline, or deliverable. Pluto will
            also suggest milestones when they arise in your meetings.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-pro-accent/25 bg-pro-accent/10 px-3.5 py-2 text-xs font-medium text-pro-accent transition-colors hover:bg-pro-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add first milestone
          </button>
        </div>
      ) : null}

      {error && !formOpen && (
        <p role="alert" className="mt-3 text-sm text-pro-urgent">
          {error}
        </p>
      )}
      {notice && (
        <output className="mt-3 block text-xs text-pro-success">
          {notice}
        </output>
      )}
      {deleted && (
        <div
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex max-w-sm items-center gap-4 rounded-lg border border-pro-border bg-pro-bg px-4 py-3 text-sm shadow-lg"
        >
          <span>{deleted.title} was deleted.</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void undoDelete()}
            className="rounded font-medium text-pro-accent underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
          >
            Undo
          </button>
        </div>
      )}
    </section>
  );
}
