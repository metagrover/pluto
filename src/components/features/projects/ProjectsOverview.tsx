import { ChevronRight, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  discoverProjectInitiative,
  getProjectPortfolio,
} from '../../../api/knowledgeGraph';
import { readProjectDisplayTitle } from '../../../utils/projectBriefing';
import {
  type ProjectPortfolioEntry,
  buildProjectPortfolio,
} from '../../../utils/projectPortfolio';
import { readProjectQualification } from '../../../utils/projectQualification';
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

type SynthesisState = 'idle' | 'running' | 'paused' | 'failed' | 'incomplete';

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
  const [synthesisState, setSynthesisState] = useState<SynthesisState>('idle');
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);
  const explicitRetry = useRef(false);

  const retry = () => {
    explicitRetry.current = true;
    setAttempt((value) => value + 1);
  };

  useEffect(() => setActiveId(selectedProjectId), [selectedProjectId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const shouldRetry = explicitRetry.current;
    explicitRetry.current = false;
    const refresh = async () => {
      const data = await getProjectPortfolio();
      if (!cancelled) {
        setEntries(data);
        setLoading(false);
        setLoadError(false);
      }
      return data;
    };
    const synthesize = async () => {
      if (cancelled || activeId) return;
      setSynthesisState('running');
      try {
        const result = await discoverProjectInitiative({
          retryFailed: shouldRetry,
        });
        if (cancelled) return;
        if (result.discovered > 0) await refresh();
        if (result.failed > 0) setSynthesisState('incomplete');
        else if (result.deferred) {
          setSynthesisState('paused');
          timer = setTimeout(synthesize, 5000);
        } else setSynthesisState('idle');
      } catch {
        if (!cancelled) setSynthesisState('failed');
      }
    };
    refresh()
      .then(() => {
        if (!cancelled && !activeId) void synthesize();
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

  const renderRow = (
    entry: ProjectPortfolioEntry,
    mode: 'current' | 'suggested' | 'discussed',
  ) => {
    const qualification = readProjectQualification(entry.metadata);
    const displayTitle = readProjectDisplayTitle(entry.metadata, entry.name);
    const date = activityDate(entry.last_mentioned_at);
    const currentFocus =
      entry.current_focus || qualification?.outcome || entry.latest_context;
    return (
      <button
        type="button"
        key={entry.id}
        data-project-id={entry.id}
        onClick={() => setActiveId(entry.id)}
        className="group -mx-3 grid w-[calc(100%+1.5rem)] grid-cols-[minmax(0,1fr)_auto] gap-x-6 rounded-lg border-b border-pro-border/35 px-3 py-5 text-left transition-colors duration-150 hover:bg-pro-hover/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
      >
        <div className="min-w-0">
          <h3
            className={`${mode === 'current' ? 'text-[17px]' : 'text-sm'} font-medium leading-snug text-pro-text-main`}
          >
            {displayTitle}
          </h3>
          {currentFocus && (
            <p className="mt-1.5 max-w-[68ch] text-[13px] leading-relaxed text-pro-text-muted line-clamp-2">
              {currentFocus}
            </p>
          )}
          {mode === 'current' && entry.recent_change && (
            <p className="mt-2 max-w-[68ch] text-xs leading-relaxed text-pro-text-main/80">
              <span className="mr-1.5 font-medium text-pro-text-muted">
                Since last time
              </span>
              {entry.recent_change}
            </p>
          )}
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-pro-text-muted">
            {mode === 'suggested' ? (
              <span>One conversation, review before adding</span>
            ) : mode === 'discussed' ? (
              <span>
                {qualification?.state === 'subordinate'
                  ? 'Task or topic'
                  : 'Project scope not established'}
              </span>
            ) : (
              <>
                <span>
                  {entry.meeting_count} conversation
                  {entry.meeting_count === 1 ? '' : 's'}
                </span>
                {Boolean(entry.open_thread_count) && (
                  <span>
                    {entry.open_thread_count} open thread
                    {entry.open_thread_count === 1 ? '' : 's'}
                  </span>
                )}
                {entry.next_milestone && (
                  <span>Next: {entry.next_milestone}</span>
                )}
              </>
            )}
          </p>
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
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-pro-text-main">
            {portfolio.current.length
              ? `${portfolio.current.length} focus theme${portfolio.current.length === 1 ? '' : 's'}`
              : 'Your durable focus themes'}
          </p>
          <p className="mt-1 text-xs text-pro-text-muted">
            Established across conversations, with suggestions kept separate.
          </p>
        </div>
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
          Pluto couldn’t refresh project context. Your saved information is
          unchanged.{' '}
          <button
            type="button"
            onClick={retry}
            className="underline underline-offset-4"
          >
            Retry refresh
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
            {portfolio.current.map((entry) => renderRow(entry, 'current'))}
            {!portfolio.current.length && (
              <div className="border-y border-pro-border/35 py-9">
                <h2 className="font-serif text-xl text-pro-text-main">
                  {search
                    ? 'No matching focus themes'
                    : synthesisState === 'running'
                      ? 'Finding the themes that persist across conversations'
                      : 'No durable themes established yet'}
                </h2>
                <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-pro-text-muted">
                  {search
                    ? 'Suggestions and discussed work remain searchable below.'
                    : 'Pluto keeps one-off plans and topics out of your portfolio until another conversation reinforces them or you confirm them.'}
                </p>
              </div>
            )}
          </section>

          {synthesisState !== 'idle' && (
            <div
              className="mt-5 flex items-center gap-2 text-xs text-pro-text-muted"
              aria-live="polite"
            >
              <span>
                {synthesisState === 'failed'
                  ? 'Pluto couldn’t refresh themes. Existing project context is unchanged.'
                  : synthesisState === 'incomplete'
                    ? 'Theme synthesis needs another attempt. Existing project context is unchanged.'
                    : synthesisState === 'paused'
                      ? 'Theme synthesis will resume when Pluto is free.'
                      : 'Reviewing structured notes for durable themes.'}
              </span>
              {(synthesisState === 'failed' ||
                synthesisState === 'incomplete') && (
                <button
                  type="button"
                  className="shrink-0 underline underline-offset-4"
                  onClick={retry}
                >
                  Retry synthesis
                </button>
              )}
            </div>
          )}

          {portfolio.suggested.length > 0 && (
            <section
              className="mt-10 border-t border-pro-border/45 pt-6"
              aria-labelledby="suggested-projects"
            >
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="suggested-projects" className="text-sm font-semibold">
                  Suggested themes
                </h2>
                <span className="text-xs text-pro-text-muted">
                  {portfolio.suggested.length} to review
                </span>
              </div>
              <p className="mb-2 max-w-[65ch] text-xs leading-relaxed text-pro-text-muted">
                These came from one conversation. Confirm the ones that reflect
                real ongoing work, or dismiss them.
              </p>
              {portfolio.suggested.map((entry) =>
                renderRow(entry, 'suggested'),
              )}
            </section>
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
                {portfolio.completed.map((entry) =>
                  renderRow(entry, 'current'),
                )}
              </div>
            </details>
          )}

          {portfolio.other.length > 0 && (
            <details
              className="mt-8 border-t border-pro-border/40 pt-5"
              open={search ? true : undefined}
            >
              <summary className="cursor-pointer text-[13px] text-pro-text-muted">
                Discussed work{' '}
                <span className="ml-2">{portfolio.other.length}</span>
              </summary>
              <p className="mt-3 max-w-[65ch] text-xs leading-relaxed text-pro-text-muted">
                Tasks, topics, and possible themes remain available without
                crowding your project portfolio.
              </p>
              <div className="mt-2">
                {portfolio.other.map((entry) => renderRow(entry, 'discussed'))}
              </div>
            </details>
          )}
        </>
      )}
      <ProjectCommitments />
    </div>
  );
}
