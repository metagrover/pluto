import { useEffect, useState } from 'react';
import {
  type Entity,
  type EntityMeeting,
  getEntity,
  getEntityMeetings,
} from '../../../api/knowledgeGraph';
import type { ProjectPortfolioEntry } from '../../../utils/projectPortfolio';
import { readProjectQualification } from '../../../utils/projectQualification';
import { ProjectCommitments } from './ProjectCommitments';

interface ProjectDossierProps {
  projectId: string;
  projectName?: string;
  onBack: () => void;
  onOpenMeeting?: (id: string) => void;
  relatedWork?: ProjectPortfolioEntry[];
  onOpenRelatedWork?: (id: string) => void;
}
interface DossierData {
  projectId: string;
  entity: Entity | undefined;
  meetings: EntityMeeting[];
}
const quietButton =
  'text-sm text-pro-text-muted transition-colors hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40 rounded disabled:opacity-50';
const meetingDate = (meeting: EntityMeeting): string => {
  const date = new Date(meeting.started_at || meeting.created_at || '');
  return Number.isNaN(date.getTime())
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
  relatedWork = [],
  onOpenRelatedWork,
}: ProjectDossierProps) => {
  const [data, setData] = useState<DossierData | null>(null);
  const [request, setRequest] = useState(0);
  const [state, setState] = useState<{
    projectId: string;
    loading: boolean;
    error: boolean;
  }>({ projectId, loading: true, error: false });
  useEffect(() => {
    let active = true;
    setState({ projectId, loading: true, error: false });
    Promise.all([getEntity(projectId), getEntityMeetings(projectId)])
      .then(([entity, meetings]) => {
        if (!active) return;
        setData({ projectId, entity, meetings });
        setState({ projectId, loading: false, error: false });
      })
      .catch(() => {
        if (active) setState({ projectId, loading: false, error: true });
      });
    return () => {
      active = false;
    };
  }, [projectId, request]);
  const current = data?.projectId === projectId ? data : null;
  const loading = state.projectId !== projectId || state.loading;
  const error = state.projectId === projectId && state.error;
  const qualification = readProjectQualification(current?.entity?.metadata);
  let context: string | undefined;
  try {
    const metadata = JSON.parse(current?.entity?.metadata || '{}');
    if (typeof metadata?.context === 'string') context = metadata.context;
  } catch {
    /* Older metadata may not be valid JSON. */
  }
  const quotes = qualification
    ? [
        ...new Set(
          [
            qualification.outcomeEvidenceQuote,
            ...(qualification.workItems?.map((item) => item.evidenceQuote) ??
              []),
          ].filter((quote): quote is string => Boolean(quote)),
        ),
      ]
    : [];
  return (
    <div className="mx-auto w-full max-w-[72ch] pb-12 text-pro-text-main">
      <div className="mb-8 flex items-center justify-between gap-4">
        <button type="button" onClick={onBack} className={quietButton}>
          ← Back to projects
        </button>
        {current && (
          <button
            type="button"
            onClick={() => setRequest((value) => value + 1)}
            disabled={loading}
            className={quietButton}
          >
            Refresh
          </button>
        )}
      </div>
      <h1 className="mb-8 font-serif text-[32px] font-medium tracking-[-0.01em]">
        {current?.entity?.name || projectName || 'Project'}
      </h1>
      {error && (
        <div
          role="alert"
          className="mb-8 flex flex-wrap items-center gap-3 text-sm text-pro-text-muted"
        >
          <p>
            {current
              ? 'We couldn’t refresh this project. Your last loaded context is still here.'
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
          className="space-y-4 motion-safe:animate-pulse"
        >
          <div className="h-5 w-3/4 rounded bg-pro-border/30" />
          <div className="h-4 w-full rounded bg-pro-border/20" />
          <div className="h-4 w-5/6 rounded bg-pro-border/20" />
        </div>
      )}
      {current && !current.entity && (
        <p className="text-pro-text-muted">
          This project is no longer available.
        </p>
      )}
      {current?.entity && (
        <div className="space-y-10">
          <section aria-labelledby="project-scope">
            <h2 id="project-scope" className="mb-3 text-sm font-medium">
              Scope
            </h2>
            {qualification?.state === 'qualified' ? (
              <p className="text-base leading-relaxed">
                {qualification.outcome || 'Confirmed project'}
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-pro-text-muted">
                {qualification?.state === 'subordinate'
                  ? 'This context describes a task or topic rather than a separate project.'
                  : 'Not enough evidence yet to establish a distinct project outcome.'}
              </p>
            )}
            {qualification &&
              (qualification.state !== 'qualified' ||
                !qualification.outcome) && (
                <p className="mt-2 text-sm leading-relaxed text-pro-text-muted">
                  {qualification.reason}
                </p>
              )}
            {context && (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-pro-text-muted">
                {context}
              </p>
            )}
            {qualification?.state === 'qualified' &&
              Boolean(qualification.workItems?.length) && (
                <div className="mt-5">
                  <p className="mb-2 text-xs text-pro-text-muted">
                    Work described in the sources · not completion status
                  </p>
                  <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
                    {qualification.workItems?.map((item) => (
                      <li key={item.description}>{item.description}</li>
                    ))}
                  </ul>
                </div>
              )}
          </section>
          {relatedWork.length > 0 && (
            <section aria-labelledby="project-related-work">
              <h2
                id="project-related-work"
                className="mb-4 text-sm font-medium"
              >
                Related work
              </h2>
              <ul className="space-y-4">
                {relatedWork.map((entry) => (
                  <li key={entry.id}>
                    {onOpenRelatedWork ? (
                      <button
                        type="button"
                        onClick={() => onOpenRelatedWork(entry.id)}
                        className="rounded text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40"
                      >
                        {entry.name}
                      </button>
                    ) : (
                      <p className="text-sm font-medium">{entry.name}</p>
                    )}
                    {entry.latest_context && (
                      <p className="mt-1 text-sm leading-relaxed text-pro-text-muted">
                        {entry.latest_context}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ProjectCommitments key={projectId} projectId={projectId} />
          <section aria-labelledby="project-sources">
            <h2 id="project-sources" className="mb-4 text-sm font-medium">
              Source meetings
            </h2>
            {current.meetings.length === 0 && (
              <p className="text-sm leading-relaxed text-pro-text-muted">
                No source meetings are linked to this project.
              </p>
            )}
            <div className="space-y-7">
              {current.meetings.map((meeting) => (
                <article key={meeting.id} className="space-y-2">
                  <p className="text-xs text-pro-text-muted">
                    {meetingDate(meeting)}
                  </p>
                  {onOpenMeeting ? (
                    <button
                      type="button"
                      onClick={() => onOpenMeeting(meeting.id)}
                      className="rounded text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40"
                    >
                      {meeting.title || 'Untitled meeting'}{' '}
                      <span aria-hidden="true" className="text-pro-text-muted">
                        ↗
                      </span>
                    </button>
                  ) : (
                    <h3 className="text-sm font-medium">
                      {meeting.title || 'Untitled meeting'}
                    </h3>
                  )}
                  {meeting.context && (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-pro-text-muted">
                      {meeting.context}
                    </p>
                  )}
                  {qualification?.sourceMeetingId === meeting.id &&
                    quotes.map((quote) => (
                      <blockquote
                        key={quote}
                        className="border-l border-pro-border/50 pl-4 text-sm leading-relaxed text-pro-text-muted"
                      >
                        “{quote}”
                      </blockquote>
                    ))}
                </article>
              ))}
            </div>
            {quotes.length > 0 &&
              !current.meetings.some(
                (meeting) => meeting.id === qualification?.sourceMeetingId,
              ) && (
                <div className="mt-5 space-y-2">
                  <p className="text-xs text-pro-text-muted">
                    Saved evidence · source meeting unavailable
                  </p>
                  {quotes.map((quote) => (
                    <blockquote
                      key={quote}
                      className="border-l border-pro-border/50 pl-4 text-sm leading-relaxed text-pro-text-muted"
                    >
                      “{quote}”
                    </blockquote>
                  ))}
                </div>
              )}
          </section>
        </div>
      )}
    </div>
  );
};
