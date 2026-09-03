import { Check, MoreHorizontal, Pencil } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type EntityAliasSuggestion,
  addProjectAlias,
  getEntityAliasSuggestions,
  getProjectBrief,
  mergeProject,
  recordEntityCorrection,
  restoreProjectMerge,
  setProjectPortfolioDisposition,
  triggerDreamingNow,
  updateEntityAliasSuggestionStatus,
  updateProjectDisplayTitle,
} from '../../../api/knowledgeGraph';
import {
  DREAMING_STATUS_LABEL,
  type DreamingUiStatus,
} from '../../../utils/dreamingStatus';
import type { ProjectBrief } from '../../../utils/projectBriefing';
import type { ProjectPortfolioEntry } from '../../../utils/projectPortfolio';
import { readProjectQualification } from '../../../utils/projectQualification';
import { ProjectCommitments } from './ProjectCommitments';
import { ProjectMilestones } from './ProjectMilestones';

interface ProjectDossierProps {
  projectId: string;
  projectName?: string;
  onBack: () => void;
  onOpenMeeting?: (id: string) => void;
  relatedWork?: ProjectPortfolioEntry[];
  onOpenRelatedWork?: (id: string) => void;
  mergeCandidates?: ProjectPortfolioEntry[];
  onPortfolioChanged?: () => void | Promise<void>;
}

const quietButton =
  'inline-flex min-h-10 items-center gap-2 rounded px-2 text-sm text-pro-text-muted transition-colors hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-50';

const formatDate = (value: string | null | undefined): string => {
  const date = value ? new Date(value) : null;
  return !date || Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
};

const normalizeProjectCopy = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    .toLocaleLowerCase();

