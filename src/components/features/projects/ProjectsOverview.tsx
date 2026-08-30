import { ChevronRight, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  discoverProjectInitiative,
  getProjectPortfolio,
  reviewProjectScope,
} from '../../../api/knowledgeGraph';
import { readProjectDisplayTitle } from '../../../utils/projectBriefing';
import {
  type ProjectPortfolioEntry,
  buildProjectPortfolio,
} from '../../../utils/projectPortfolio';
import {
  isProjectScopeReviewPending,
  readProjectQualification,
  shouldAutomaticallyReviewProjectScope,
} from '../../../utils/projectQualification';
import { PageHeader } from '../../ui/PageHeader';
import { ProjectCommitments } from './ProjectCommitments';
import { ProjectDossier } from './ProjectDossier';

const activityDate = (value: string | null) => {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

export function ProjectsOverview({
  selectedProjectId = null,
  onOpenMeeting,
}: {
  selectedProjectId?: string | null;
  onOpenMeeting?: (id: string) => void;
}) {
  const [activeId, setActiveId] = useState(selectedProjectId);
  const [entries, setEntries] = useState<ProjectPortfolioEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reviewState, setReviewState] = useState<
    'idle' | 'running' | 'paused' | 'failed' | 'incomplete'
  >('idle');
  const [discoveryState, setDiscoveryState] = useState<
    'idle' | 'running' | 'paused' | 'failed' | 'incomplete'
  >('idle');
  const [discoveryRemaining, setDiscoveryRemaining] = useState(0);
  const [discoveryFailed, setDiscoveryFailed] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);
  const skipped = useRef(new Set<string>());
  const retryCurrentRevision = useRef(false);
  const retry = () => {
    skipped.current.clear();
    retryCurrentRevision.current = true;
    setAttempt((value) => value + 1);
  };
  useEffect(() => setActiveId(selectedProjectId), [selectedProjectId]);

  useEffect(() => {
    const explicitRetry = retryCurrentRevision.current;
    retryCurrentRevision.current = false;
    let retryDiscoveryFailures = explicitRetry;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latestData: ProjectPortfolioEntry[] = [];
    const updatePending = (data: ProjectPortfolioEntry[]) => {
      const pendingIds = new Set(
        data
          .filter((entry) => isProjectScopeReviewPending(entry.metadata))
          .map((entry) => entry.id),
      );
      for (const id of skipped.current)
        if (!pendingIds.has(id)) skipped.current.delete(id);
      setRemaining(pendingIds.size);
      return pendingIds.size;
    };
    const refresh = async () => {
      const data = await getProjectPortfolio();
      latestData = data;
      if (!cancelled) {
        setEntries(data);
        setLoading(false);
        setLoadError(false);
      }
      return data;
    };
    const reviewNext = async () => {
      if (cancelled || activeId) return;
      setReviewState('running');
      try {
        const result = await reviewProjectScope({
          excludeProjectIds: [...skipped.current],
        });
        if (cancelled) return;
        const data = await refresh();
        if (cancelled) return;
        if (result.attemptedProjectId)
          skipped.current.add(result.attemptedProjectId);
        if (result.failedProjectId) skipped.current.add(result.failedProjectId);
        if (result.unresolvedProjectId)
          skipped.current.add(result.unresolvedProjectId);
        const pending = updatePending(data);
        const canContinue = pending > skipped.current.size;
        setReviewState(
          !pending
            ? 'idle'
            : !canContinue
              ? 'incomplete'
              : result.deferred
                ? 'paused'
                : 'running',
        );
        if (canContinue)
          timer = setTimeout(reviewNext, result.deferred ? 5000 : 500);
      } catch {
        if (!cancelled) setReviewState('failed');
      }
    };
    const beginReview = (data: ProjectPortfolioEntry[]) => {
      if (!explicitRetry) {
        for (const entry of data) {
          if (
            isProjectScopeReviewPending(entry.metadata) &&
            !shouldAutomaticallyReviewProjectScope(entry.metadata)
          )
            skipped.current.add(entry.id);
        }
      }
      const pending = updatePending(data);
      if (pending > skipped.current.size && !activeId) void reviewNext();
      else setReviewState(pending ? 'incomplete' : 'idle');
    };
    const discoverNext = async () => {
      if (cancelled || activeId) return;
      setDiscoveryState('running');
      try {
        const result = await discoverProjectInitiative({
          retryFailed: retryDiscoveryFailures,
        });
        retryDiscoveryFailures = false;
        if (cancelled) return;
        const data = result.discovered > 0 ? await refresh() : latestData;
        if (cancelled) return;
        setDiscoveryRemaining(result.remaining);
        setDiscoveryFailed(result.failed);
        if (result.failed > 0) {
          setDiscoveryState('incomplete');
        } else if (result.deferred) {
          setDiscoveryState('paused');
          timer = setTimeout(discoverNext, 5000);
        } else if (result.remaining > 0) {
          setDiscoveryState('running');
          timer = setTimeout(discoverNext, 500);
        } else {
          setDiscoveryState(result.failed > 0 ? 'incomplete' : 'idle');
          beginReview(data);
        }
      } catch {
        if (!cancelled) setDiscoveryState('failed');
      }
    };
    refresh()
      .then(() => {
        if (cancelled) return;
        if (!activeId) void discoverNext();
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [attempt, activeId]);

  const portfolio = useMemo(
    () => buildProjectPortfolio(entries, search),
    [entries, search],
  );
  const needsAttention = portfolio.current.filter(
    (entry) =>
      entry.health_state === 'falling_behind' || entry.health_state === 'watch',
  );
  const inMotion = portfolio.current.filter(
    (entry) => entry.health_state === 'appears_on_track',
  );
  const awaitingSignal = portfolio.current.filter(
    (entry) =>
      !entry.health_state || entry.health_state === 'not_enough_evidence',
  );
  const reloadPortfolio = async () => {
    const data = await getProjectPortfolio();
    setEntries(data);
    setLoadError(false);
  };
  if (activeId)
    return (
      <ProjectDossier
        projectId={activeId}
        projectName={entries.find((entry) => entry.id === activeId)?.name}
        onBack={() => setActiveId(null)}
        onOpenMeeting={onOpenMeeting}
        relatedWork={entries.filter(
          (entry) =>
            readProjectQualification(entry.metadata)?.parentProjectId ===
            activeId,
        )}
        onOpenRelatedWork={setActiveId}
        mergeCandidates={entries.filter(
          (entry) =>
            readProjectQualification(entry.metadata)?.state === 'qualified',
        )}
        onPortfolioChanged={reloadPortfolio}
      />
    );

  const renderRow = (entry: ProjectPortfolioEntry, secondary = false) => {
    const qualification = readProjectQualification(entry.metadata);
    const displayTitle = readProjectDisplayTitle(entry.metadata, entry.name);
    const date = activityDate(entry.last_mentioned_at);
    const context = secondary
      ? entry.latest_context
      : entry.health_summary || qualification?.outcome || entry.latest_context;
    return (
      <button
        type="button"
        key={entry.id}
        data-project-id={entry.id}
        onClick={() => setActiveId(entry.id)}
        className="group -mx-3 flex w-[calc(100%+1.5rem)] items-start gap-5 rounded-lg border-b border-pro-border/30 px-3 py-5 text-left transition-colors duration-150 hover:bg-pro-hover/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
      >
        <div className="min-w-0 flex-1">
          <h3
            className={`${secondary ? 'text-sm font-medium' : 'text-[17px] font-medium'} leading-snug text-pro-text-main`}
          >
            {displayTitle}
          </h3>
          {context && (
            <p className="mt-1.5 max-w-[65ch] text-[13px] leading-relaxed text-pro-text-muted line-clamp-2">
              {context}
            </p>
          )}
          {secondary && (
            <p className="mt-1.5 text-xs text-pro-text-muted">
              {qualification?.state === 'subordinate'
                ? 'Task or topic'
                : qualification?.reason || 'Project scope not established'}
            </p>
          )}
          {!secondary && (
            <p className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs tabular-nums text-pro-text-muted">
              {entry.health_headline && <span>{entry.health_headline}</span>}
              <span>
                {entry.meeting_count} meeting
                {entry.meeting_count === 1 ? '' : 's'}
              </span>
              {entry.typical_participant_count !== null &&
                entry.typical_participant_count !== undefined && (
                  <span>
                    Typically {entry.typical_participant_count} people
                  </span>
                )}
              {entry.recurring_cadence && (
                <span>{entry.recurring_cadence}</span>
              )}
              {entry.next_milestone && (
                <span>Next: {entry.next_milestone}</span>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-4 pt-0.5">
          {date && (
            <span
              className="text-xs text-pro-text-muted"
              title="Last discussed"
            >
              {date}
            </span>
          )}
          <ChevronRight
            aria-hidden="true"
            className="h-4 w-4 text-pro-text-muted/60 transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </div>
      </button>
    );
  };

  return (
    <div data-testid="projects-briefing">
      <PageHeader title="Projects" />
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <p className="text-[13px] text-pro-text-muted">
          {portfolio.current.length
            ? `${portfolio.current.length} initiative${portfolio.current.length === 1 ? '' : 's'} in view`
            : 'Independent outcomes, with the work behind them.'}
        </p>
        <label className="flex w-full items-center gap-2 rounded-lg border border-pro-border/50 px-3 py-2 sm:w-60 focus-within:border-pro-accent/50">
          <Search
            aria-hidden="true"
            className="h-3.5 w-3.5 text-pro-text-muted"
          />
          <input
            aria-label="Search projects and discussed work"
            placeholder="Search projects"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-0 w-full bg-transparent text-[13px] text-pro-text-main outline-none placeholder:text-pro-text-muted"
          />
        </label>
      </div>
      {loadError && (
        <p role="alert" className="mb-5 text-sm text-pro-text-muted">
          Couldn’t refresh projects. Your saved context is unchanged.{' '}
          <button
            type="button"
            onClick={retry}
            className="underline underline-offset-4"
          >
            Retry
          </button>
        </p>
      )}
      {loading ? (
        <div
          aria-label="Loading projects"
          className="space-y-6 py-4 motion-safe:animate-pulse"
        >
          {[1, 2, 3].map((id) => (
            <div key={id} className="space-y-3">
              <div className="h-4 w-40 rounded bg-pro-border/40" />
              <div className="h-3 w-2/3 rounded bg-pro-border/25" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <section data-testid="current-projects" aria-label="Current projects">
            {needsAttention.length > 0 && (
              <div className="mb-8">
                <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-pro-text-muted">
                  Needs attention
                </h2>
                {needsAttention.map((entry) => renderRow(entry))}
              </div>
            )}
            {inMotion.length > 0 && (
              <div className={awaitingSignal.length > 0 ? 'mb-8' : undefined}>
                {(needsAttention.length > 0 || awaitingSignal.length > 0) && (
                  <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-pro-text-muted">
                    In motion
                  </h2>
                )}
                {inMotion.map((entry) => renderRow(entry))}
              </div>
            )}
            {awaitingSignal.length > 0 && (
              <div>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-pro-text-muted">
                  Awaiting signal
                </h2>
                {awaitingSignal.map((entry) => renderRow(entry))}
              </div>
            )}
            {!portfolio.current.length && (
              <div className="py-10">
                <h2 className="font-serif text-xl text-pro-text-main">
                  {search
                    ? 'No matching initiatives'
                    : entries.length
                      ? reviewState === 'failed' || reviewState === 'incomplete'
                        ? 'Project review is incomplete'
                        : discoveryState === 'running'
                          ? 'Looking for established initiatives'
                          : discoveryState === 'paused'
                            ? 'Initiative discovery is paused'
                            : reviewState === 'running'
                              ? 'Reviewing your discussed work'
                              : reviewState === 'paused'
                                ? 'Project review is paused'
                                : 'No initiatives established yet'
                      : 'No projects yet'}
                </h2>
                <p className="mt-3 max-w-[55ch] text-sm leading-relaxed text-pro-text-muted">
                  {search
                    ? 'Other discussed work remains searchable below.'
                    : entries.length
                      ? 'Your discussed work is preserved below. Only initiatives supported by your conversations appear here.'
                      : 'Projects emerge when a conversation establishes a distinct outcome and the work needed to get there.'}
                </p>
              </div>
            )}
          </section>
          {(discoveryState !== 'idle' || discoveryRemaining > 0) && (
            <div
              className="mt-5 flex items-center gap-2 text-xs text-pro-text-muted"
              aria-live="polite"
            >
              <span>
                {discoveryState === 'failed'
                  ? 'Initiative discovery couldn’t finish. Existing context is still available.'
                  : discoveryState === 'incomplete'
                    ? `${discoveryFailed} source${discoveryFailed === 1 ? '' : 's'} need another discovery attempt.`
                    : discoveryState === 'paused'
                      ? 'Initiative discovery will resume when Pluto is free.'
                      : discoveryRemaining > 0
                        ? `Looking for established initiatives · ${discoveryRemaining} source${discoveryRemaining === 1 ? '' : 's'} remaining`
                        : 'Checking conversations for established initiatives.'}
              </span>
              {(discoveryState === 'failed' || discoveryFailed > 0) && (
                <button
                  type="button"
                  className="shrink-0 underline underline-offset-4"
                  onClick={retry}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {(reviewState !== 'idle' || remaining > 0) && (
            <div
              className="mt-5 flex items-center gap-2 text-xs text-pro-text-muted"
              aria-live="polite"
            >
              <span>
                {reviewState === 'failed'
                  ? 'Scope review couldn’t finish. Existing context is still available.'
                  : reviewState === 'incomplete'
                    ? `${remaining} item${remaining === 1 ? '' : 's'} still need${remaining === 1 ? 's' : ''} review. Your saved context is unchanged.`
                    : reviewState === 'paused'
                      ? 'Scope review will resume when Pluto is free.'
                      : `Reviewing project scope from your conversations · ${Math.max(0, remaining - skipped.current.size)} remaining this pass`}
              </span>
              {(reviewState === 'failed' || reviewState === 'incomplete') && (
                <button
                  type="button"
                  className="shrink-0 underline underline-offset-4"
                  onClick={retry}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {portfolio.completed.length > 0 && (
            <details
              className="mt-8 border-t border-pro-border/40 pt-5"
              open={search ? true : undefined}
            >
              <summary className="cursor-pointer text-[13px] text-pro-text-muted">
                Completed projects{' '}
                <span className="ml-2">{portfolio.completed.length}</span>
              </summary>
              <div className="mt-2">
                {portfolio.completed.map((entry) => renderRow(entry))}
              </div>
            </details>
          )}
          {portfolio.other.length > 0 && (
            <details
              className="mt-8 border-t border-pro-border/40 pt-5"
              open={search ? true : undefined}
            >
              <summary className="cursor-pointer text-[13px] text-pro-text-muted">
                Other discussed work{' '}
                <span className="ml-2">{portfolio.other.length}</span>
              </summary>
              <p className="mt-3 max-w-[65ch] text-xs leading-relaxed text-pro-text-muted">
                Tasks, topics, and work whose project scope is not yet
                established. Nothing has been deleted.
              </p>
              <div className="mt-2">
                {portfolio.other.map((entry) => renderRow(entry, true))}
              </div>
            </details>
          )}
        </>
      )}
      <ProjectCommitments />
    </div>
  );
}
