import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import {
  getCommitmentState,
  parseActionMetadata,
} from '../../../utils/actionCommitment';
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
}: {
  brief: ProjectBrief;
  relatedWork: ProjectPortfolioEntry[];
  onOpenMeeting?: (id: string) => void;
  onOpenPerson?: (id: string) => void;
  onOpenRelatedWork?: (id: string) => void;
  onDetachWork: (id: string) => Promise<void>;
  milestones: ReactNode;
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
        <div className="mt-2 border-l border-pro-rule pl-4">
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
      <ul className="divide-y divide-pro-rule/40">
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
        className="mb-7 flex flex-wrap gap-6 border-b border-pro-rule/60"
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
              <div>
                <h3 className="text-lg font-medium">
                  A project brief is still taking shape
                </h3>
                <p className="mt-2 max-w-[65ch] text-sm leading-6 text-pro-text-muted">
                  {brief.meetings.length > 0
                    ? "Pluto needs enough connected discussion to explain this project's direction. Review its source history or add an agreed milestone."
                    : 'Connect this project to relevant meetings or add an agreed milestone to begin.'}
                </p>
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
              <section className="mt-8 border-t border-pro-rule/50 pt-6">
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
              <section className="mt-8 border-t border-pro-rule/50 pt-6">
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
                    <ul className="mt-2 divide-y divide-pro-rule/40">
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
            <section className="mt-8 border-t border-pro-rule/50 pt-6">
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
            <section className="mt-8 border-t border-pro-rule/50 pt-6">
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
            <div className="mt-8 border-t border-pro-rule/50 pt-6">
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
            <section className="mt-8 border-t border-pro-rule/50 pt-6">
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
            <section className="mt-8 border-t border-pro-rule/50 pt-6">
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
              <section className="mt-8 border-t border-pro-rule/50 pt-6">
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
              <div className="divide-y divide-pro-rule/50">
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
            <section className="mt-8 border-t border-pro-rule/50 pt-6">
              <h2 className="project-dossier-section-title mb-4">
                Meeting history
              </h2>
              <div className="divide-y divide-pro-rule/40">
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
              <section className="mt-8 border-t border-pro-rule/50 pt-6">
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
        <aside className="min-w-0 border-t border-pro-rule/50 pt-6 min-[850px]:border-l min-[850px]:border-t-0 min-[850px]:pl-6 min-[850px]:pt-0">
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
            <h2 className="mb-3 text-sm font-medium">People involved</h2>
            <div className="space-y-4">
              {(allPeople ? people : people.slice(0, 6)).map((person) => (
                <div key={person.entity_id}>
                  <button
                    type="button"
                    data-person-card={person.name}
                    disabled={!onOpenPerson}
                    className={`${link} text-sm text-pro-text-main disabled:no-underline`}
                    onClick={() => onOpenPerson?.(person.entity_id)}
                  >
                    {person.entity_id === brief.selfPersonId
                      ? `${person.name} (you)`
                      : person.name}
                  </button>
                  <p className="text-xs leading-5 text-pro-text-muted">
                    {pending
                      .filter((task) => task.assigned_to === person.entity_id)
                      .map((task) => task.name)
                      .join('; ') ||
                      person.role ||
                      'Joined project discussions'}
                  </p>
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
            <p className="mt-3 text-xs leading-5 text-pro-text-muted">
              Participation does not establish project ownership.
            </p>
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
