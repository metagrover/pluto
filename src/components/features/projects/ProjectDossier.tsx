import {
  Activity,
  Check,
  MoreHorizontal,
  Pencil,
  Repeat2,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getProjectBrief,
  mergeProject,
  restoreProjectMerge,
  setProjectPortfolioDisposition,
  triggerDreamingNow,
  updateProjectDisplayTitle,
} from '../../../api/knowledgeGraph';
import {
  DREAMING_STATUS_LABEL,
  type DreamingUiStatus,
} from '../../../utils/dreamingStatus';
import type { ProjectBrief } from '../../../utils/projectBriefing';
import type { ProjectPortfolioEntry } from '../../../utils/projectPortfolio';
import { readProjectQualification } from '../../../utils/projectQualification';
import { SearchSelect } from '../../ui/SearchSelect';
import { ProjectMilestones } from './ProjectMilestones';

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
const statCard =
  'project-dossier-stat-card flex min-h-24 min-w-0 flex-col justify-between rounded-xl border p-4';

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

const getPersonInitials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1))
    .join('')
    .toLocaleUpperCase();

const getPersonFunctionTag = (role: string | undefined): string | null => {
  const normalized = role?.trim().toLocaleLowerCase();
  if (!normalized) return null;
  if (/\b(?:project|program|programme)\s+lead(?:er)?\b/.test(normalized))
    return 'Project lead';
  if (/\b(?:executive|exec|project)\s+sponsor\b/.test(normalized))
    return 'Executive sponsor';
  if (
    /\b(?:project|program|programme)\s+(?:manager|management|director)\b|\bpmo\b/.test(
      normalized,
    )
  )
    return 'Project management';
  if (
    /\b(?:ai|engineer|engineering|developer|machine learning|software|technical|technology|data)\b/.test(
      normalized,
    )
  )
    return 'Engineering';
  if (/\b(?:product|product management)\b/.test(normalized)) return 'Product';
  if (/\b(?:design|designer|ux|user research)\b/.test(normalized))
    return 'Design';
  if (/\b(?:marketing|growth|communications?)\b/.test(normalized))
    return 'Marketing';
  if (/\b(?:sales|account executive|business development)\b/.test(normalized))
    return 'Sales';
  if (/\b(?:operations|ops)\b/.test(normalized)) return 'Operations';
  if (/\b(?:finance|accounting)\b/.test(normalized)) return 'Finance';
  if (/\b(?:people|human resources|talent)\b/.test(normalized)) return 'People';
  if (/\b(?:legal|counsel)\b/.test(normalized)) return 'Legal';
  return null;
};

