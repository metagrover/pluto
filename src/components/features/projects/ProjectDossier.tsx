import { Check, MoreHorizontal, Pencil, Star, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteEntity,
  detachTopicFromProject,
  discoverProjectInitiative,
  getProjectBrief,
  mergeProject,
  restoreProjectMerge,
  setProjectPortfolioDisposition,
  triggerDreamingNow,
  updateProjectDisplayTitle,
  upsertEntity,
} from '../../../api/knowledgeGraph';
import {
  DREAMING_STATUS_LABEL,
  type DreamingUiStatus,
} from '../../../utils/dreamingStatus';
import type { ProjectBrief } from '../../../utils/projectBriefing';
import { detectProjectCadence } from '../../../utils/projectCadence';
import {
  type ProjectPortfolioEntry,
  getProjectActivityState,
  isProjectStarred,
  readProjectCadence,
} from '../../../utils/projectPortfolio';
import { readProjectQualification } from '../../../utils/projectQualification';
import { SearchSelect } from '../../ui/SearchSelect';
import { ProjectMilestones } from './ProjectMilestones';
import { ProjectProfileContent } from './ProjectProfileContent';

interface ProjectDossierProps {
  projectId: string;
  projectName?: string;
  onBack: () => void;
  onOpenMeeting?: (id: string) => void;
  onOpenPerson?: (id: string) => void;
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

export const ProjectDossier = ({
  projectId,
  projectName,
  onBack,
  onOpenMeeting,
  onOpenPerson,
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
  const [dreamingState, setDreamingState] = useState<DreamingUiStatus>('idle');
  const [isDeleting, setIsDeleting] = useState(false);
  const prepareGeneration = useRef(0);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const moreDetailsRef = useRef<HTMLDetailsElement>(null);
  const mergeSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus();
  }, [editingTitle]);

  useEffect(() => {
    prepareGeneration.current += 1;
    setDreamingState('idle');
  }, [projectId]);

  useEffect(
    () => () => {
      prepareGeneration.current += 1;
    },
    [],
  );

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

