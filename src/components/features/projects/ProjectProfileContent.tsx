import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import {
  getCommitmentState,
  parseActionMetadata,
} from '../../../utils/actionCommitment';
import {
  DREAMING_STATUS_LABEL,
  type DreamingUiStatus,
} from '../../../utils/dreamingStatus';
import {
  type ProjectBrief,
  type ProjectProfileEvidence,
  cleanPersonRole,
} from '../../../utils/projectBriefing';
import { detectProjectCadence } from '../../../utils/projectCadence';
import {
  type ProjectPortfolioEntry,
  readProjectCadence,
} from '../../../utils/projectPortfolio';
import { readProjectQualification } from '../../../utils/projectQualification';

const date = (value: string | null | undefined) =>
  value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Date unavailable';
const link =
  'inline-flex min-h-9 items-center gap-1 rounded text-xs text-pro-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent';

export function ProjectProfileContent({
  brief,
  relatedWork,
  onOpenMeeting,
  onOpenPerson,
  onOpenRelatedWork,
  onDetachWork,
  milestones,
  onPrepareUpdates,
  preparationState,
}: {
  brief: ProjectBrief;
  relatedWork: ProjectPortfolioEntry[];
  onOpenMeeting?: (id: string) => void;
  onOpenPerson?: (id: string) => void;
  onOpenRelatedWork?: (id: string) => void;
  onDetachWork: (id: string) => Promise<void>;
  milestones: ReactNode;
  onPrepareUpdates: () => void;
  preparationState: DreamingUiStatus;
}) {
  const prefix = useId();
  const [tab, setTab] = useState<'brief' | 'prepare' | 'history'>('brief');
  const [allPeople, setAllPeople] = useState(false);
  const [detachState, setDetachState] = useState<string | null>(null);
  const [detachError, setDetachError] = useState(false);
  const theme = brief.theme;
  const qualification = readProjectQualification(brief.project.metadata);
  const currentRead = brief.themeSourceOutdated
    ? undefined
    : theme?.summary?.text || theme?.currentFocus;
  const openThreads = theme?.openThreads ?? [];
  const changes = theme?.recentChanges ?? [];
  const decisions = theme?.decisions ?? [];
  const workstreams = theme?.workstreams ?? [];
  const pending = brief.tasks.filter(
    (task) =>
      task.status !== 'completed' &&
      task.status !== 'dismissed' &&
      getCommitmentState(task.metadata) === 'confirmed',
  );
  const possible = brief.tasks.filter(
    (task) =>
      task.status !== 'completed' &&
      task.status !== 'dismissed' &&
      getCommitmentState(task.metadata) === 'possible',
  );
  const mine = brief.selfPersonId
    ? pending.filter((task) => task.assigned_to === brief.selfPersonId)
    : [];
  const people = [
    ...new Map(
      brief.meetings
        .flatMap((meeting) => meeting.participants ?? [])
        .filter(
          (person) =>
            person.entity_id &&
            !person.entity_id.startsWith('speaker:') &&
            !/^(speaker(?:\s*\d+)?|unknown|unassigned)$/i.test(person.name),
        )
        .map((person) => [
          person.entity_id,
          { ...person, role: cleanPersonRole(person.role) },
        ]),
    ).values(),
  ];
  const cadence = detectProjectCadence({
    meetings: brief.meetings,
    recurringSeries: brief.meetingStats.recurringSeries,
    manualOverride: readProjectCadence(brief.project.metadata),
  });
  const outcome = brief.themeSourceOutdated
    ? undefined
    : theme?.outcome || qualification?.outcome;
  const repeats =
    outcome &&
    currentRead &&
    outcome
      .toLocaleLowerCase()
      .replace(/[.!?]+$/, '')
      .trim() ===
      currentRead
        .toLocaleLowerCase()
        .replace(/[.!?]+$/, '')
        .trim();
  const sourceIds = new Set(brief.meetings.map((meeting) => meeting.id));
  const newerEvidence =
    theme &&
    brief.meetings.some(
      (meeting) => !theme.sourceMeetingIds.includes(meeting.id),
    );
  const history = [
    ...changes.map((change) => ({
      ...change,
      text: change.summary,
      kind: 'Change',
    })),
    ...decisions.map((decision) => ({ ...decision, kind: 'Decision' })),
  ]
    .filter((item) => sourceIds.has(item.sourceMeetingId))
    .sort((a, b) => {
      const time = (id: string) => {
        const meeting = brief.meetings.find((item) => item.id === id);
        return (
          Date.parse(meeting?.started_at || meeting?.created_at || '') || 0
        );
      };
      return time(b.sourceMeetingId) - time(a.sourceMeetingId);
    });

  const evidence = (item: ProjectProfileEvidence) => {
    const meeting = brief.meetings.find(
      (meeting) => meeting.id === item.sourceMeetingId,
    );
    if (!meeting || !item.evidenceQuote) return null;
    return (
      <details className="mt-2 text-xs text-pro-text-muted">
        <summary className={`${link} cursor-pointer list-none`}>
          <ChevronDown aria-hidden="true" className="h-3 w-3" />
          {date(meeting.started_at || meeting.created_at)} · Source
        </summary>
        <div className="mt-2 border-l border-pro-border pl-4">
          <blockquote className="max-w-[65ch] text-sm leading-6 text-pro-text-main">
            {item.evidenceQuote}
          </blockquote>
          {onOpenMeeting && (
            <button
              type="button"
              className={link}
              onClick={() => onOpenMeeting(meeting.id)}
            >
              {meeting.title || 'Open source meeting'}
              <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
            </button>
          )}
        </div>
      </details>
    );
  };

  const commitments = (tasks = pending) =>
    tasks.length ? (
      <ul className="divide-y divide-pro-border/40">
        {tasks.map((task) => (
          <li key={task.id} className="py-3">
            <p className="text-sm leading-6">{task.name}</p>
            <p className="mt-1 text-xs text-pro-text-muted">
              {task.assigned_to === brief.selfPersonId && brief.selfPersonId
                ? 'You'
                : people.find((person) => person.entity_id === task.assigned_to)
                    ?.name || 'Owner not established'}
              {task.due_date
                ? ` · Due ${date(task.due_date)}`
                : ' · No date agreed'}
            </p>
            {(() => {
              const metadata = parseActionMetadata(task.metadata);
              return typeof metadata.source_meeting_id === 'string' &&
                typeof metadata.evidence_quote === 'string'
                ? evidence({
                    sourceMeetingId: metadata.source_meeting_id,
                    evidenceQuote: metadata.evidence_quote,
                  })
                : null;
            })()}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm leading-6 text-pro-text-muted">
        No confirmed open commitments are linked to this project.
      </p>
    );

  return (
    <div className="project-profile-content">
      {outcome && !repeats ? (
        <p className="mb-6 max-w-[65ch] text-sm leading-6 text-pro-text-muted">
          {theme?.outcome || qualification?.outcome}
        </p>
      ) : null}
      <div
        role="tablist"
        aria-label="Project context"
        className="mb-7 flex flex-wrap gap-6 border-b border-pro-border/60"
      >
        {(
          [
            ['brief', 'Brief'],
            ['prepare', 'Next discussion'],
            ['history', 'History'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`${prefix}-${value}-tab`}
            aria-controls={`${prefix}-${value}`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              const values = ['brief', 'prepare', 'history'] as const;
              const index = values.indexOf(value);
              const next =
                event.key === 'ArrowRight'
                  ? values[(index + 1) % 3]
                  : event.key === 'ArrowLeft'
                    ? values[(index + 2) % 3]
                    : event.key === 'Home'
                      ? values[0]
                      : event.key === 'End'
                        ? values[2]
                        : null;
              if (next) {
                event.preventDefault();
                setTab(next);
                document.getElementById(`${prefix}-${next}-tab`)?.focus();
              }
            }}
            className={`min-h-11 border-b-2 pb-3 pt-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent ${tab === value ? 'border-pro-accent text-pro-text-main' : 'border-transparent text-pro-text-muted hover:text-pro-text-main'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-9 min-[850px]:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0">
          <section
            id={`${prefix}-brief`}
            role="tabpanel"
            aria-labelledby={`${prefix}-brief-tab`}
            hidden={tab !== 'brief'}
          >
            <h2 className="sr-only">Project brief</h2>
            {currentRead ? (
              <>
                <p className="project-dossier-lead max-w-[55ch] text-pro-text-main">
                  {currentRead}
                </p>
                {theme?.summary ? (
                  evidence(theme.summary)
                ) : (
                  <p className="mt-3 text-xs text-pro-text-muted">
                    Saved synthesis · {date(theme?.synthesizedAt)}
                  </p>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center rounded-xl border border-dashed border-pro-border/70 bg-pro-surface/50 dark:border-solid px-5 py-9 text-center sm:px-8 sm:py-12">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 200 112"
                  fill="none"
                  className="mb-6 h-28 w-48 max-w-full text-pro-accent"
                >
                  <g stroke="currentColor" strokeWidth="1.5">
                    <path d="M44 32h20l20 24m-40 24h20l20-24" opacity=".35" />
                    <rect
                      x="16"
                      y="18"
                      width="28"
                      height="28"
                      rx="8"
                      opacity=".5"
                    />
                    <rect
                      x="16"
                      y="66"
                      width="28"
                      height="28"
                      rx="8"
                      opacity=".5"
                    />
                    <path
                      d="M25 28h10m-10 7h6m-6 41h10m-10 7h6"
                      strokeLinecap="round"
                      opacity=".65"
                    />
                    <rect
                      x="84"
                      y="8"
                      width="100"
                      height="96"
                      rx="10"
                      className="fill-pro-surface"
                      opacity=".7"
                    />
                    <path
                      d="M102 30h36"
                      strokeWidth="3"
                      strokeLinecap="round"
                      opacity=".65"
                    />
                    <path
                      d="M102 48h64m-64 12h52m-52 12h58"
                      strokeLinecap="round"
                      strokeDasharray="3 5"
                      opacity=".3"
                    />
                    <path d="M102 88h18" strokeLinecap="round" opacity=".5" />
                  </g>
                </svg>
                <h3 className="max-w-[28ch] text-xl font-medium leading-snug text-pro-text-main">
                  A project brief is still taking shape
                </h3>
                <p className="mt-3 max-w-[46ch] text-sm leading-6 text-pro-text-muted">
                  {brief.meetings.length > 0
                    ? 'Prepare updates from connected meetings to bring this project’s direction, decisions, and next steps into focus.'
                    : 'Connect this project to relevant meetings or add an agreed milestone to begin.'}
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                  <button
                    type="button"
                    onClick={onPrepareUpdates}
                    disabled={
                      preparationState === 'running' ||
                      brief.meetings.length === 0
                    }
                    className="inline-flex min-h-10 items-center gap-2 rounded-md bg-pro-accent px-4 text-sm font-medium text-pro-bg hover:bg-pro-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-50"
                  >
                    <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                    {preparationState === 'running'
                      ? 'Preparing updates…'
                      : 'Prepare updates'}
                  </button>
                  {brief.meetings.length > 0 && (
                    <button
                      type="button"
                      className={link}
                      onClick={() => {
                        setTab('history');
                        document
                          .getElementById(`${prefix}-history-tab`)
                          ?.focus();
                      }}
                    >
                      Review source history{' '}
                      <ArrowUpRight
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                      />
                    </button>
                  )}
                </div>
                {preparationState !== 'idle' && (
                  <p
                    role="status"
                    className="mt-4 max-w-[46ch] text-sm leading-6 text-pro-text-muted"
                  >
                    {preparationState === 'no_change'
                      ? 'No new updates were found. More connected discussion may be needed to build this brief.'
                      : DREAMING_STATUS_LABEL[preparationState]}
                  </p>
                )}
              </div>
            )}
            {newerEvidence && (
              <p
                role="status"
                className="mt-4 text-xs leading-5 text-pro-text-muted"
              >
                Additional source meetings are available. This saved brief has
                not incorporated all of them yet.
              </p>
            )}
            {changes.length > 0 && (
              <section className="mt-8 border-t border-pro-border/50 pt-6">
                <h2 className="project-dossier-section-title mb-4">
                  What changed
                </h2>
                <div className="space-y-5">
                  {changes.map((change, index) => (
                    <article key={`${change.sourceMeetingId}-${index}`}>
                      <p className="text-sm leading-6">{change.summary}</p>
                      {evidence(change)}
                    </article>
                  ))}
                </div>
              </section>
            )}
            {(workstreams.length > 0 || relatedWork.length > 0) && (
              <section className="mt-8 border-t border-pro-border/50 pt-6">
                <h2 className="project-dossier-section-title mb-4">
                  Work within this project
                </h2>
                <div className="space-y-5">
                  {workstreams.map((stream, index) => (
                    <article key={`${stream.name}-${index}`}>
                      <h3 className="text-sm font-medium">{stream.name}</h3>
                      <p className="mt-1 text-sm leading-6 text-pro-text-muted">
                        {stream.text}
                      </p>
                      {evidence(stream)}
                    </article>
                  ))}
                </div>
                {relatedWork.length > 0 && (
                  <details className="mt-4">
                    <summary className={`${link} cursor-pointer`}>
                      Grouped work and topics
                    </summary>
                    <ul className="mt-2 divide-y divide-pro-border/40">
                      {relatedWork.map((work) => (
                        <li key={work.id} className="py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            {onOpenRelatedWork ? (
                              <button
                                type="button"
                                className={link}
                                onClick={() => onOpenRelatedWork(work.id)}
                              >
                                {work.display_title || work.name}
                              </button>
                            ) : (
                              <p className="text-sm">
                                {work.display_title || work.name}
                              </p>
                            )}
                            <button
                              type="button"
                              disabled={detachState !== null}
                              className={`${link} disabled:opacity-50`}
                              onClick={async () => {
                                setDetachState(work.id);
                                setDetachError(false);
                                try {
                                  await onDetachWork(work.id);
                                } catch {
                                  setDetachError(true);
                                } finally {
                                  setDetachState(null);
                                }
                              }}
                            >
                              {detachState === work.id
                                ? 'Separating…'
                                : 'Keep separate'}
                            </button>
                          </div>
                          <p className="text-xs text-pro-text-muted">
                            Filed within this project
                          </p>
                        </li>
                      ))}
                    </ul>
                    {detachError && (
                      <p role="alert" className="mt-2 text-sm text-pro-urgent">
                        Pluto couldn’t separate this work. Try again.
                      </p>
                    )}
                  </details>
                )}
              </section>
            )}
            <section className="mt-8 border-t border-pro-border/50 pt-6">
              <h2 className="project-dossier-section-title mb-3">
                Open questions and actions
              </h2>
              {openThreads.length ? (
                <div className="space-y-5">
                  {openThreads.map((thread, index) => (
                    <article key={`${thread.sourceMeetingId}-${index}`}>
                      <p className="mb-1 text-xs capitalize text-pro-text-muted">
                        {thread.kind === 'decision'
                          ? 'Decision to make'
                          : thread.kind}
                      </p>
                      <p className="text-sm leading-6">{thread.text}</p>
                      {evidence(thread)}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-pro-text-muted">
                  {theme
                    ? 'No unresolved questions were established in the saved synthesis.'
                    : 'No discussion points have been synthesized yet.'}
                </p>
              )}
            </section>
            <section className="mt-8 border-t border-pro-border/50 pt-6">
              <h2 className="project-dossier-section-title mb-3">
                Confirmed commitments
              </h2>
              {commitments()}
              {possible.length > 0 && (
                <details className="mt-4">
                  <summary className={`${link} cursor-pointer`}>
                    {possible.length} possible follow-up
                    {possible.length === 1 ? '' : 's'}
                  </summary>
                  <p className="mt-2 text-xs text-pro-text-muted">
                    These have not been confirmed as commitments.
                  </p>
                  <ul className="mt-2 space-y-2">
                    {possible.map((task) => (
                      <li className="text-sm" key={task.id}>
                        {task.name}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
            <div className="mt-8 border-t border-pro-border/50 pt-6">
              {milestones}
            </div>
          </section>
          <section
            id={`${prefix}-prepare`}
            role="tabpanel"
            aria-labelledby={`${prefix}-prepare-tab`}
            hidden={tab !== 'prepare'}
          >
            <h2 className="project-dossier-section-title mb-4">
              Recall the last discussion
            </h2>
            {currentRead ? (
              <>
                <p className="project-dossier-lead max-w-[55ch]">
                  {currentRead}
                </p>
                {theme?.summary && evidence(theme.summary)}
              </>
            ) : (
              <p className="text-sm text-pro-text-muted">
                A current synthesis is not available yet. Review the latest
                source meeting before your next discussion.
              </p>
            )}
            <p className="mt-4 text-xs text-pro-text-muted">
              Review the last discussion and confirm what needs attention next.
            </p>
            <section className="mt-8 border-t border-pro-border/50 pt-6">
              <h2 className="project-dossier-section-title mb-3">
                My commitments
              </h2>
              {brief.selfPersonId ? (
                mine.length ? (
                  commitments(mine)
                ) : (
                  <p className="text-sm text-pro-text-muted">
                    No confirmed open commitments are assigned to you.
                  </p>
                )
              ) : (
                <p className="text-sm leading-6 text-pro-text-muted">
                  Your identity is not established, so Pluto cannot distinguish
                  your commitments from the team's.
                </p>
              )}
            </section>
            <section className="mt-8 border-t border-pro-border/50 pt-6">
              <h2 className="project-dossier-section-title mb-4">
                Resolve with the team
              </h2>
              {openThreads.length ? (
                <div className="space-y-5">
                  {openThreads.map((thread, index) => (
                    <article key={index}>
                      <p className="text-sm leading-6">{thread.text}</p>
                      {evidence(thread)}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-pro-text-muted">
                  No specific discussion points were established. Start with the
                  latest meeting.
                </p>
              )}
            </section>
            {decisions.length > 0 && (
              <section className="mt-8 border-t border-pro-border/50 pt-6">
                <h2 className="project-dossier-section-title mb-4">
                  Keep earlier decisions in view
                </h2>
                <div className="space-y-5">
                  {decisions.map((item, index) => (
                    <article key={index}>
                      <p className="text-sm leading-6">{item.text}</p>
                      {evidence(item)}
                    </article>
                  ))}
                </div>
              </section>
            )}
          </section>
          <section
            id={`${prefix}-history`}
            role="tabpanel"
            aria-labelledby={`${prefix}-history-tab`}
            hidden={tab !== 'history'}
          >
            <h2 className="project-dossier-section-title mb-4">
              How the project evolved
            </h2>
            {history.length ? (
              <div className="divide-y divide-pro-border/50">
                {history.map((item, index) => (
                  <article key={index} className="py-4">
                    <p className="mb-1 text-xs text-pro-text-muted">
                      {item.kind}
                    </p>
                    <p className="text-sm leading-6">{item.text}</p>
                    {evidence(item)}
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-6 text-pro-text-muted">
                No supported changes or decisions have been synthesized yet. The
                source history is available below.
              </p>
            )}
            <section className="mt-8 border-t border-pro-border/50 pt-6">
              <h2 className="project-dossier-section-title mb-4">
                Meeting history
              </h2>
              <div className="divide-y divide-pro-border/40">
                {brief.meetings.map((meeting) => (
                  <article key={meeting.id} className="py-4">
                    <p className="text-xs text-pro-text-muted">
                      {date(meeting.started_at || meeting.created_at)}
                    </p>
                    {onOpenMeeting ? (
                      <button
                        type="button"
                        className={`${link} text-sm`}
                        onClick={() => onOpenMeeting(meeting.id)}
                      >
                        {meeting.title || 'Untitled meeting'}
                        <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
                      </button>
                    ) : (
                      <p className="mt-1 text-sm">
                        {meeting.title || 'Untitled meeting'}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
            {brief.meetingStats.recurringSeries.length > 0 && (
              <section className="mt-8 border-t border-pro-border/50 pt-6">
                <h2 className="project-dossier-section-title mb-4">
                  Regular meetings
                </h2>
                <div className="space-y-4">
                  {brief.meetingStats.recurringSeries.map((series) => (
                    <div key={series.key}>
                      <p className="text-sm">{series.title}</p>
                      <p className="text-xs text-pro-text-muted">
                        {series.cadence} · {series.meetingCount} meetings
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </section>
        </div>
        <aside className="min-w-0 border-t border-pro-border/50 pt-6 min-[850px]:border-l min-[850px]:border-t-0 min-[850px]:pl-6 min-[850px]:pt-0">
          <section>
            <h2 className="mb-3 text-sm font-medium">Next decision</h2>
            <p className="text-sm leading-6 text-pro-text-muted">
              {openThreads.find(
                (thread) =>
                  thread.kind === 'decision' || thread.kind === 'question',
              )?.text || 'No pending decision was established.'}
            </p>
            <button
              type="button"
              className={`${link} mt-2`}
              onClick={() => {
                setTab('prepare');
                document.getElementById(`${prefix}-prepare-tab`)?.focus();
              }}
            >
              Prepare for the discussion
            </button>
          </section>
          <section className="mt-7">
            <h2 className="mb-2 text-sm font-medium">People involved</h2>
            <div className="space-y-1">
              {(allPeople ? people : people.slice(0, 6)).map((person) => (
                <div key={person.entity_id} className="min-w-0">
                  <button
                    type="button"
                    data-person-card={person.name}
                    disabled={!onOpenPerson}
                    className="group flex min-h-7 w-full items-center justify-between gap-2 rounded text-left text-sm leading-5 text-pro-accent hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:text-pro-text-main"
                    onClick={() => onOpenPerson?.(person.entity_id)}
                  >
                    <span className="min-w-0 break-words underline decoration-pro-accent/40 underline-offset-4 group-hover:decoration-pro-accent group-disabled:no-underline">
                      {person.entity_id === brief.selfPersonId
                        ? `${person.name} (you)`
                        : person.name}
                    </span>
                    {onOpenPerson && (
                      <ChevronRight
                        aria-hidden="true"
                        className="h-3 w-3 shrink-0"
                      />
                    )}
                  </button>
                  {person.role && (
                    <p
                      title={person.role}
                      className="truncate text-xs leading-4 text-pro-text-muted"
                    >
                      {person.role}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {people.length === 0 && (
              <p className="text-sm text-pro-text-muted">
                No named participants are established yet.
              </p>
            )}
            {people.length > 6 && (
              <button
                type="button"
                className={`${link} mt-2`}
                onClick={() => setAllPeople((value) => !value)}
              >
                {allPeople
                  ? 'Show fewer people'
                  : `Show ${people.length - 6} more`}
              </button>
            )}
          </section>
          <section className="mt-7">
            <h2 className="mb-3 text-sm font-medium">Meeting rhythm</h2>
            <p className="text-sm">{cadence.label}</p>
            <p className="mt-1 text-xs leading-5 text-pro-text-muted">
              {cadence.detail}
            </p>
          </section>
          <section className="mt-7">
            <h2 className="mb-3 text-sm font-medium">Project health</h2>
            <p className="text-sm">{brief.health.headline}</p>
            <p className="mt-1 text-xs leading-5 text-pro-text-muted">
              {brief.health.summary}
            </p>
          </section>
          <section className="mt-7">
            <h2 className="mb-3 text-sm font-medium">Evidence & freshness</h2>
            {brief.themeSourceOutdated && (
              <p className="mb-2 text-xs leading-5 text-pro-text-muted">
                Source notes have changed. Unsupported parts of the saved brief
                are hidden until synthesis refreshes.
              </p>
            )}
            <p className="text-xs leading-5 text-pro-text-muted">
              {theme
                ? `Saved synthesis ${date(theme.synthesizedAt)}.`
                : 'No saved synthesis yet.'}{' '}
              {brief.meetingStats.meetingCount} source meetings.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
