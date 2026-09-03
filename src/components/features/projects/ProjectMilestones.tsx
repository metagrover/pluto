import {
  AlertTriangle,
  Check,
  Circle,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
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

const statusTone: Record<ProjectMilestone['status'], string> = {
  complete: 'text-pro-success',
  overdue: 'text-pro-urgent',
  upcoming: 'text-pro-warning',
  in_progress: 'text-pro-accent',
  planned: 'text-pro-text-muted',
};

const buttonClass =
  'inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-sm text-pro-text-muted transition-colors duration-150 ease-out hover:bg-pro-hover hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-50';

const fieldClass =
  'mt-1.5 w-full rounded-md border border-pro-border bg-pro-bg px-3 py-2 text-sm text-pro-text-main outline-none transition-colors focus-visible:border-pro-accent focus-visible:ring-2 focus-visible:ring-pro-accent/20';

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
          <h2 id="project-milestones" className="text-lg font-semibold">
            Milestones
          </h2>
          <p className="mt-1 text-xs text-pro-text-muted">
            User plans and checkpoints grounded in meeting evidence
          </p>
        </div>
        <button type="button" onClick={openCreate} className={buttonClass}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add milestone
        </button>
      </div>

      {formOpen && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="mb-5 border-y border-pro-accent/25 bg-pro-accent/[0.025] py-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-medium text-pro-text-muted sm:col-span-2">
              Milestone title
              <input
                id="project-milestone-title"
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                className={fieldClass}
              />
            </label>
            <label className="text-xs font-medium text-pro-text-muted">
              Status
              <select
                value={draft.status}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    status: event.target.value as UserProjectMilestoneStatus,
                  }))
                }
                className={fieldClass}
              >
                <option value="planned">Planned</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Complete</option>
              </select>
            </label>
            <label className="text-xs font-medium text-pro-text-muted">
              Target date, optional
              <input
                type="date"
                value={draft.targetDate ?? ''}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    targetDate: event.target.value || null,
                  }))
                }
                className={fieldClass}
              />
            </label>
            <label className="text-xs font-medium text-pro-text-muted sm:col-span-2">
              Note, optional
              <textarea
                value={draft.note ?? ''}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    note: event.target.value || null,
                  }))
                }
                rows={2}
                className={fieldClass}
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-pro-urgent">
              {error}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={!draft.title.trim() || busy}
              className="min-h-10 rounded-md bg-pro-accent px-4 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-40"
            >
              {busy
                ? 'Saving milestone…'
                : draft.id
                  ? 'Save milestone'
                  : 'Create milestone'}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className={buttonClass}
            >
              Keep current milestones
            </button>
          </div>
        </form>
      )}

      {milestones.length ? (
        <ol className="relative space-y-0 before:absolute before:bottom-5 before:left-[11px] before:top-5 before:w-px before:bg-pro-border">
          {milestones.map((milestone) => (
            <li
              key={milestone.id}
              className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-4 py-3"
            >
              <span
                className={`relative z-10 mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-pro-bg ${statusTone[milestone.status]}`}
              >
                {milestone.status === 'complete' ? (
                  <Check aria-hidden="true" className="h-4 w-4" />
                ) : milestone.status === 'overdue' ? (
                  <AlertTriangle aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Circle aria-hidden="true" className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0 border-b border-pro-border/35 pb-3 last:border-0 sm:flex sm:items-start sm:justify-between sm:gap-5">
                <div className="min-w-0">
                  <p className="font-medium leading-6">{milestone.title}</p>
                  {milestone.note && (
                    <p className="mt-1 max-w-[56ch] text-sm leading-5 text-pro-text-muted">
                      {milestone.note}
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-pro-text-muted">
                    {milestone.source === 'user'
                      ? 'User-created'
                      : milestone.source === 'dreaming'
                        ? 'Pluto-prepared'
                        : 'From meeting evidence'}
                  </p>
                  {milestone.source === 'dreaming' &&
                  milestone.sourceExcerpts?.length ? (
                    <details className="mt-1.5 text-sm">
                      <summary className="min-h-11 cursor-pointer rounded py-2 text-pro-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent sm:min-h-10">
                        Show source
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
                                  {meeting.title || 'Linked meeting'}
                                  {meetingDate ? ` · ${meetingDate}` : ''}
                                </button>
                              ) : (
                                <p className="text-xs text-pro-text-muted">
                                  {meeting?.title || 'Linked meeting'}
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
                <div className="mt-2 flex shrink-0 flex-wrap items-center gap-1 sm:mt-0 sm:justify-end">
                  <span
                    className={`mr-1 text-xs font-medium ${statusTone[milestone.status]}`}
                  >
                    {statusLabel[milestone.status]}
                    {milestone.timing ? ` · ${milestone.timing}` : ''}
                  </span>
                  {milestone.source === 'user' && (
                    <>
                      {milestone.status !== 'complete' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void complete(milestone)}
                          aria-label={`Mark ${milestone.title} complete`}
                          className={buttonClass}
                        >
                          <Check aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openEdit(milestone)}
                        aria-label={`Edit ${milestone.title}`}
                        className={buttonClass}
                      >
                        <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(milestone)}
                        aria-label={`Delete ${milestone.title}`}
                        className={buttonClass}
                      >
                        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  {milestone.source !== 'user' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(milestone)}
                      aria-label={`Remove ${milestone.title}`}
                      title="Remove from project"
                      className={buttonClass}
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="border-y border-pro-border/45 py-5">
          <p className="text-sm font-medium">No milestones yet</p>
          <p className="mt-1 max-w-[55ch] text-sm leading-6 text-pro-text-muted">
            Add a checkpoint you want to remember, or Pluto will surface one
            when meeting evidence establishes a date or completion.
          </p>
        </div>
      )}

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
