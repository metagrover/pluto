import {
  Activity,
  CalendarClock,
  Check,
  ListChecks,
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
  updateProjectDisplayTitle,
} from '../../../api/knowledgeGraph';
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
    return () => {
      active = false;
    };
  }, [projectId, projectName, request]);

  const current = loadedProjectId === projectId ? brief : null;
  const needsAttention =
    current?.health.state === 'watch' ||
    current?.health.state === 'falling_behind';
  const qualification = readProjectQualification(current?.project.metadata);
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
              className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
            >
              Merge another project
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
              ? 'We couldn’t refresh this project. Your last loaded briefing is still here.'
              : 'We couldn’t load this project.'}
          </p>
          <button
            type="button"
            onClick={() => setRequest((value) => value + 1)}
            className={quietButton}
          >
            Retry
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
                    We couldn’t save this title. Your current title is
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
            <p className="mt-3 max-w-[65ch] text-base leading-relaxed text-pro-text-muted">
              {qualification?.outcome ||
                (qualification?.state === 'qualified'
                  ? 'Confirmed project'
                  : 'Pluto has not established a distinct project outcome yet.')}
            </p>
            {titleState === 'saved' && !editingTitle && (
              <output className="mt-2 flex items-center gap-1.5 text-xs text-pro-success">
                <Check aria-hidden="true" className="h-3.5 w-3.5" /> Title saved
              </output>
            )}
          </header>

          <section
            aria-label="Project activity"
            className="mb-8 border-y border-pro-border/45 py-3"
          >
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-pro-text-muted">
              <span className="inline-flex items-center gap-2">
                <CalendarClock aria-hidden="true" className="h-4 w-4" />
                {current.meetingStats.meetingCount} meeting
                {current.meetingStats.meetingCount === 1 ? '' : 's'}
              </span>
              {current.meetingStats.typicalParticipantCount !== null && (
                <span className="inline-flex items-center gap-2">
                  <Users aria-hidden="true" className="h-4 w-4" />
                  Typically {current.meetingStats.typicalParticipantCount}{' '}
                  participants
                </span>
              )}
              {current.meetingStats.activeWeeks !== null && (
                <span>
                  {current.meetingStats.activeWeeks} week
                  {current.meetingStats.activeWeeks === 1 ? '' : 's'} observed
                </span>
              )}
            </div>
            {current.meetingStats.typicalParticipantCount !== null &&
              current.meetingStats.participantCoverage <
                current.meetingStats.meetingCount && (
                <p className="mt-2 text-xs text-pro-text-muted">
                  Attendance is available for{' '}
                  {current.meetingStats.participantCoverage} of{' '}
                  {current.meetingStats.meetingCount} meetings.
                </p>
              )}
          </section>

          <div className="space-y-10">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(240px,0.85fr)]">
              <section
                aria-labelledby="project-attention"
                className="rounded-xl border border-pro-warning/25 bg-pro-warning/[0.055] p-5 sm:p-6"
              >
                <p
                  className={`mb-3 text-xs font-medium ${needsAttention ? 'text-pro-warning' : 'text-pro-text-muted'}`}
                >
                  {needsAttention ? 'What needs attention' : 'Current read'}
                </p>
                <h2 id="project-attention" className="text-lg font-semibold">
                  {current.health.evidenceTaskIds.length
                    ? current.tasks.find((task) =>
                        current.health.evidenceTaskIds.includes(task.id),
                      )?.name || current.health.headline
                    : current.health.headline}
                </h2>
                <p className="mt-2 max-w-[62ch] text-sm leading-6 text-pro-text-muted">
                  {current.health.summary}
                </p>
              </section>

              <section
                aria-labelledby="project-health"
                className="rounded-xl border border-pro-border/55 bg-pro-bg-elevated/35 p-5"
              >
                <div className="flex items-center gap-2 text-xs font-medium text-pro-text-muted">
                  <Activity aria-hidden="true" className="h-4 w-4" />
                  Health
                  <span className="font-normal">(evidence grounded)</span>
                </div>
                <h2
                  id="project-health"
                  className={`mt-3 text-lg font-semibold ${healthTone[current.health.state]}`}
                >
                  {current.health.headline}
                </h2>
                <p className="mt-2 text-xs leading-5 text-pro-text-muted">
                  {current.health.updatedAt
                    ? `Updated ${formatDate(current.health.updatedAt)} · ${current.health.freshness}`
                    : 'Based on confirmed linked work and available project evidence.'}
                </p>
              </section>
            </div>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(250px,0.8fr)]">
              <ProjectMilestones
                projectId={current.project.id}
                milestones={current.milestones}
                onChange={(milestones) =>
                  setBrief((value) =>
                    value ? { ...value, milestones } : value,
                  )
                }
              />

              <section
                aria-labelledby="project-momentum"
                className="self-start rounded-xl border border-pro-accent/15 bg-pro-accent/[0.035] p-5"
              >
                <div className="flex items-center gap-2 text-xs font-medium text-pro-accent">
                  <Activity aria-hidden="true" className="h-4 w-4" />
                  Momentum
                </div>
                <h2 id="project-momentum" className="mt-3 font-semibold">
                  {current.momentum.headline}
                </h2>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-start gap-3">
                    <CalendarClock
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 text-pro-text-muted"
                    />
                    <div>
                      <dt className="font-medium">
                        {current.momentum.recentMeetingCount} meeting
                        {current.momentum.recentMeetingCount === 1 ? '' : 's'}{' '}
                        in the last 30 days
                      </dt>
                      <dd className="mt-0.5 text-xs text-pro-text-muted">
                        {current.meetingStats.meetingCount} linked overall
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <ListChecks
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 text-pro-text-muted"
                    />
                    <div>
                      <dt className="font-medium">
                        {current.momentum.openCommitmentCount} open,{' '}
                        {current.momentum.completedCommitmentCount} completed
                      </dt>
                      <dd className="mt-0.5 text-xs text-pro-text-muted">
                        Confirmed linked commitments
                      </dd>
                    </div>
                  </div>
                </dl>
                <p className="mt-4 border-t border-pro-border/40 pt-3 text-xs leading-5 text-pro-text-muted">
                  {current.momentum.lastActivityAt
                    ? `Last observed activity ${formatDate(current.momentum.lastActivityAt)}.`
                    : 'No dated activity is available yet.'}
                </p>
              </section>
            </div>

            <ProjectCommitments
              key={projectId}
              projectId={projectId}
              defaultOpen={false}
            />

            <details className="group border-y border-pro-border/45 text-sm">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded py-3 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent">
                <span>Meeting rhythm</span>
                <span className="font-normal text-pro-text-muted">
                  {current.meetingStats.recurringSeries.length
                    ? `${current.meetingStats.recurringSeries.length} pattern${current.meetingStats.recurringSeries.length === 1 ? '' : 's'}`
                    : 'No pattern yet'}
                </span>
              </summary>
              <div className="pb-4">
                {current.meetingStats.recurringSeries.length ? (
                  <div className="divide-y divide-pro-border/40">
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
                            {series.cadence}
                          </p>
                          <p className="mt-1 text-pro-text-muted">
                            {series.title}
                          </p>
                        </div>
                        <p className="tabular-nums text-pro-text-muted sm:text-right">
                          {series.meetingCount} observed
                          {series.typicalParticipantCount !== null
                            ? ` · typically ${series.typicalParticipantCount} people`
                            : ''}
                          <br />
                          Last met {formatDate(series.lastMetAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="leading-6 text-pro-text-muted">
                    No recurring meeting pattern is established yet. Pluto needs
                    at least three consistently spaced observations.
                  </p>
                )}
              </div>
            </details>

            {relatedWork.length > 0 && (
              <section aria-labelledby="project-related-work">
                <h2
                  id="project-related-work"
                  className="mb-4 text-base font-semibold"
                >
                  Related work
                </h2>
                <ul className="divide-y divide-pro-border/40 border-y border-pro-border/50">
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

            <details className="group border-b border-pro-border/45 text-sm">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded py-3 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent">
                <span>Source meetings</span>
                <span className="font-normal text-pro-text-muted">
                  {current.meetings.length} linked
                </span>
              </summary>
              <div className="divide-y divide-pro-border/40 pb-4">
                {!current.meetings.length && (
                  <p className="py-3 leading-6 text-pro-text-muted">
                    No source meetings are linked to this project.
                  </p>
                )}
                {current.meetings.map((meeting) => (
                  <article key={meeting.id} className="py-4">
                    <p className="text-xs tabular-nums text-pro-text-muted">
                      {formatDate(meeting.started_at || meeting.created_at)}
                    </p>
                    {onOpenMeeting ? (
                      <button
                        type="button"
                        onClick={() => onOpenMeeting(meeting.id)}
                        className="mt-2 rounded text-left text-sm font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
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
                      <h3 className="mt-2 text-sm font-medium">
                        {meeting.title || 'Untitled meeting'}
                      </h3>
                    )}
                    {meeting.context && (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-pro-text-muted">
                        {meeting.context}
                      </p>
                    )}
                    {qualification?.sourceMeetingId === meeting.id && (
                      <div className="mt-3 space-y-2 rounded-md border border-pro-border/50 bg-pro-hover/25 p-3 leading-6 text-pro-text-muted">
                        {qualification.outcomeEvidenceQuote && (
                          <blockquote>
                            “{qualification.outcomeEvidenceQuote}”
                          </blockquote>
                        )}
                        {qualification.workItems?.map((item) => (
                          <blockquote key={item.evidenceQuote}>
                            “{item.evidenceQuote}”
                          </blockquote>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
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
                      Checking meetings, milestones, and commitments…
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
                  <p className="mt-3 leading-6 text-pro-text-muted">
                    Duplicate meeting references are removed. The title “
                    {selectedMergeSource.name}” remains searchable, and no
                    source record is deleted.
                  </p>
                </div>
              )}
              {mergeState === 'error' && (
                <p role="alert" className="mt-4 text-sm text-pro-urgent">
                  We couldn’t merge these projects. Both projects are unchanged.
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