const healthTone: Record<ProjectBrief['health']['state'], string> = {
  appears_on_track: 'text-pro-success',
  watch: 'text-pro-warning',
  falling_behind: 'text-pro-urgent',
  not_enough_evidence: 'text-pro-text-muted',
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
  const [showAllPeople, setShowAllPeople] = useState(false);
  const prepareGeneration = useRef(0);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus();
  }, [editingTitle]);

  useEffect(() => {
    prepareGeneration.current += 1;
    setDreamingState('idle');
    setShowAllPeople(false);
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

  const handleDreamNow = async () => {
    const generation = ++prepareGeneration.current;
    const preparedProjectId = projectId;
    setDreamingState('running');
    try {
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
  const qualification = readProjectQualification(current?.project.metadata);
  const projectOutcome =
    current?.theme?.outcome ||
    qualification?.outcome ||
    'Pluto hasn’t found a clear goal for this project yet.';
  const projectCurrentFocus =
    current?.theme?.currentFocus ||
    qualification?.outcome ||
    current?.meetings[0]?.context ||
    'Review the first meeting and decide whether to keep this as a project.';
  const currentFocusRepeatsOutcome =
    normalizeProjectCopy(projectCurrentFocus) ===
    normalizeProjectCopy(projectOutcome);
  const attentionTasks =
    current?.tasks.filter((task) =>
      current.health.evidenceTaskIds.includes(task.id),
    ) ?? [];
  const projectHealthCopy = (() => {
    if (!current) return { headline: '', summary: '' };
    const count = attentionTasks.length;
    const item =
      count === 1 ? 'milestone or commitment' : 'milestones or commitments';
    if (current.health.state === 'falling_behind') {
      return {
        headline: 'Behind schedule',
        summary: `${count} ${item} ${count === 1 ? 'is' : 'are'} overdue.`,
      };
    }
    if (current.health.state === 'watch') {
      return count > 0
        ? {
            headline: 'Needs attention',
            summary: `${count} ${item} ${count === 1 ? 'is' : 'are'} due in the next two weeks.`,
          }
        : {
            headline: 'Needs attention',
            summary:
              'There are open risks or questions that need a closer look.',
          };
    }
    if (current.health.state === 'appears_on_track') {
      return {
        headline: 'On track',
        summary:
          count > 0
            ? `${count} ${item} ${count === 1 ? 'was' : 'were'} completed recently, and nothing is overdue.`
            : 'Recent progress looks on track, and nothing is overdue.',
      };
    }
    return {
      headline: 'Status not clear yet',
      summary:
        'There isn’t enough recent activity to tell whether this project is on track.',
    };
  })();
  const nextMilestone = current?.milestones.find(
    (milestone) => milestone.status !== 'complete',
  );
  const peopleInvolved = (() => {
    const people = new Map<
      string,
      {
        id: string;
        entityId: string;
        name: string;
        role?: string;
        meetingCount: number;
      }
    >();
    for (const meeting of current?.meetings ?? []) {
      const seen = new Set<string>();
      for (const participant of meeting.participants ?? []) {
        const name = participant.name.trim();
        const entityId = participant.entity_id.trim();
        const key = entityId || name.toLocaleLowerCase();
        if (
          !name ||
          participant.entity_id.toLocaleLowerCase().startsWith('speaker:') ||
          /^(?:none|unknown|n\/a)$/i.test(name) ||
          seen.has(key)
        )
          continue;
        seen.add(key);
        const existing = people.get(key);
        people.set(key, {
          id: key,
          entityId: existing?.entityId || entityId,
          name,
          role: existing?.role || participant.role?.trim() || undefined,
          meetingCount: (existing?.meetingCount ?? 0) + 1,
        });
      }
    }
    return [...people.values()].sort(
      (left, right) =>
        right.meetingCount - left.meetingCount ||
        left.name.localeCompare(right.name),
    );
  })();
  const displayedPeople = showAllPeople
    ? peopleInvolved
    : peopleInvolved.slice(0, 6);
  const activeAssignments = (current?.tasks ?? [])
    .flatMap((task) => {
      if (!task.assigned_to || task.status === 'completed') return [];
      const person = peopleInvolved.find(
        (candidate) => candidate.entityId === task.assigned_to,
      );
      return person ? [{ person, task }] : [];
    })
    .slice(0, 2);
  const projectActivitySummary = currentFocusRepeatsOutcome
    ? current?.theme?.recentChanges[0]?.summary ||
      current?.meetings[0]?.context ||
      `${current?.meetingStats.meetingCount ?? 0} meetings have covered this project so far.`
    : projectCurrentFocus;
  const rolePeople = peopleInvolved.filter((person) => person.role).slice(0, 3);
  const rolePeopleLabel = new Intl.ListFormat(undefined, {
    style: 'long',
    type: 'conjunction',
  }).format(rolePeople.map((person) => `${person.name} (${person.role})`));
  const projectPeopleSummary = activeAssignments.length
    ? activeAssignments
        .map(
          ({ person, task }) =>
            `${person.name} is responsible for ${task.name}`,
        )
        .join('; ')
    : rolePeople.length > 0
      ? `${rolePeopleLabel} ${rolePeople.length === 1 ? 'is' : 'are'} involved in this project.`
      : peopleInvolved.length > 0
        ? `${peopleInvolved.length} people have discussed this project in meetings.`
        : 'No people have been identified yet.';
  const primaryAttentionTask = attentionTasks[0];
  const projectWatchSummary = primaryAttentionTask
    ? `${primaryAttentionTask.name}${primaryAttentionTask.due_date ? `, due ${formatDate(primaryAttentionTask.due_date)}` : ''}, needs attention.`
    : nextMilestone
      ? `The next milestone is ${nextMilestone.title}${nextMilestone.timing ? `, expected ${nextMilestone.timing}` : ''}.`
      : 'No upcoming dates or commitments yet.';
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
    <div
      className="project-reading-surface mx-auto w-full max-w-[760px] pb-16 text-pro-text-main"
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
            <div className="project-dossier-meta mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
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

          <div className="space-y-20">
            <section aria-label="Project overview" className="py-1">
              <section aria-labelledby="project-about" className="min-w-0">
                <h2
                  id="project-about"
                  className="project-dossier-section-title mb-4"
                >
                  Project brief
                </h2>
                <p className="project-dossier-lead text-pro-text-main">
                  {projectOutcome}
                </p>
                <dl className="mt-6 max-w-[68ch] space-y-5">
                  <div className="grid min-w-0 gap-1 sm:grid-cols-[7.25rem_minmax(0,1fr)] sm:gap-6">
                    <dt className="project-dossier-property-label">
                      {currentFocusRepeatsOutcome
                        ? 'Latest update'
                        : 'Current focus'}
                    </dt>
                    <dd className="project-dossier-body min-w-0 text-pro-text-main">
                      {projectActivitySummary}
                    </dd>
                  </div>
                  <div className="grid min-w-0 gap-1 sm:grid-cols-[7.25rem_minmax(0,1fr)] sm:gap-6">
                    <dt className="project-dossier-property-label">
                      Who’s involved
                    </dt>
                    <dd className="project-dossier-body min-w-0 text-pro-text-main">
                      {projectPeopleSummary}
                      {activeAssignments.length > 0 ? '.' : ''}
                    </dd>
                  </div>
                  <div className="grid min-w-0 gap-1 sm:grid-cols-[7.25rem_minmax(0,1fr)] sm:gap-6">
                    <dt className="project-dossier-property-label">
                      Coming up
                    </dt>
                    <dd className="project-dossier-body min-w-0 text-pro-text-main">
                      {projectWatchSummary}
                    </dd>
                  </div>
                </dl>
              </section>

              <section
                aria-labelledby="project-health"
                className="project-dossier-health mt-14 rounded-2xl px-5 py-6 sm:px-6"
              >
                <div className="flex items-center gap-2">
                  <Activity
                    aria-hidden="true"
                    className="h-4 w-4 text-pro-text-muted"
                  />
                  <h2
                    id="project-health"
                    className="project-dossier-section-title"
                  >
                    Project health
                  </h2>
                </div>
                <p
                  className={`project-dossier-body mt-3 font-medium ${healthTone[current.health.state]}`}
                >
                  {projectHealthCopy.headline}
                </p>
                <p className="project-dossier-body mt-1 text-pro-text-main">
                  {projectHealthCopy.summary}
                </p>
                {attentionTasks.length > 0 && (
                  <ul className="mt-5 max-w-[68ch] divide-y divide-pro-border/40">
                    {attentionTasks.slice(0, 3).map((task) => (
                      <li key={task.id} className="break-words py-4">
                        <span className="text-base font-medium">
                          {task.name}
                        </span>
                        {task.due_date && (
                          <span className="mt-1 block text-[0.8rem] leading-5 text-pro-text-muted">
                            Due {formatDate(task.due_date)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {attentionTasks.length > 3 && (
                  <p className="mt-3 text-[0.8rem] leading-5 text-pro-text-muted">
                    {attentionTasks.length - 3} more flagged commitment
                    {attentionTasks.length - 3 === 1 ? '' : 's'} in more project
                    context
                  </p>
                )}
              </section>
            </section>

            <section aria-labelledby="project-at-a-glance">
              <h2
                id="project-at-a-glance"
                className="project-dossier-section-title"
              >
                At a glance
              </h2>
              <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <div className={`${statCard} lg:col-span-2`}>
                  <dt className="project-dossier-property-label">Meetings</dt>
                  <dd className="mt-4 break-words text-[17px] font-medium leading-6">
                    {current.meetingStats.meetingCount}
                    {current.meetingStats.activeWeeks !== null
                      ? ` over ${current.meetingStats.activeWeeks} week${current.meetingStats.activeWeeks === 1 ? '' : 's'}`
                      : ''}
                  </dd>
                </div>
                <div className={`${statCard} lg:col-span-2`}>
                  <dt className="project-dossier-property-label">
                    People involved
                  </dt>
                  <dd className="mt-4 break-words text-[17px] font-medium leading-6">
                    {peopleInvolved.length
                      ? `${peopleInvolved.length} people`
                      : 'No people yet'}
                  </dd>
                </div>
                <div className={`${statCard} lg:col-span-2`}>
                  <dt className="project-dossier-property-label">
                    Regular meetings
                  </dt>
                  <dd className="mt-4 break-words text-[17px] font-medium leading-6">
                    {current.meetingStats.recurringSeries[0]?.cadence ||
                      'No regular schedule'}
                  </dd>
                </div>
                <div className={`${statCard} lg:col-span-3`}>
                  <dt className="project-dossier-property-label">
                    Commitments
                  </dt>
                  <dd className="mt-4 break-words text-[17px] font-medium leading-6">
                    {current.momentum.openCommitmentCount} open ·{' '}
                    {current.momentum.completedCommitmentCount} completed
                  </dd>
                </div>
                <div className={`${statCard} sm:col-span-2 lg:col-span-3`}>
                  <dt className="project-dossier-property-label">
                    Next milestone
                  </dt>
                  <dd className="mt-4 break-words text-[17px] font-medium leading-6">
                    {nextMilestone
                      ? `${nextMilestone.title}${nextMilestone.timing ? ` · ${nextMilestone.timing}` : ''}`
                      : 'Nothing upcoming yet'}
                  </dd>
                </div>
              </dl>
            </section>

            {peopleInvolved.length > 0 && (
              <section aria-labelledby="project-people">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <h2
                      id="project-people"
                      className="project-dossier-section-title"
                    >
                      People involved
                    </h2>
                    <p className="project-dossier-meta mt-1">
                      People who have joined meetings about this project.
                    </p>
                  </div>
                  {current.meetingStats.typicalParticipantCount !== null && (
                    <span className="inline-flex items-center gap-2 text-xs text-pro-text-muted">
                      <Users aria-hidden="true" className="h-4 w-4" />
                      Usually {current.meetingStats.typicalParticipantCount}{' '}
                      people attend
                    </span>
                  )}
                </div>
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {displayedPeople.map((person) => {
                    const functionTag = getPersonFunctionTag(person.role);
                    return (
                      <li key={person.id} className="h-24 min-w-0">
                        <button
                          type="button"
                          data-person-card={person.name}
                          aria-label={`Open ${person.name}'s profile`}
                          disabled={!onOpenPerson || !person.entityId}
                          onClick={() => onOpenPerson?.(person.entityId)}
                          className="group flex h-full w-full min-w-0 items-start gap-3 rounded-xl border border-pro-border/55 bg-pro-bg-elevated/25 p-3 text-left transition-colors hover:border-pro-accent/25 hover:bg-pro-hover/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:cursor-default disabled:hover:border-pro-border/55 disabled:hover:bg-pro-bg-elevated/25"
                        >
                          <span
                            aria-hidden="true"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-pro-border/60 bg-pro-surface text-[11px] font-semibold text-pro-text-muted transition-colors group-hover:border-pro-accent/25 group-hover:text-pro-accent"
                          >
                            {getPersonInitials(person.name)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-pro-text-main">
                              {person.name}
                            </p>
                            {person.role && (
                              <p className="mt-0.5 truncate text-xs text-pro-text-muted">
                                {person.role}
                              </p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                              {functionTag && (
                                <span className="rounded-md border border-pro-accent/15 bg-pro-accent/5 px-1.5 py-0.5 font-medium text-pro-accent">
                                  {functionTag}
                                </span>
                              )}
                              <span className="text-pro-text-muted">
                                In {person.meetingCount} meeting
                                {person.meetingCount === 1 ? '' : 's'}
                              </span>
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {peopleInvolved.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setShowAllPeople((visible) => !visible)}
                    className="mt-3 min-h-9 rounded-md px-2 text-[0.8rem] font-medium text-pro-text-muted transition-colors hover:bg-pro-hover hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
                  >
                    {showAllPeople
                      ? 'Show fewer people'
                      : `Show ${peopleInvolved.length - 6} more`}
                  </button>
                )}
                {current.meetingStats.participantCoverage <
                  current.meetingStats.meetingCount && (
                  <p className="mt-3 text-xs text-pro-text-muted">
                    Attendee details are available for{' '}
                    {current.meetingStats.participantCoverage} of{' '}
                    {current.meetingStats.meetingCount} meetings.
                  </p>
                )}
              </section>
            )}

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
                setBrief((value) => (value ? { ...value, milestones } : value))
              }
            />

            {current.meetingStats.recurringSeries.length > 0 && (
              <section aria-labelledby="project-meeting-rhythm">
                <div>
                  <h2
                    id="project-meeting-rhythm"
                    className="project-dossier-section-title"
                  >
                    Regular meetings
                  </h2>
                  <p className="project-dossier-meta mt-1">
                    Meeting schedules that have repeated at least three times.
                  </p>
                </div>
                <div className="mt-4 divide-y divide-pro-border/40">
                  {current.meetingStats.recurringSeries.map((series) => (
                    <div
                      key={series.key}
                      className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div>
                        <p className="flex items-center gap-2 font-medium">
                          <Repeat2
                            aria-hidden="true"
                            className="h-4 w-4 text-pro-text-muted"
                          />
                          {series.title}
                        </p>
                        <p className="mt-1 text-sm text-pro-text-muted">
                          {series.cadence}
                        </p>
                      </div>
                      <p className="text-sm tabular-nums text-pro-text-muted sm:text-right">
                        {series.meetingCount} meetings
                        {series.typicalParticipantCount !== null
                          ? ` · usually ${series.typicalParticipantCount} people`
                          : ''}
                        <br />
                        Last met {formatDate(series.lastMetAt)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {current.theme?.openThreads.length ? (
              <section aria-labelledby="project-open-threads">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <h2
                      id="project-open-threads"
                      className="project-dossier-section-title"
                    >
                      Open questions and actions
                    </h2>
                    <p className="project-dossier-meta mt-1">
                      Decisions, next steps, questions, and commitments.
                    </p>
                  </div>
                </div>
                <ul className="mt-4 divide-y divide-pro-border/40">
                  {current.theme.openThreads.map((thread) => (
                    <li
                      key={`${thread.sourceMeetingId}-${thread.kind}-${thread.text}`}
                      className="grid gap-1 py-4 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-4"
                    >
                      <span className="text-xs capitalize text-pro-text-muted">
                        {thread.kind}
                      </span>
                      <span className="project-dossier-body">
                        {thread.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="project-conversation-history">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2
                  id="project-conversation-history"
                  className="project-dossier-section-title"
                >
                  Meeting history
                </h2>
                <span className="text-xs text-pro-text-muted">
                  {current.meetings.length} meeting
                  {current.meetings.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mt-4 divide-y divide-pro-border/40">
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

            {relatedWork.length > 0 && (
              <section aria-labelledby="project-related-work">
                <h2
                  id="project-related-work"
                  className="project-dossier-section-title"
                >
                  Related work
                </h2>
                <ul className="mt-4 divide-y divide-pro-border/40">
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
                Meetings, commitments, and alternate names will appear together.
                The original project is kept, and the merge can be undone.
              </p>
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