    return () => {
      active = false;
    };
  }, [projectId, projectName, request]);

  useEffect(
    () =>
      window.ipcRenderer?.on('MEETING_NOTES_UPDATED', () =>
        setRequest((value) => value + 1),
      ),
    [],
  );

  const handleDreamNow = async () => {
    const generation = ++prepareGeneration.current;
    const preparedProjectId = projectId;
    setDreamingState('running');
    try {
      const synthesis = await discoverProjectInitiative({ retryFailed: true });
      if (generation !== prepareGeneration.current) return;
      if (synthesis.discovered > 0) setRequest((r) => r + 1);
      const result = await triggerDreamingNow({
        entityId: preparedProjectId,
      });
      if (
        generation !== prepareGeneration.current ||
        preparedProjectId !== projectId
      )
        return;
      if (result.status === 'proposed' || result.status === 'existing') {
        setRequest((r) => r + 1);
        setDreamingState(result.status);
      } else {
        setDreamingState(result.status);
      }
    } catch {
      if (
        generation === prepareGeneration.current &&
        preparedProjectId === projectId
      )
        setDreamingState('error');
    }
  };

  const current = loadedProjectId === projectId ? brief : null;

  const detectedCadence = useMemo(() => {
    return detectProjectCadence({
      meetings: current?.meetings ?? [],
      recurringSeries: current?.meetingStats.recurringSeries ?? [],
      manualOverride: readProjectCadence(current?.project.metadata),
    });
  }, [
    current?.meetings,
    current?.meetingStats.recurringSeries,
    current?.project.metadata,
  ]);

  const activityState = useMemo(() => {
    return getProjectActivityState(
      current?.momentum.lastActivityAt ||
        (current?.meetings[0]?.started_at ??
          current?.meetings[0]?.created_at) ||
        null,
      Date.now(),
      detectedCadence.cadence,
    );
  }, [
    current?.momentum.lastActivityAt,
    current?.meetings,
    detectedCadence.cadence,
  ]);

  const qualification = readProjectQualification(current?.project.metadata);
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

  useEffect(() => {
    if (mergeOpen) {
      requestAnimationFrame(() => {
        mergeSectionRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
    }
  }, [mergeOpen]);

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

  const handleDeleteProject = async () => {
    if (!current || isDeleting) return;
    const title = current.project.displayTitle;
    const confirmed = window.confirm(
      `Are you sure you want to delete "${title}"? This will remove this project and its milestones, and cannot be undone.`,
    );
    if (!confirmed) return;
    setIsDeleting(true);
    try {
      await deleteEntity(projectId);
      await onPortfolioChanged?.();
      onBack();
    } catch (err) {
      console.error('Failed to delete project:', err);
    } finally {
      setIsDeleting(false);
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

  const isStarred = isProjectStarred(brief?.project.metadata);

  const toggleStar = async () => {
    if (!brief?.project) return;
    const nextStarred = !isStarred;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(brief.project.metadata || '{}');
    } catch {}
    try {
      await upsertEntity({
        id: brief.project.id,
        type: 'project',
        name: brief.project.detectedTitle || brief.project.displayTitle,
        metadata: {
          ...parsed,
          projectStarred: nextStarred,
          projectStarredUpdatedAt: new Date().toISOString(),
        },
      });
      await onPortfolioChanged?.();
      setRequest((val) => val + 1);
    } catch (err) {
      console.error('Failed to toggle star in dossier:', err);
    }
  };

  return (
    <div
      className="project-reading-surface mx-auto w-full max-w-[1060px] pb-16 text-pro-text-main"
      data-reading-surface="project-dossier"
    >
      <div className="mb-8 flex items-center justify-between gap-4">
        <button type="button" onClick={onBack} className={quietButton}>
          ← Back to projects
        </button>
        <div className="flex items-center gap-2.5">
          {dreamingState !== 'idle' ? (
            <div
              className="flex items-center gap-2 rounded-full border border-pro-border/70 bg-pro-surface/60 px-3 py-1 text-xs font-medium text-pro-text-muted"
              aria-live="polite"
            >
              {dreamingState === 'running' ? (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-pro-accent animate-pulse"
                  aria-hidden="true"
                />
              ) : null}
              <span>{DREAMING_STATUS_LABEL[dreamingState]}</span>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void toggleStar()}
            title={
              isStarred ? 'Remove from primary focus' : 'Star as primary focus'
            }
            aria-label={isStarred ? 'Unstar project' : 'Star project'}
            className={`${quietButton} ${
              isStarred
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300 font-semibold'
                : ''
            }`}
          >
            <Star
              className={`h-3.5 w-3.5 ${
                isStarred
                  ? 'fill-amber-400 text-amber-500'
                  : 'text-pro-text-muted'
              }`}
            />
            <span>{isStarred ? 'Primary Focus' : 'Star'}</span>
          </button>
          <details ref={moreDetailsRef} className="relative">
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
                  if (moreDetailsRef.current) {
                    moreDetailsRef.current.open = false;
                  }
                }}
                className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
              >
                Merge another project
              </button>
              {current?.mergedProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  disabled={mergeState === 'saving'}
                  onClick={() => void restoreMergedProject(project.id)}
                  className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
                >
                  Restore {project.name}
                </button>
              ))}
              <button
                type="button"
                disabled={dreamingState === 'running'}
                onClick={() => void handleDreamNow()}
                className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
              >
                {DREAMING_STATUS_LABEL[dreamingState]}
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  if (moreDetailsRef.current) {
                    moreDetailsRef.current.open = false;
                  }
                  void handleDeleteProject();
                }}
                className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
              >
                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                Delete project
              </button>
            </div>
          </details>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-8 flex flex-wrap items-center gap-3 text-sm text-pro-text-muted"
        >
          <p>
            {current
              ? 'Pluto couldn’t refresh this project. The previous summary is still here.'
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
          <header className="mb-10">
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
                    className="project-dossier-title min-w-0 flex-1 rounded-md border border-pro-accent/60 bg-transparent px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/30"
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
                <h1 className="project-dossier-title">
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
            <div className="project-dossier-meta mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                  activityState.state === 'active'
                    ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-300'
                    : activityState.state === 'dormant'
                      ? 'border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-300'
                      : 'border border-stone-500/30 bg-stone-500/10 text-stone-700 dark:text-stone-300'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    activityState.state === 'active'
                      ? 'bg-emerald-500'
                      : activityState.state === 'dormant'
                        ? 'bg-amber-500'
                        : 'bg-stone-400'
                  }`}
                  aria-hidden="true"
                />
                {activityState.label}
              </span>
              <span>
                {current.meetingStats.meetingCount} meeting
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
                Pluto found this in one meeting
              </h2>
              <p className="mt-2 max-w-[65ch] text-sm leading-6 text-pro-text-muted">
                Keep it if this is ongoing work. Dismiss it if it was only a
                one-time topic or task.
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

          <ProjectProfileContent
            key={current.project.id}
            brief={current}
            onPrepareUpdates={() => void handleDreamNow()}
            preparationState={dreamingState}
            relatedWork={relatedWork}
            onOpenMeeting={onOpenMeeting}
            onOpenPerson={onOpenPerson}
            onOpenRelatedWork={onOpenRelatedWork}
            onDetachWork={async (id) => {
              await detachTopicFromProject(id);
              await onPortfolioChanged?.();
              setRequest((value) => value + 1);
            }}
            milestones={
              <ProjectMilestones
                projectId={current.project.id}
                milestones={current.milestones}
                evidenceMeetings={current.meetings.map((meeting) => ({
                  id: meeting.id,
                  title: meeting.title,
                  date: meeting.started_at || meeting.created_at,
                }))}
                onOpenMeeting={onOpenMeeting}
                onChange={(milestones) =>
                  setBrief((value) =>
                    value ? { ...value, milestones } : value,
                  )
                }
              />
            }
          />

          {mergeOpen && (
            <section
              ref={mergeSectionRef}
              aria-labelledby="merge-project-heading"
              className="mt-12 rounded-xl border border-pro-accent/40 bg-pro-surface/40 p-6 shadow-sm ring-1 ring-pro-accent/20"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2
                    id="merge-project-heading"
                    className="text-lg font-semibold text-pro-text-main"
                  >
                    Merge another project into {current.project.displayTitle}
                  </h2>
                  <p className="mt-1.5 max-w-[65ch] text-sm leading-6 text-pro-text-muted">
                    Meetings, commitments, and alternate names will appear
                    together. The original project is kept, and the merge can be
                    undone.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMergeOpen(false)}
                  aria-label="Close merge section"
                  className="rounded-lg p-1.5 text-pro-text-muted transition-colors hover:bg-pro-hover hover:text-pro-text-main"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              <label
                htmlFor="merge-project-source"
                className="mt-5 block text-xs font-medium text-pro-text-muted"
              >
                Project to merge
              </label>
              <SearchSelect
                id="merge-project-source"
                value={mergeSourceId}
                ariaLabel="Project to merge"
                onValueChange={setMergeSourceId}
                placeholder="Choose a project"
                searchPlaceholder="Search projects…"
                options={eligibleMergeCandidates.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.name,
                }))}
                className="mt-2"
              />
              {selectedMergeSource && (
                <div className="mt-5 border-y border-pro-border/40 py-4 text-sm">
                  <p className="font-medium">Merge preview</p>
                  {mergePreviewLoading && (
                    <p className="mt-2 text-pro-text-muted">
                      Checking meetings, milestones, and commitments…
                    </p>
                  )}
                  {mergePreview && (
                    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-pro-text-muted sm:grid-cols-4">
                      <div>
                        <dt className="text-xs">Meetings</dt>
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
                        <dt className="text-xs">Alternate name</dt>
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