export const ProjectDossier = ({
  projectId,
  projectName,
  onBack,
  onOpenMeeting,
  relatedWork = [],
  onOpenRelatedWork,
  mergeCandidates = [],
  onPortfolioChanged,
}: ProjectDossierProps) => {
  const [brief, setBrief] = useState<ProjectBrief | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [request, setRequest] = useState(0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleState, setTitleState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [dispositionState, setDispositionState] = useState<
    'idle' | 'saving' | 'error'
  >('idle');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergePreview, setMergePreview] = useState<ProjectBrief | null>(null);
  const [mergePreviewLoading, setMergePreviewLoading] = useState(false);
  const [mergeState, setMergeState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [lastMerged, setLastMerged] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [aliasSuggestions, setAliasSuggestions] = useState<
    EntityAliasSuggestion[]
  >([]);
  const [dreamingState, setDreamingState] = useState<DreamingUiStatus>('idle');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus();
  }, [editingTitle]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    getProjectBrief(projectId)
      .then((next) => {
        if (!active) return;
        setBrief(next);
        setLoadedProjectId(projectId);
        setTitleDraft(next?.project.displayTitle || projectName || 'Project');
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    getEntityAliasSuggestions(projectId)
      .then((suggestions) => {
        if (active) setAliasSuggestions(suggestions);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [projectId, projectName, request]);

  const handleDreamNow = async () => {
    setDreamingState('running');
    try {
      const result = await triggerDreamingNow({
        entityId: projectId,
      });
      if (result.status === 'proposed') {
        setRequest((r) => r + 1);
        const updatedAliases = await getEntityAliasSuggestions(projectId);
        setAliasSuggestions(updatedAliases);
        setDreamingState('proposed');
      } else {
        setDreamingState(result.status);
      }
    } catch {
      setDreamingState('error');
    }
  };

  const handleMergeAlias = async (suggestion: EntityAliasSuggestion) => {
    try {
      await addProjectAlias(projectId, suggestion.suggested_name);
      await updateEntityAliasSuggestionStatus(suggestion.id, 'merged');
      setAliasSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      await onPortfolioChanged?.();
      setRequest((r) => r + 1);
    } catch {
      // keep suggestion on error
    }
  };

  const handleDismissAlias = async (suggestion: EntityAliasSuggestion) => {
    try {
      await updateEntityAliasSuggestionStatus(suggestion.id, 'dismissed');
      await recordEntityCorrection({
        entityId: projectId,
        itemType: 'alias',
        fingerprint: suggestion.suggested_name,
        reason: 'dismissed_by_user',
      });
      setAliasSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
    } catch {
      // keep suggestion on error
    }
  };

  const current = loadedProjectId === projectId ? brief : null;
  const qualification = readProjectQualification(current?.project.metadata);
  const projectOutcome =
    current?.theme?.outcome ||
    qualification?.outcome ||
    'Pluto has not established a durable outcome for this suggestion.';
  const projectCurrentFocus =
    current?.theme?.currentFocus ||
    qualification?.outcome ||
    current?.meetings[0]?.context ||
    'Review the source conversation and decide whether this belongs in your portfolio.';
  const currentFocusRepeatsOutcome =
    normalizeProjectCopy(projectCurrentFocus) ===
    normalizeProjectCopy(projectOutcome);
  const isSuggestion =
    Boolean(current) &&
    !current?.theme &&
    current?.meetingStats.meetingCount === 1 &&
    qualification?.source !== 'user';
  const selectedMergeSource = useMemo(
    () => mergeCandidates.find((candidate) => candidate.id === mergeSourceId),
    [mergeCandidates, mergeSourceId],
  );
  const eligibleMergeCandidates = mergeCandidates.filter(
    (candidate) => candidate.id !== current?.project.id,
  );

  useEffect(() => {
    let active = true;
    setMergePreview(null);
    if (!mergeSourceId) return () => undefined;
    setMergePreviewLoading(true);
    getProjectBrief(mergeSourceId)
      .then((next) => {
        if (active) setMergePreview(next);
      })
      .finally(() => {
        if (active) setMergePreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mergeSourceId]);

  const saveTitle = async () => {
    const title = titleDraft.trim();
    if (!current || !title || title === current.project.displayTitle) {
      setEditingTitle(false);
      setTitleDraft(current?.project.displayTitle || projectName || 'Project');
      return;
    }
    setTitleState('saving');
    try {
      await updateProjectDisplayTitle(current.project.id, title);
      setBrief({
        ...current,
        project: { ...current.project, displayTitle: title },
      });
      setEditingTitle(false);
      setTitleState('saved');
      await onPortfolioChanged?.();
    } catch {
      setTitleState('error');
    }
  };

  const setDisposition = async (disposition: 'confirmed' | 'dismissed') => {
    if (!current) return;
    setDispositionState('saving');
    try {
      await setProjectPortfolioDisposition(current.project.id, disposition);
      await onPortfolioChanged?.();
      if (disposition === 'dismissed') onBack();
      else setRequest((value) => value + 1);
      setDispositionState('idle');
    } catch {
      setDispositionState('error');
    }
  };

  const performMerge = async () => {
    if (!current || !selectedMergeSource) return;
    setMergeState('saving');
    try {
      await mergeProject(selectedMergeSource.id, current.project.id);
      setLastMerged({
        id: selectedMergeSource.id,
        name: selectedMergeSource.name,
      });
      setMergeState('saved');
      setMergeOpen(false);
      setMergeSourceId('');
      await onPortfolioChanged?.();
      setRequest((value) => value + 1);
    } catch {
      setMergeState('error');
    }
  };

  const undoMerge = async () => {
    if (!lastMerged) return;
    setMergeState('saving');
    try {
      await restoreProjectMerge(lastMerged.id);
      setLastMerged(null);
      setMergeState('idle');
      await onPortfolioChanged?.();
      setRequest((value) => value + 1);
    } catch {
      setMergeState('error');
    }
  };

  const restoreMergedProject = async (id: string) => {
    setMergeState('saving');
    try {
      await restoreProjectMerge(id);
      setMergeState('idle');
      await onPortfolioChanged?.();
      setRequest((value) => value + 1);
    } catch {
      setMergeState('error');
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1080px] pb-16 text-pro-text-main">
      <div className="mb-8 flex items-center justify-between gap-4">
        <button type="button" onClick={onBack} className={quietButton}>
          ← Back to projects
        </button>
        <details className="relative">
          <summary className={`${quietButton} cursor-pointer list-none`}>
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
            More
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-pro-border bg-pro-bg p-1 shadow-lg">
            {isSuggestion && (
              <>
                <button
                  type="button"
                  disabled={dispositionState === 'saving'}
                  onClick={() => void setDisposition('confirmed')}
                  className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
                >
                  <Check aria-hidden="true" className="h-3.5 w-3.5" />
                  Keep as project
                </button>
                <button
                  type="button"
                  disabled={dispositionState === 'saving'}
                  onClick={() => void setDisposition('dismissed')}
                  className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
                >
                  Dismiss suggestion
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setEditingTitle(true);
                setTitleState('idle');
              }}
              className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
            >
              <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
              Rename project
            </button>
            <button
              type="button"
              disabled={!eligibleMergeCandidates.length}
              onClick={() => {
                setMergeOpen(true);
                setMergeState('idle');
              }}
              className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
            >
              Merge another project
            </button>
            <button
              type="button"
              disabled={dreamingState === 'running'}
              onClick={() => void handleDreamNow()}
              className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
            >
              {DREAMING_STATUS_LABEL[dreamingState]}
            </button>
          </div>
        </details>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-8 flex flex-wrap items-center gap-3 text-sm text-pro-text-muted"
        >
          <p>
            {current
              ? 'Pluto couldn’t refresh this project. The last reliable briefing is still here.'
              : 'Pluto couldn’t load this project.'}
          </p>
          <button
            type="button"
            onClick={() => setRequest((value) => value + 1)}
            className={quietButton}
          >
            Retry project
          </button>
        </div>
      )}

      {loading && !current && (
        <div
          aria-busy="true"
          aria-label="Loading project"
          className="space-y-5 motion-safe:animate-pulse"
        >
          <div className="h-8 w-2/3 rounded bg-pro-border/30" />
          <div className="h-4 w-full rounded bg-pro-border/20" />
          <div className="h-4 w-4/5 rounded bg-pro-border/20" />
        </div>
      )}

      {!loading && !current && !error && (
        <p className="text-pro-text-muted">
          This project is no longer available.
        </p>
      )}

      {current && (
        <>
          {aliasSuggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              role="alert"
              className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-pro-accent/30 bg-pro-accent/[0.04] p-3.5 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-pro-accent">
                  💡 Suggested Alias:
                </span>
                <span>
                  Recent meetings refer to this project as{' '}
                  <strong>"{suggestion.suggested_name}"</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleMergeAlias(suggestion)}
                  className="rounded bg-pro-accent px-3 py-1 text-xs font-medium text-white hover:bg-pro-accent/90"
                >
                  Merge
                </button>
                <button
                  type="button"
                  onClick={() => void handleDismissAlias(suggestion)}
                  className="rounded border border-pro-border px-3 py-1 text-xs text-pro-text-muted hover:text-pro-text-main"
                >
                  Keep Separate
                </button>
              </div>
            </div>
          ))}
          <header className="mb-9">
            {editingTitle ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveTitle();
                }}
                className="max-w-[65ch]"
              >
                <label
                  htmlFor="project-display-title"
                  className="mb-2 block text-xs font-medium text-pro-text-muted"
                >
                  Project title
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={titleInputRef}
                    id="project-display-title"
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setEditingTitle(false);
                        setTitleDraft(current.project.displayTitle);
                      }
                    }}
                    className="min-w-0 flex-1 rounded-md border border-pro-accent/60 bg-transparent px-3 py-2 font-serif text-2xl outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/30"
                  />
                  <button
                    type="submit"
                    disabled={!titleDraft.trim() || titleState === 'saving'}
                    className={quietButton}
                  >
                    {titleState === 'saving' ? 'Saving…' : 'Save title'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTitle(false);
                      setTitleDraft(current.project.displayTitle);
                    }}
                    className={quietButton}
                  >
                    Keep current title
                  </button>
                </div>
                {titleState === 'error' && (
                  <p role="alert" className="mt-2 text-sm text-pro-urgent">
                    Pluto couldn’t save this title. The current title is
                    unchanged.
                  </p>
                )}
              </form>
            ) : (
              <div className="group flex items-start gap-2">
                <h1 className="max-w-[26ch] font-serif text-[32px] font-medium leading-tight tracking-[-0.01em]">
                  {current.project.displayTitle}
                </h1>
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  aria-label="Edit project title"
                  className="mt-1.5 min-h-10 min-w-10 rounded p-2 text-pro-text-muted opacity-70 transition-opacity hover:text-pro-text-main focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            )}
            {!currentFocusRepeatsOutcome && (
              <p className="mt-3 max-w-[65ch] text-base leading-relaxed text-pro-text-muted">
                {projectOutcome}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-pro-text-muted">
              <span>
                {current.meetingStats.meetingCount} conversation
                {current.meetingStats.meetingCount === 1 ? '' : 's'}
              </span>
              {current.momentum.lastActivityAt && (
                <span>
                  Last discussed {formatDate(current.momentum.lastActivityAt)}
                </span>
              )}
            </div>
            {titleState === 'saved' && !editingTitle && (
              <output className="mt-2 flex items-center gap-1.5 text-xs text-pro-success">
                <Check aria-hidden="true" className="h-3.5 w-3.5" /> Title saved
              </output>
            )}
          </header>

          {isSuggestion && (
            <section
              aria-labelledby="review-suggestion"
              className="mb-10 rounded-xl border border-pro-border/60 bg-pro-bg-elevated/30 p-5 sm:p-6"
            >
              <p className="text-xs font-medium text-pro-text-muted">
                Review suggestion
              </p>
              <h2 id="review-suggestion" className="mt-2 text-lg font-semibold">
                One conversation supports this suggestion
              </h2>
              <p className="mt-2 max-w-[65ch] text-sm leading-6 text-pro-text-muted">
                Keep it if this reflects real ongoing work. Dismiss it if the
                conversation described a task, example, or temporary plan.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={dispositionState === 'saving'}
                  onClick={() => void setDisposition('confirmed')}
                  className="min-h-10 rounded-md bg-pro-accent px-4 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-40"
                >
                  Keep as project
                </button>
                <button
                  type="button"
                  disabled={dispositionState === 'saving'}
                  onClick={() => void setDisposition('dismissed')}
                  className={quietButton}
                >
                  Dismiss suggestion
                </button>
              </div>
              {dispositionState === 'error' && (
                <p role="alert" className="mt-3 text-sm text-pro-urgent">
                  Pluto couldn’t save that choice. The suggestion is unchanged.
                </p>
              )}
            </section>
          )}

          <div className="space-y-12">
            <section
              aria-labelledby="project-current-focus"
              className="border-y border-pro-border/45 py-7"
            >
              <p className="text-xs font-medium uppercase tracking-[0.1em] text-pro-text-muted">
                Current focus
              </p>
              <h2
                id="project-current-focus"
                className="mt-3 max-w-[46ch] text-xl font-semibold leading-snug"
              >
                {projectCurrentFocus}
              </h2>
            </section>

            {current.theme?.recentChanges.length ? (
              <section aria-labelledby="project-recent-changes">
                <h2
                  id="project-recent-changes"
                  className="text-lg font-semibold"
                >
                  Since last time
                </h2>
                <ol className="mt-4 divide-y divide-pro-border/40 border-y border-pro-border/45">
                  {current.theme.recentChanges.map((change) => (
                    <li
                      key={`${change.sourceMeetingId}-${change.summary}`}
                      className="py-4"
                    >
                      <p className="max-w-[68ch] text-sm leading-6">
                        {change.summary}
                      </p>
                      <p className="mt-1.5 text-xs text-pro-text-muted">
                        From{' '}
                        {current.meetings.find(
                          (meeting) => meeting.id === change.sourceMeetingId,
                        )?.title || 'a linked conversation'}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            <section aria-labelledby="project-open-threads">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h2
                    id="project-open-threads"
                    className="text-lg font-semibold"
                  >
                    Open threads
                  </h2>
                  <p className="mt-1 text-xs text-pro-text-muted">
                    Decisions, actions, questions, and confirmed commitments.
                  </p>
                </div>
              </div>
              {current.theme?.openThreads.length ? (
                <ul className="mt-4 divide-y divide-pro-border/40 border-y border-pro-border/45">
                  {current.theme.openThreads.map((thread) => (
                    <li
                      key={`${thread.sourceMeetingId}-${thread.kind}-${thread.text}`}
                      className="grid gap-1 py-4 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-4"
                    >
                      <span className="text-xs capitalize text-pro-text-muted">
                        {thread.kind}
                      </span>
                      <span className="text-sm leading-6">{thread.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 border-y border-pro-border/40 py-4 text-sm leading-6 text-pro-text-muted">
                  No open decisions or questions are established in the linked
                  notes yet.
                </p>
              )}
              <ProjectCommitments
                key={projectId}
                projectId={projectId}
                defaultOpen={false}
              />
            </section>

            <section aria-labelledby="project-conversation-history">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2
                  id="project-conversation-history"
                  className="text-lg font-semibold"
                >
                  Conversation history
                </h2>
                <span className="text-xs text-pro-text-muted">
                  {current.meetings.length} linked
                </span>
              </div>
              <div className="mt-4 divide-y divide-pro-border/40 border-y border-pro-border/45">
                {current.meetings.map((meeting) => (
                  <article
                    key={meeting.id}
                    className="grid gap-2 py-4 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-5"
                  >
                    <p className="text-xs tabular-nums text-pro-text-muted">
                      {formatDate(meeting.started_at || meeting.created_at)}
                    </p>
                    <div>
                      {onOpenMeeting ? (
                        <button
                          type="button"
                          onClick={() => onOpenMeeting(meeting.id)}
                          className="rounded text-left text-sm font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
                        >
                          {meeting.title || 'Untitled meeting'}{' '}
                          <span
                            aria-hidden="true"
                            className="text-pro-text-muted"
                          >
                            ↗
                          </span>
                        </button>
                      ) : (
                        <h3 className="text-sm font-medium">
                          {meeting.title || 'Untitled meeting'}
                        </h3>
                      )}
                      {meeting.context && (
                        <p className="mt-1.5 max-w-[65ch] text-sm leading-6 text-pro-text-muted">
                          {meeting.context}
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <ProjectMilestones
              projectId={current.project.id}
              milestones={current.milestones}
              onChange={(milestones) =>
                setBrief((value) => (value ? { ...value, milestones } : value))
              }
            />

            {relatedWork.length > 0 && (
              <section aria-labelledby="project-related-work">
                <h2 id="project-related-work" className="text-lg font-semibold">
                  Related work
                </h2>
                <ul className="mt-4 divide-y divide-pro-border/40 border-y border-pro-border/45">
                  {relatedWork.map((entry) => (
                    <li key={entry.id} className="py-4">
                      {onOpenRelatedWork ? (
                        <button
                          type="button"
                          onClick={() => onOpenRelatedWork(entry.id)}
                          className="rounded text-left text-sm font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
                        >
                          {entry.name}
                        </button>
                      ) : (
                        <p className="text-sm font-medium">{entry.name}</p>
                      )}
                      {entry.latest_context && (
                        <p className="mt-1 text-sm leading-6 text-pro-text-muted">
                          {entry.latest_context}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <details className="group border-y border-pro-border/45 text-sm">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded py-3 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent">
                <span>Activity signals</span>
                <span className="font-normal text-pro-text-muted">
                  Optional context
                </span>
              </summary>
              <dl className="grid gap-4 border-t border-pro-border/35 py-5 text-pro-text-muted sm:grid-cols-3">
                <div>
                  <dt className="text-xs">Recent conversations</dt>
                  <dd className="mt-1 font-medium text-pro-text-main">
                    {current.momentum.recentMeetingCount} in 30 days
                  </dd>
                </div>
                <div>
                  <dt className="text-xs">Confirmed commitments</dt>
                  <dd className="mt-1 font-medium text-pro-text-main">
                    {current.momentum.openCommitmentCount} open,{' '}
                    {current.momentum.completedCommitmentCount} completed
                  </dd>
                </div>
                <div>
                  <dt className="text-xs">Evidence read</dt>
                  <dd className="mt-1 font-medium text-pro-text-main">
                    {current.health.state === 'not_enough_evidence'
                      ? 'No health claim'
                      : current.health.headline}
                  </dd>
                </div>
              </dl>
            </details>

            <details className="border-t border-pro-border/50 pt-5 text-sm text-pro-text-muted">
              <summary className="min-h-10 cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent">
                Project identity and evidence
              </summary>
              <div className="mt-4 space-y-3 leading-6">
                <p>
                  <span className="font-medium text-pro-text-main">
                    Detected as:
                  </span>{' '}
                  {current.project.detectedTitle}
                </p>
                {qualification?.reason && <p>{qualification.reason}</p>}
                {current.mergedProjects.length > 0 && (
                  <div>
                    <p className="font-medium text-pro-text-main">
                      Merged project history
                    </p>
                    <ul className="mt-2 divide-y divide-pro-border/40 border-y border-pro-border/40">
                      {current.mergedProjects.map((project) => (
                        <li
                          key={project.id}
                          className="flex items-center justify-between gap-4 py-2"
                        >
                          <span>{project.name}</span>
                          <button
                            type="button"
                            disabled={mergeState === 'saving'}
                            onClick={() =>
                              void restoreMergedProject(project.id)
                            }
                            className="rounded font-medium text-pro-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
                          >
                            Undo merge
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          </div>

          {mergeOpen && (
            <section
              aria-labelledby="merge-project-heading"
              className="mt-12 border-y border-pro-border/60 py-6"
            >
              <h2 id="merge-project-heading" className="text-lg font-semibold">
                Merge another project into {current.project.displayTitle}
              </h2>
              <p className="mt-2 max-w-[65ch] text-sm leading-6 text-pro-text-muted">
                Meetings, commitments, aliases, and source evidence will appear
                together. The original project record is retained and the merge
                can be undone.
              </p>
              <label
                htmlFor="merge-project-source"
                className="mt-5 block text-xs font-medium text-pro-text-muted"
              >
                Project to merge
              </label>
              <select
                id="merge-project-source"
                value={mergeSourceId}
                onChange={(event) => setMergeSourceId(event.target.value)}
                className="mt-2 w-full rounded-md border border-pro-border bg-pro-bg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40"
              >
                <option value="">Choose a project</option>
                {eligibleMergeCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
              {selectedMergeSource && (
                <div className="mt-5 border-y border-pro-border/40 py-4 text-sm">
                  <p className="font-medium">Merge preview</p>
                  {mergePreviewLoading && (
                    <p className="mt-2 text-pro-text-muted">
                      Checking conversations, milestones, and commitments…
                    </p>
                  )}
                  {mergePreview && (
                    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-pro-text-muted sm:grid-cols-4">
                      <div>
                        <dt className="text-xs">Meeting references</dt>
                        <dd className="mt-1 font-medium text-pro-text-main">
                          {current.meetingStats.meetingCount +
                            mergePreview.meetingStats.meetingCount}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs">Milestones</dt>
                        <dd className="mt-1 font-medium text-pro-text-main">
                          {current.milestones.length +
                            mergePreview.milestones.length}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs">Commitments</dt>
                        <dd className="mt-1 font-medium text-pro-text-main">
                          {current.tasks.length + mergePreview.tasks.length}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs">Preserved alias</dt>
                        <dd className="mt-1 font-medium text-pro-text-main">
                          {mergePreview.project.displayTitle}
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>
              )}
              {mergeState === 'error' && (
                <p role="alert" className="mt-4 text-sm text-pro-urgent">
                  Pluto couldn’t merge these projects. Both projects are
                  unchanged.
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!selectedMergeSource || mergeState === 'saving'}
                  onClick={() => void performMerge()}
                  className="min-h-10 rounded-md bg-pro-accent px-4 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-40"
                >
                  {mergeState === 'saving'
                    ? 'Merging…'
                    : selectedMergeSource
                      ? `Merge ${selectedMergeSource.name}`
                      : 'Choose a project'}
                </button>
                <button
                  type="button"
                  onClick={() => setMergeOpen(false)}
                  className={quietButton}
                >
                  Keep projects separate
                </button>
              </div>
            </section>
          )}

          {lastMerged && (
            <div
              aria-live="polite"
              className="fixed bottom-6 right-6 z-50 flex max-w-sm items-center gap-4 rounded-lg border border-pro-border bg-pro-bg px-4 py-3 text-sm shadow-lg"
            >
              <span>{lastMerged.name} was merged into this project.</span>
              <button
                type="button"
                disabled={mergeState === 'saving'}
                onClick={() => void undoMerge()}
                className="rounded font-medium text-pro-accent underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
              >
                Undo
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
